-- 0020_signup_role_from_app_metadata.sql
--
-- Issue #50 (ARCHITECTURE-SPINE.md AD-4): sign-ups can no longer choose a
-- privileged role.
--
-- Until now handle_new_user() took profiles.role from raw_user_meta_data,
-- which any caller of the public supabase.auth.signUp() controls: a crafted
-- sign-up with { role: 'admin' } became an admin, and a sign-up with no role
-- defaulted to 'teacher' (0001's reasoning for that default is superseded).
--
-- Role resolution is now:
--   1. raw_app_meta_data ->> 'role' when present. app_metadata is writable
--      only with the service role (Admin API), so this is the path for
--      admin/teacher accounts (admin/teachers "create teacher", tests).
--   2. otherwise raw_user_meta_data ->> 'role', but only when it is
--      'student' (the public /join flow, which stays Pending-gated).
--   3. otherwise raise, so the whole auth-user insert (the sign-up) rolls
--      back: no auth user, no profile.
--
-- 'parent' is not accepted yet (it is not a user_role value; an unknown
-- app_metadata role raises); the Parent stories add it under AD-4.
--
-- Differences from 0006's handle_new_user(), besides the role resolution:
--   * on_auth_user_created becomes a DEFERRABLE INITIALLY DEFERRED
--     constraint trigger, so it runs at commit, not right after the insert.
--   * the function re-reads the auth.users row at commit into `u` and builds
--     the profile from `u` (not NEW), so it sees the row's final metadata.
--   * it returns null, and skips a row deleted again in the same transaction.
-- The profile columns and their values are otherwise 0006's.
--
-- Why deferred: GoTrue's Admin API (auth.admin.createUser) inserts the
-- auth.users row with only { provider, providers } in raw_app_meta_data and
-- writes the caller's app_metadata with a follow-up UPDATE in the same
-- transaction. An immediate AFTER INSERT trigger never sees
-- app_metadata.role. At commit it does; raising then still rolls back the
-- whole sign-up. user_metadata is written by the INSERT itself, so the /join
-- flow is unaffected. The profile is still created in the same transaction
-- as the auth user, just at its end.
--
-- Consequence: ANY account creation that carries no role is refused --
-- Studio "Add user" / "Invite user", auth.admin.inviteUserByEmail,
-- signInWithOtp with shouldCreateUser, OAuth sign-in, anonymous sign-in, and
-- a plain signUp(). Only the Admin API createUser with app_metadata.role can
-- create staff (admin/teacher); client metadata may only say 'student'.
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
  elsif client_role = 'student' then
    meta_role := 'student';
  else
    raise exception 'handle_new_user: sign-up refused, role "%" may not be chosen by the client (issue #50, AD-4)',
      coalesce(client_role, '<none>')
      using errcode = 'insufficient_privilege';
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
  return null;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create constraint trigger on_auth_user_created
  after insert on auth.users
  deferrable initially deferred
  for each row execute function public.handle_new_user();
