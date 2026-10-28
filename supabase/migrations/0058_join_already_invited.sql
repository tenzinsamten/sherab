-- 0058_join_already_invited.sql
--
-- spec-second-parent, story 5: /join refuses a child the registering parent
-- was already invited to (CAP-5, AD-11, AD-16).
--
-- The registering parent is the approved parent handle_new_user() matches
-- by the guardian email. The check applies when that parent has, for a
-- student whose lower(btrim(registration_name)) equals the new name:
--   * a live invite (parent_invite_is_live, invited_email = the parent's
--     lower(btrim(email))), or
--   * an active or removed student_parents link.
--
-- * handle_new_user(): 0054 verbatim plus the check, after the parents row
--   lock and before the profile insert. Raises check_violation (23514) with
--   hint already_invited, like the trigger's other refusals.
-- * student_registration_state(): 0054 verbatim plus 'invited' for the same
--   cases. The existing answers (approved / pending / rejected, the parent's
--   own registered child) take precedence; otherwise 'available'.
--
-- Children the parent registered themselves keep today's behaviour: the
-- 0042 unique index refuses them and the state function returns their
-- status. Neither answer depends on whether the invited email has an
-- account: only the registering parent's own email is compared. Grants and
-- the trigger binding (0020) are unchanged.
-- The check also applies to service-role (app_metadata) students whose
-- guardian email matches an approved parent.

-- ---------------------------------------------------------------------------
-- handle_new_user(): 0054 with the already-invited check.
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
  v_new_name text;
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

  -- Story 7-2: the parent who registers the student.
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

      -- Lock order (AD-10): the parent's parents row first, then the
      -- student's profile (inserted below). Re-check it is still approved.
      if student_parent_id is not null then
        perform 1
        from public.parents pa
        where pa.id = student_parent_id
          and pa.status = 'approved'
        for update;
        if not found then
          student_parent_id := null;
        end if;
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

    -- spec-second-parent story 5 (CAP-5, AD-11, AD-16): no second account
    -- for a child this parent was invited to or is (or was) linked to.
    -- The parents row lock above serialises this parent's own sign-ups only:
    -- create/accept_parent_invite do not take it, so a concurrent invite can
    -- slip through (accept then refuses it with duplicate_child_name).
    -- Children the parent registered are left to the 0042 unique index.
    if student_parent_id is not null then
      v_new_name := lower(btrim(u.raw_user_meta_data ->> 'registration_name'));
      if v_new_name is not null and v_new_name <> '' and exists (
        select 1
        from public.profiles c
        where c.role = 'student'
          and lower(btrim(c.registration_name)) = v_new_name
          and c.registered_by_parent_id is distinct from student_parent_id
          and (
            exists (
              select 1
              from public.student_parents sp
              where sp.student_id = c.id
                and sp.parent_id = student_parent_id
            )
            or exists (
              select 1
              from public.parent_invites i
              join public.profiles pp on pp.id = student_parent_id
              where i.student_id = c.id
                and i.invited_email = lower(btrim(pp.email))
                and public.parent_invite_is_live(i)
            )
          )
      ) then
        raise exception 'handle_new_user: this parent was already invited to or linked to a child with this name'
          using errcode = 'check_violation', hint = 'already_invited';
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
    guardian_email, email_confirmed_at, registered_by_parent_id
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

  -- The slot-1 link, in the same transaction as the profile.
  if found and meta_role = 'student' and student_parent_id is not null then
    insert into public.student_parents (student_id, parent_id, slot, invited_by)
    values (u.id, student_parent_id, 1, null);
  end if;

  if meta_role = 'parent' then
    insert into public.parents (id, status)
    values (u.id, 'pending')
    on conflict (id) do nothing;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- student_registration_state(guardian_email, registration_name): 0054 plus
-- 'invited'. Service role only (0042 grants, kept by create or replace).
-- ---------------------------------------------------------------------------

create or replace function public.student_registration_state(
  p_guardian_email text,
  p_registration_name text
)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (
      select s.status::text
      from public.parents pa
      join public.profiles pp on pp.id = pa.id
      join public.profiles s on s.registered_by_parent_id = pa.id
      where pa.status = 'approved'
        and lower(btrim(pp.email)) = lower(btrim(p_guardian_email))
        and s.role = 'student'
        and lower(btrim(s.registration_name)) = lower(btrim(p_registration_name))
      -- At most one row per parent (the 0042 index). More than one approved
      -- parent with this email is refused by handle_new_user() anyway.
      order by s.status, s.id
      limit 1
    ),
    -- Story 5: a live invite for, or an active or removed link to, a
    -- student with this name (the handle_new_user() check).
    (
      select 'invited'
      from public.parents pa
      join public.profiles pp on pp.id = pa.id
      join public.profiles s on s.role = 'student'
        and lower(btrim(s.registration_name)) = lower(btrim(p_registration_name))
      where pa.status = 'approved'
        and lower(btrim(pp.email)) = lower(btrim(p_guardian_email))
        and nullif(btrim(p_registration_name), '') is not null
        and (
          exists (
            select 1
            from public.student_parents sp
            where sp.student_id = s.id
              and sp.parent_id = pa.id
          )
          or exists (
            select 1
            from public.parent_invites i
            where i.student_id = s.id
              and i.invited_email = lower(btrim(pp.email))
              and public.parent_invite_is_live(i)
          )
        )
      limit 1
    ),
    'available'
  );
$$;

comment on function public.student_registration_state(text, text) is
  '#98, spec-second-parent story 5: for the approved parent with this email and this name (trimmed, case-insensitive): the status (pending, approved or rejected) of the student that parent registered; else ''invited'' when the parent has a live invite for, or an active or removed link to, a student with this name; else ''available''. Also ''available'' when no approved parent has this email. Service role only: it tells whether a parent has a child with a given name.';
