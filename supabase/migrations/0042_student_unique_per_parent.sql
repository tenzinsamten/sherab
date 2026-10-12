-- 0042_student_unique_per_parent.sql
--
-- #98: one student account per parent and name.
--
-- A student who filled in /join again with another class's code got a second
-- account (pending, no team, no streak, new username and PIN). The old rule
-- was per (class, name) and only over pending and rejected rows, so it let
-- this through.
--
-- The new rule: one student row per (parent_id, lower(btrim(registration_name)))
-- over pending, approved and rejected rows, in any class.
--   * It replaces the per-(class, name) rule: two parents may each register a
--     child with the same name in the same class.
--   * A rejected registration keeps blocking the same parent and name until a
--     teacher clears it (the row is deleted), as before.
--   * Students without a parent (service-role fixtures only) are outside it.
--
-- * profiles_student_parent_name_unique: the rule itself. handle_new_user()
--   (0024) inserts the profile with "on conflict (id) do nothing", so a break
--   of this index raises and rolls the whole sign-up back.
-- * student_registration_state(guardian_email, registration_name): the
--   friendly lookup for /join. It finds the parent the way handle_new_user()
--   does (an approved parents row whose profiles.email equals the guardian
--   email, lower(btrim()) on both sides) and returns 'available' or the
--   status of that parent's student with this name. It answers "does this
--   parent have a child called X", so only the service role may call it.
-- * Gone: profiles_open_student_registration_unique and
--   check_registration_available(uuid, text), both from 0002.
--
-- No row is deleted or changed. If rows already break the rule, the check
-- below stops the migration before anything else happens.

-- ---------------------------------------------------------------------------
-- Stop if existing rows break the rule.
-- ---------------------------------------------------------------------------

do $$
declare
  duplicate_groups integer;
  duplicate_rows integer;
begin
  select count(*), coalesce(sum(g.n), 0)
    into duplicate_groups, duplicate_rows
  from (
    select count(*) as n
    from public.profiles p
    where p.role = 'student'
      and p.parent_id is not null
      -- The index treats rows without a name as distinct; so does this check.
      and p.registration_name is not null
    group by p.parent_id, lower(btrim(p.registration_name))
    having count(*) > 1
  ) g;

  if duplicate_groups > 0 then
    raise exception
      '0042_student_unique_per_parent: % student rows break the rule "one student per parent and name" (#98): % pair(s) of parent and name have more than one student. The rule was not created and nothing was changed.',
      duplicate_rows, duplicate_groups
      using
        errcode = 'unique_violation',
        hint = 'List them with: select parent_id, lower(btrim(registration_name)) as name, count(*), array_agg(id order by created_at) as student_ids, array_agg(status order by created_at) as statuses from public.profiles where role = ''student'' and parent_id is not null and registration_name is not null group by 1, 2 having count(*) > 1; -- then decide by hand which account each child keeps, and run the migration again.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The old per-(class, name) rule goes.
-- ---------------------------------------------------------------------------

drop function public.check_registration_available(uuid, text);
drop index public.profiles_open_student_registration_unique;

-- ---------------------------------------------------------------------------
-- The rule.
-- ---------------------------------------------------------------------------

create unique index profiles_student_parent_name_unique
  on public.profiles (parent_id, lower(btrim(registration_name)))
  where role = 'student' and parent_id is not null;

comment on index public.profiles_student_parent_name_unique is
  '#98: one student account per parent and name (trimmed, case-insensitive), over pending, approved and rejected rows and in any class. student_registration_state() is the friendly lookup for /join; this is the enforcement.';

-- ---------------------------------------------------------------------------
-- student_registration_state(guardian_email, registration_name)
-- ---------------------------------------------------------------------------

create or replace function public.student_registration_state(
  p_guardian_email text,
  p_registration_name text
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select s.status::text
      from public.parents pa
      join public.profiles pp on pp.id = pa.id
      join public.profiles s on s.parent_id = pa.id
      where pa.status = 'approved'
        and lower(btrim(pp.email)) = lower(btrim(p_guardian_email))
        and s.role = 'student'
        and lower(btrim(s.registration_name)) = lower(btrim(p_registration_name))
      -- At most one row per parent (the index above). More than one approved
      -- parent with this email is refused by handle_new_user() anyway.
      order by s.status, s.id
      limit 1
    ),
    'available'
  );
$$;

comment on function public.student_registration_state(text, text) is
  '#98: ''available'' when the approved parent with this email has no student with this name (trimmed, case-insensitive), otherwise that student''s status (pending, approved or rejected). Also ''available'' when no approved parent has this email. Service role only: it tells whether a parent has a child with a given name.';

revoke all on function public.student_registration_state(text, text) from public, anon, authenticated;
grant execute on function public.student_registration_state(text, text) to service_role;
