-- 0002_student_registration.sql
-- Story 1-2: Student Self-Registration & Approval
--
-- Extends the Story 1-1 identity model (profiles + class_teachers +
-- is_admin()/is_teacher_of_class()) rather than inventing a parallel one
-- (ARCHITECTURE-SPINE.md AD-4). Students self-register and land in
-- profiles with role='student', status='pending' -- invisible everywhere
-- until a class teacher or the admin approves/rejects them (AD-2: every
-- rule below is enforced in RLS, never frontend-only).
--
-- Design Notes (spec): sign-in is a real Supabase Auth session behind a
-- deterministic synthetic email ({username}@students.internal.invalid) +
-- PIN-as-password, generated only at approval time -- so every existing
-- and future RLS policy keyed on auth.uid() keeps working unmodified.

-- ---------------------------------------------------------------------------
-- registration_status enum
-- ---------------------------------------------------------------------------

create type public.registration_status as enum ('pending', 'approved', 'rejected');

comment on type public.registration_status is
  'Meaningful only for role=''student'' rows. teacher/admin profiles leave status null.';

-- ---------------------------------------------------------------------------
-- teams (minimal team-assignment seam, name only -- ranking/scoring is
-- Story 4-3, not built here)
-- ---------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.teams is
  'Minimal team-assignment seam (name only) so the approval team-picker has something to assign. Leaderboard rank/scoring is Story 4-3, deliberately not built here.';

alter table public.teams enable row level security;

create policy "teams_select_authenticated"
  on public.teams for select
  using (auth.role() = 'authenticated');

create policy "teams_insert_admin"
  on public.teams for insert
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles: extend with registration/approval fields
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column status public.registration_status,
  add column class_id uuid references public.classes (id) on delete set null,
  add column team_id uuid references public.teams (id) on delete set null,
  add column registration_name text,
  add column guardian_consent_given_at timestamptz,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz;

comment on column public.profiles.status is
  'Registration approval state. Only ever set for role=''student'' (see profiles_student_fields_check).';
comment on column public.profiles.class_id is
  'Class the student registered into. Distinct from class_teachers (teacher<->class assignment).';
comment on column public.profiles.team_id is
  'Settable only from NULL through the normal approval action -- see profiles_team_id_set_once trigger below.';

-- Defensive: these columns only ever make sense on a student row. Prevents
-- an accidental write from leaving stray registration data on a teacher or
-- admin profile.
alter table public.profiles add constraint profiles_student_fields_check
  check (
    role = 'student'
    or (
      status is null
      and class_id is null
      and team_id is null
      and registration_name is null
      and guardian_consent_given_at is null
      and reviewed_by is null
      and reviewed_at is null
    )
  );

create index profiles_class_id_idx on public.profiles (class_id) where role = 'student';

-- A new registration is blocked while a Pending or not-yet-cleared Rejected
-- row exists for the same (class_id, registration_name) pair (Boundaries).
-- "CLEAR REJECTED" hard-deletes the row (see requests approval route), which
-- is exactly what re-opens this index for the same pair -- no separate
-- "cleared" flag needed.
create unique index profiles_open_student_registration_unique
  on public.profiles (class_id, lower(registration_name))
  where role = 'student' and status in ('pending', 'rejected');

comment on index public.profiles_open_student_registration_unique is
  'Real DB-level guarantee behind the duplicate-registration rule (AD-2 spirit: not just an app-level convention) -- check_registration_available() below is the friendly pre-check; this is the backstop.';

-- ---------------------------------------------------------------------------
-- team_id settable only from NULL (AD-4). Once set, changing it is rejected
-- unconditionally for every client-facing path, including an admin acting
-- through the normal approval route (Story 1-2 AC: "when anyone (including
-- an admin) tries to change team_id through the normal approval path again,
-- then the update is rejected"). The "documented admin-only override path"
-- is deliberately NOT a built client feature -- it is an out-of-band DB
-- action (e.g. run as the table owner, which is not subject to this
-- trigger), mirroring the admin-bootstrap promotion SQL precedent from
-- Story 1-1. Recorded as a follow-up in deferred-work.md.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_team_id_set_once()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is distinct from old.team_id and old.team_id is not null then
    raise exception
      'team_id is already set; changing it requires the documented admin-only override (a direct DB action, not the app API)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_team_id_set_once
  before update on public.profiles
  for each row execute function public.enforce_team_id_set_once();

