-- 0024_parent_first_registration.sql
--
-- Story 7-2: parent-first student registration & linking (AD-10, AD-11).
--
-- * profiles.parent_id: FK to parents.id, ON DELETE RESTRICT. It is the
--   stored link between a student and their parent; RLS never matches on
--   email text. guardian_email stays as a display copy only.
-- * handle_new_user() (0023): the student branch changes.
--     - A student whose role comes from user_metadata (the /join server
--       action, or a crafted public signUp) must carry a synthetic
--       `pending-<uuid>@students.internal.invalid` auth email and a
--       guardian_email that matches an APPROVED parent's profile email
--       (trimmed, case-insensitive). The parent's id becomes parent_id.
--       No match raises, so the whole sign-up rolls back.
--     - A student whose role comes from app_metadata (service role only:
--       tests and fixtures, the #50 rule) is trusted and may have no parent.
--       If its guardian_email names an approved parent, it is linked too.
--     - guardian_email is the metadata value (trimmed), no longer the auth
--       email: the auth email is synthetic now.
--   The parent branch and the deferred-trigger shape are 0023's verbatim.
-- * Guard trigger: parent_id, guardian_email and role cannot be changed by
--   the `authenticated` or `anon` database roles -- not even through the
--   teacher's registration-review update. The service role and
--   security-definer functions (which run as their owner) still can, so
--   7-6's guardian-email-change approval can move parent_id.
-- * profiles_update_registration_review (0006): approval no longer needs
--   email_confirmed_at. Guardian-email confirmation is retired; the
--   sync_email_confirmed_at trigger and profiles.email_confirmed_at stay,
--   because parent approval (0023) uses them.
-- * is_parent_of(student_id), linked_children(): security-definer helpers
--   for 7-3 onwards and the /parent landing page.
--
-- No data migration: existing students keep parent_id null (test data is
-- reset at release).

-- ---------------------------------------------------------------------------
-- profiles.parent_id
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column parent_id uuid references public.parents (id) on delete restrict;

comment on column public.profiles.parent_id is
  'Story 7-2 (AD-10): the student''s parent (parents.id), set once by handle_new_user() at sign-up. Changed only by trusted paths (guard trigger profiles_guard_link_columns). RLS matches on this, never on guardian_email.';

comment on column public.profiles.guardian_email is
  'Display copy of the guardian email given at registration (Story 7-2: the user_metadata guardian_email, not the auth email). Never used for authorization; parent_id is the link.';

create index profiles_parent_id_idx on public.profiles (parent_id) where parent_id is not null;

-- parent_id is a student-only column, like the others in this check.
alter table public.profiles drop constraint profiles_student_fields_check;

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
      and guardian_email is null
      and parent_id is null
    )
  );

-- ---------------------------------------------------------------------------
-- handle_new_user(): 0023 with a new student branch.
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
  meta_guardian_email text;
  student_parent_id uuid;
  parent_matches integer;
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

  -- Story 7-2: the student's parent link.
  if meta_role = 'student' then
    meta_guardian_email := nullif(btrim(u.raw_user_meta_data ->> 'guardian_email'), '');

    if meta_guardian_email is not null then
      select count(*), min(pa.id::text)::uuid
        into parent_matches, student_parent_id
      from public.parents pa
      join public.profiles pp on pp.id = pa.id
      where pa.status = 'approved'
        and lower(btrim(pp.email)) = lower(meta_guardian_email);

      if parent_matches > 1 then
        raise exception 'handle_new_user: guardian_email matches more than one approved parent'
          using errcode = 'check_violation';
      end if;
    end if;

    if app_role is null then
      -- user_metadata student (the /join server action, or a crafted public
      -- signUp()): only the synthetic registration address, and only with
      -- an approved parent. Otherwise the whole sign-up rolls back.
      if lower(u.email) !~ '^pending-[0-9a-f-]+@students\.internal\.invalid$' then
        raise exception 'handle_new_user: a student sign-up must use a pending-<uuid>@students.internal.invalid address'
          using errcode = 'check_violation';
      end if;
      if student_parent_id is null then
        raise exception 'handle_new_user: no approved parent account for this guardian email'
          using errcode = 'check_violation';
      end if;
    end if;
    -- app_metadata student (service role only): trusted, may have no parent.
  end if;

  meta_registration_name := u.raw_user_meta_data ->> 'registration_name';
  meta_class_id := nullif(u.raw_user_meta_data ->> 'class_id', '')::uuid;
  meta_consent_at := nullif(u.raw_user_meta_data ->> 'guardian_consent_given_at', '')::timestamptz;

  insert into public.profiles (
    id, email, display_name, role,
    status, class_id, registration_name, guardian_consent_given_at,
    guardian_email, email_confirmed_at, parent_id
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
    case when meta_role = 'student' then meta_guardian_email else null end,
    u.email_confirmed_at,
    case when meta_role = 'student' then student_parent_id else null end
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

-- ---------------------------------------------------------------------------
-- Guard trigger: link columns are not client-writable.
-- SECURITY INVOKER on purpose: current_user must be the caller's database
-- role. Security-definer functions run as their owner and the service role
-- is 'service_role', so trusted paths pass.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_link_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and (
      new.parent_id is distinct from old.parent_id
      or new.guardian_email is distinct from old.guardian_email
      or new.role is distinct from old.role
    )
  then
    raise exception 'parent_id, guardian_email and role cannot be changed here'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_link_columns() from public, anon, authenticated;

create trigger profiles_guard_link_columns
  before update on public.profiles
  for each row execute function public.guard_profile_link_columns();

-- ---------------------------------------------------------------------------
-- profiles_update_registration_review: 0006 without the email_confirmed_at
-- clause. Guardian-email confirmation is retired (Story 7-2); the student
-- is linked to an approved parent at sign-up instead.
-- ---------------------------------------------------------------------------

drop policy "profiles_update_registration_review" on public.profiles;

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

-- ---------------------------------------------------------------------------
-- is_parent_of(student_id)
-- ---------------------------------------------------------------------------

create or replace function public.is_parent_of(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.is_parent()
    and exists (
      select 1
      from public.profiles p
      where p.id = p_student_id
        and p.role = 'student'
        and p.status = 'approved'
        and p.parent_id = auth.uid()
    );
$$;

comment on function public.is_parent_of(uuid) is
  'Story 7-2 (AD-10): true when the caller is an approved parent, the student''s parent_id is the caller and the student is approved.';

revoke all on function public.is_parent_of(uuid) from public, anon;
grant execute on function public.is_parent_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- linked_children(): the caller's pending and approved children, never
-- rejected ones. Name and status only (7-3 adds the details).
-- ---------------------------------------------------------------------------

create or replace function public.linked_children()
returns table (id uuid, name text, status public.registration_status)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.display_name, p.status
  from public.profiles p
  where public.is_parent()
    and p.parent_id = auth.uid()
    and p.role = 'student'
    and p.status in ('pending', 'approved')
  order by lower(p.display_name), p.id;
$$;

comment on function public.linked_children() is
  'Story 7-2: the calling approved parent''s pending and approved children (id, name, status). Rejected children are never returned.';

revoke all on function public.linked_children() from public, anon;
grant execute on function public.linked_children() to authenticated, service_role;
