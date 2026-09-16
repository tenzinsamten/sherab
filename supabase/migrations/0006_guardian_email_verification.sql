-- 0006_guardian_email_verification.sql
-- Guardian-email verification for student self-registration.
--
-- Production Supabase Auth already runs with `enable_confirmations = true`
-- (local dev's `false` was the drift that broke registration -- see 0002's
-- placeholder-email design, which a real confirmation flow can never
-- confirm). Rather than turning confirmation off, the join wizard's
-- signUp() call now uses the guardian's *real* email as the Auth account's
-- email, so Supabase's own built-in confirmation mail becomes the
-- verification step -- no new email-sending infrastructure. Student login
-- is unaffected: approval still swaps this email for the synthetic
-- `{username}@students.internal.invalid` + PIN exactly as before (AD-4's
-- "Supabase Auth is the sole identity provider" is unchanged, just fed a
-- different pre-approval address).

-- ---------------------------------------------------------------------------
-- profiles: guardian_email (retained after approval overwrites profiles.email
-- to the synthetic address -- see requests/+page.server.ts's approve action
-- -- so a guardian contact isn't lost; a natural enabler for the still-
-- deferred "reissue lost credentials" flow) and email_confirmed_at (mirrors
-- auth.users.email_confirmed_at for every role, not just students, via the
-- trigger below).
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column guardian_email text,
  add column email_confirmed_at timestamptz;

comment on column public.profiles.guardian_email is
  'The guardian email supplied at registration (== auth.users.email at INSERT time). Kept even after approval overwrites profiles.email to the synthetic login address, so the contact isn''t lost.';
comment on column public.profiles.email_confirmed_at is
  'Mirrors auth.users.email_confirmed_at via the on_auth_user_email_confirmed trigger below. Meaningful for every role (teacher/admin accounts get confirmed too), unlike the other student-only columns in this table.';

-- profiles_student_fields_check (0002) must be dropped and recreated --
-- Postgres has no ALTER of a CHECK constraint's definition -- to also gate
-- guardian_email to role='student' only. email_confirmed_at is deliberately
-- NOT added to this gate.
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
    )
  );

-- ---------------------------------------------------------------------------
-- handle_new_user(): extend once more (full replace, as 0002 did to 0001's
-- version) to populate the two new columns. No new raw_user_meta_data key
-- is needed for guardian_email -- it's just new.email at INSERT time, since
-- the join action now signs up with the guardian's real address directly.
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
    status, class_id, registration_name, guardian_consent_given_at,
    guardian_email, email_confirmed_at
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
    case when meta_role = 'student' then meta_consent_at else null end,
    case when meta_role = 'student' then new.email else null end,
    new.email_confirmed_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_email_confirmed_at(): mirrors auth.users.email_confirmed_at onto
-- profiles whenever it changes -- fires when a guardian clicks their
-- confirmation link (handled entirely by GoTrue's own /auth/v1/verify
-- endpoint; no app route needed), and again, harmlessly, when the approval
-- action's updateAuthUserEmailAndPassword() call sets email_confirm=true on
-- the synthetic login email.
-- ---------------------------------------------------------------------------

create or replace function public.sync_email_confirmed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email_confirmed_at = new.email_confirmed_at
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
  after update on auth.users
  for each row
  when (old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function public.sync_email_confirmed_at();

-- ---------------------------------------------------------------------------
-- profiles_update_registration_review (0002): extend WITH CHECK so an
-- approval (status -> 'approved') additionally requires a confirmed
-- guardian email. Rejection stays unconditional -- a teacher must be able
-- to dismiss an unverified/spam registration without waiting on anyone.
--
-- Ordering note for implementers: requests/+page.server.ts's `approve`
-- action mints the student's real login credentials (which sets
-- email_confirm=true on the *synthetic* address) BEFORE it flips
-- profiles.status to 'approved'. That means by the time this WITH CHECK
-- runs, profiles.email_confirmed_at has *already* been forced non-null by
-- the trigger above, regardless of whether the guardian ever confirmed --
-- this policy alone cannot be the only gate. The action MUST pre-check
-- email_confirmed_at on its initial RLS-scoped fetch, before any Admin API
-- call, for this feature to actually gate anything. This policy remains a
-- real backstop against any other path that tries to flip status directly.
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
    and (
      status = 'rejected'
      or (status = 'approved' and email_confirmed_at is not null)
    )
  );