-- ---------------------------------------------------------------------------
-- handle_new_user(): extend to also read student registration metadata.
-- Teacher/admin creation (role/display_name via raw_user_meta_data) is
-- unchanged -- this only adds the student branch.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role public.user_role;
  meta_registration_name text;
  meta_class_id uuid;
  meta_consent_at timestamptz;
begin
  meta_role := coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'teacher');
  meta_registration_name := new.raw_user_meta_data ->> 'registration_name';
  meta_class_id := nullif(new.raw_user_meta_data ->> 'class_id', '')::uuid;
  meta_consent_at := nullif(new.raw_user_meta_data ->> 'guardian_consent_given_at', '')::timestamptz;

  insert into public.profiles (
    id, email, display_name, role,
    status, class_id, registration_name, guardian_consent_given_at
  )
  values (
    new.id,
    new.email,
    coalesce(
      meta_registration_name,
      new.raw_user_meta_data ->> 'display_name',
      new.email
    ),
    meta_role,
    case when meta_role = 'student' then 'pending'::public.registration_status else null end,
    case when meta_role = 'student' then meta_class_id else null end,
    case when meta_role = 'student' then meta_registration_name else null end,
    case when meta_role = 'student' then meta_consent_at else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- validate_class_code(): unauthenticated-safe class code lookup for join
-- wizard step 1, without a broad anon SELECT policy on classes.
-- ---------------------------------------------------------------------------

create or replace function public.validate_class_code(code text)
returns table (id uuid, name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.name
  from public.classes c
  where c.code = upper(btrim(code));
$$;

comment on function public.validate_class_code(text) is
  'Returns zero rows for an unknown/malformed code. SECURITY DEFINER so the join wizard can look up a class before the visitor has any session.';

grant execute on function public.validate_class_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- check_registration_available(): friendly pre-check for the duplicate-
-- registration rule, backed by profiles_open_student_registration_unique
-- above. Called before signUp() so the wizard can show an inline error
-- instead of a raw trigger-inside-signUp failure.
-- ---------------------------------------------------------------------------

create or replace function public.check_registration_available(p_class_id uuid, p_registration_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1
    from public.profiles p
    where p.class_id = p_class_id
      and p.role = 'student'
      and p.status in ('pending', 'rejected')
      and lower(p.registration_name) = lower(p_registration_name)
  );
$$;

comment on function public.check_registration_available(uuid, text) is
  'True if (class_id, registration_name) has no open (pending/rejected, not-yet-cleared) registration.';

grant execute on function public.check_registration_available(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: profiles (new policies only -- profiles_select_own /
-- profiles_select_admin from 0001 are unchanged and still apply).
-- ---------------------------------------------------------------------------

-- Admin, or any teacher assigned to the student's class, can see that
-- student's row regardless of status (pending/approved/rejected) -- this is
-- what powers the shared /requests approval queue and its DECIDED history.
-- It is deliberately NOT a general "students visible to their class's
-- teacher forever" roster policy beyond that -- roster/leaderboard reads
-- are Story 2-1's concern and will add their own status='approved' filter
-- on top of this visibility, never relying on this policy alone to hide
-- Pending students from a roster.
create policy "profiles_select_admin_or_teacher_of_student_class"
  on public.profiles for select
  using (
    role = 'student'
    and class_id is not null
    and (public.is_admin() or public.is_teacher_of_class(class_id))
  );

-- Approval action: admin, or the teacher assigned to the student's class,
-- may move a Pending student to approved/rejected (and, for approved, set
-- team_id -- enforced separately by profiles_team_id_set_once above).
-- Non-assigned teachers get zero rows affected, not an error (RLS denies by
-- filtering, matching Story 1-1's established pattern).
create policy "profiles_update_registration_review"
  on public.profiles for update
  using (
    role = 'student'
    and status = 'pending'
    and class_id is not null
    and (public.is_admin() or public.is_teacher_of_class(class_id))
  )
  with check (
    role = 'student'
    and class_id is not null
    and (public.is_admin() or public.is_teacher_of_class(class_id))
    and status in ('approved', 'rejected')
  );

-- No client-facing DELETE policy on profiles: "CLEAR REJECTED" deletes the
-- underlying auth.users row via the Supabase Auth Admin API (which cascades
-- to profiles per its own FK), only after the request-scoped RLS-gated
-- client has independently proven the caller may see that row via
-- profiles_select_admin_or_teacher_of_student_class above -- see
-- src/routes/requests/+page.server.ts.
