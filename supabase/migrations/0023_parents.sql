-- 0023_parents.sql
--
-- Story 7-1: parent accounts and admin approval (AD-4).
--
-- * public.parents: one row per parent login (PK = FK to profiles.id, on
--   delete cascade). Parent capability comes ONLY from an approved row here,
--   never from profiles.role ('parent' there just marks a parent-only login).
-- * RLS: the owner and the admin may read. Only the admin may update, and
--   only `status` (column grant); approval is refused while the login's
--   email is unconfirmed (profiles.email_confirmed_at, mirrored by 0006's
--   sync_email_confirmed_at()). No client insert or delete: the row is
--   created by handle_new_user() and removed by the auth-user cascade when
--   the admin rejects (the server action deletes the parent-only auth user).
-- * A BEFORE UPDATE trigger stamps reviewed_by / reviewed_at on a status
--   change, refuses moving a decided row back to 'pending' and refuses any
--   change out of 'rejected'.
-- * is_parent(): true when the caller has an approved row.
-- * handle_new_user() (0020): client metadata may now say 'student' or
--   'parent'; app_metadata may say 'parent' too (it is now a user_role
--   value). A parent sign-up also inserts the pending parents row, in the
--   same transaction, and is refused for a student login address or a name
--   over 80 characters. Everything else is 0020's verbatim.

-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------

create type public.parent_status as enum ('pending', 'approved', 'rejected');

create table public.parents (
  id uuid primary key references public.profiles (id) on delete cascade,
  status public.parent_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);

comment on table public.parents is
  'Parent capability (Story 7-1, AD-4): only an approved row makes a login a parent (is_parent()). Created pending by handle_new_user(); only the admin changes status.';

create index parents_status_idx on public.parents (status);

alter table public.parents enable row level security;

create policy "parents_select_own_or_admin"
  on public.parents for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "parents_update_admin"
  on public.parents for update
  to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (
      status <> 'approved'
      or exists (
        select 1
        from public.profiles p
        where p.id = parents.id
          and p.email_confirmed_at is not null
      )
    )
  );

revoke all on public.parents from anon, authenticated;
grant select on public.parents to authenticated;
grant update (status) on public.parents to authenticated;

create or replace function public.stamp_parent_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'parents.id cannot change' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'pending' then
      raise exception 'a decided parent cannot go back to pending' using errcode = '42501';
    end if;
    if old.status = 'rejected' then
      raise exception 'a rejected parent cannot be decided again' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_parent_review() from public, anon, authenticated;

create trigger parents_stamp_review
  before update on public.parents
  for each row execute function public.stamp_parent_review();

-- ---------------------------------------------------------------------------
-- is_parent()
-- ---------------------------------------------------------------------------

create or replace function public.is_parent()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.parents pa
    where pa.id = auth.uid()
      and pa.status = 'approved'
  );
$$;

comment on function public.is_parent() is
  'True if the calling JWT has an approved parents row (Story 7-1, AD-4). Never inferred from profiles.role.';

revoke all on function public.is_parent() from public, anon;
grant execute on function public.is_parent() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- handle_new_user(): 0020 plus the parent branch.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u auth.users%rowtype;
  meta_role public.user_role;
  app_role text;
  client_role text;
  meta_registration_name text;
  meta_class_id uuid;
  meta_consent_at timestamptz;
begin
  -- Deferred: NEW is the row as inserted; read its state at commit instead.
  select * into u from auth.users where id = new.id;
  if not found then
    return null; -- deleted again within the same transaction
  end if;

  app_role := nullif(u.raw_app_meta_data ->> 'role', '');
  client_role := u.raw_user_meta_data ->> 'role';

  if app_role is not null then
    if app_role not in (select unnest(enum_range(null::public.user_role))::text) then
      raise exception 'handle_new_user: unknown app_metadata role "%" (issue #50)', app_role
        using errcode = 'check_violation';
    end if;
    meta_role := app_role::public.user_role;
  elsif client_role in ('student', 'parent') then
    meta_role := client_role::public.user_role;
  else
    raise exception 'handle_new_user: sign-up refused, role "%" may not be chosen by the client (issue #50, AD-4)',
      coalesce(client_role, '<none>')
      using errcode = 'insufficient_privilege';
  end if;

  -- A crafted public signUp() skips /register's checks: a parent login may
  -- not take a student login address or an over-long name.
  if meta_role = 'parent' then
    if lower(u.email) like '%@students.internal.invalid' then
      raise exception 'handle_new_user: a parent may not use a student login address'
        using errcode = 'check_violation';
    end if;
    -- The name the profile gets below (registration_name wins, as in 0020).
    if length(coalesce(
      u.raw_user_meta_data ->> 'registration_name',
      u.raw_user_meta_data ->> 'display_name'
    )) > 80 then
      raise exception 'handle_new_user: parent display_name longer than 80 characters'
        using errcode = 'check_violation';
    end if;
  end if;

  meta_registration_name := u.raw_user_meta_data ->> 'registration_name';
  meta_class_id := nullif(u.raw_user_meta_data ->> 'class_id', '')::uuid;
  meta_consent_at := nullif(u.raw_user_meta_data ->> 'guardian_consent_given_at', '')::timestamptz;

  insert into public.profiles (
    id, email, display_name, role,
    status, class_id, registration_name, guardian_consent_given_at,
    guardian_email, email_confirmed_at
  )
  values (
    u.id,
    u.email,
    coalesce(
      meta_registration_name,
      u.raw_user_meta_data ->> 'display_name',
      u.email
    ),
    meta_role,
    case when meta_role = 'student' then 'pending'::public.registration_status else null end,
    case when meta_role = 'student' then meta_class_id else null end,
    case when meta_role = 'student' then meta_registration_name else null end,
    case when meta_role = 'student' then meta_consent_at else null end,
    case when meta_role = 'student' then u.email else null end,
    u.email_confirmed_at
  )
  on conflict (id) do nothing;

  if meta_role = 'parent' then
    insert into public.parents (id, status)
    values (u.id, 'pending')
    on conflict (id) do nothing;
  end if;

  return null;
end;
$$;
