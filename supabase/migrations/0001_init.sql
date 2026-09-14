-- 0001_init.sql
-- Story 1-1: Teacher Account Management, Classes & Project Scaffold
--
-- Identity model per ARCHITECTURE-SPINE.md AD-4:
--   - Supabase Auth is the sole identity provider.
--   - `profiles` PK = auth.users.id, carries `role`.
--   - `class_teachers` expresses many-to-many teacher<->class assignment.
--   - Every class/role RLS check resolves through profiles + class_teachers,
--     never a locally invented check.
--
-- Authorization per AD-2: every rule below is enforced in RLS, never
-- frontend-only. Frontend code may additionally hide UI, but the DB is the
-- real barrier.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- 'student' is included now (not used until the deferred registration story)
-- so a later story never needs `alter type ... add value`, which cannot run
-- inside the same transaction as its first use.
create type public.user_role as enum ('admin', 'teacher', 'student');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role public.user_role not null default 'teacher',
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user (AD-4: PK = auth.users.id). role drives every RLS check in the app.';

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.classes is
  'A class''s identity is its generated unique code, not its name (duplicate names are allowed).';

create table public.class_teachers (
  class_id uuid not null references public.classes (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);

comment on table public.class_teachers is
  'Many-to-many teacher<->class assignment (AD-4). Every class-scoped RLS policy resolves through this table.';

create index class_teachers_teacher_id_idx on public.class_teachers (teacher_id);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  'Admin-tunable values (streak grace period, badge milestone step, homework look-ahead window, ...) read at runtime instead of hardcoded constants. Empty in this story; populated by later stories.';

-- ---------------------------------------------------------------------------
-- Helper functions
--
-- SECURITY DEFINER + owned by the migration role (which bypasses RLS) so
-- these can be used inside RLS policies without re-triggering RLS on
-- `profiles`/`class_teachers` recursively (standard Supabase pattern).
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True if the calling JWT belongs to an admin profile. SECURITY DEFINER to avoid recursive RLS evaluation on profiles.';

create or replace function public.is_teacher_of_class(target_class_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.class_teachers ct
    where ct.class_id = target_class_id
      and ct.teacher_id = auth.uid()
  );
$$;

comment on function public.is_teacher_of_class(uuid) is
  'True if the calling JWT is assigned (via class_teachers) to the given class.';

-- ---------------------------------------------------------------------------
-- New-auth-user trigger: every signed-up user gets a profile row.
--
-- Default role is 'teacher' because the only client-facing sign-up flow in
-- this story is the one-time admin-bootstrap step (see story Implementation
-- Notes for the promotion SQL) -- teachers themselves are otherwise created
-- admin-side via the Supabase Auth Admin API, which can also pass an
-- explicit role through user_metadata.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'teacher')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_teachers enable row level security;
alter table public.app_settings enable row level security;

-- profiles: a user can read their own row; admin can read every row.
-- No client-facing INSERT/UPDATE/DELETE policy exists yet -- inserts happen
-- only via the SECURITY DEFINER trigger above, and role promotion happens
-- only via the documented one-time admin SQL step (run as the DB owner,
-- which bypasses RLS entirely). A future story that adds self-service
-- profile edits (e.g. display_name) must add a narrowly-scoped UPDATE policy
-- that explicitly excludes `role`.
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_select_admin"
  on public.profiles for select
  using (public.is_admin());

-- classes: readable by admin, or by any teacher assigned to that class.
-- Writable by admin only (class creation is admin-only per story scope).
create policy "classes_select_admin_or_assigned_teacher"
  on public.classes for select
  using (public.is_admin() or public.is_teacher_of_class(id));

create policy "classes_insert_admin"
  on public.classes for insert
  with check (public.is_admin());

create policy "classes_update_admin"
  on public.classes for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "classes_delete_admin"
  on public.classes for delete
  using (public.is_admin());

-- class_teachers: a teacher can read their own assignment rows; admin reads
-- all. Only admin may create/remove assignments (admin assigns teachers to
-- classes).
create policy "class_teachers_select_admin_or_own"
  on public.class_teachers for select
  using (public.is_admin() or teacher_id = auth.uid());

create policy "class_teachers_insert_admin"
  on public.class_teachers for insert
  with check (public.is_admin());

create policy "class_teachers_delete_admin"
  on public.class_teachers for delete
  using (public.is_admin());

-- app_settings: any authenticated user may read (future screens read these
-- instead of hardcoding); only admin may write.
create policy "app_settings_select_authenticated"
  on public.app_settings for select
  using (auth.role() = 'authenticated');

create policy "app_settings_all_admin"
  on public.app_settings for all
  using (public.is_admin())
  with check (public.is_admin());
