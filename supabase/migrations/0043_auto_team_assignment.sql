-- 0043_auto_team_assignment.sql
--
-- #99: the team is assigned automatically and evenly at approval.
--
-- Until now the admin or the class teacher picked the team by hand on
-- /requests, and nothing kept the teams the same size.
--
-- The new rule: when a student's status becomes 'approved', the database puts
-- the student in a team with the fewest students; when several teams are the
-- smallest, in one of them at random.
--   * A team's size is the number of student rows with that team, whatever
--     their status: the function does not look at the status. In the app only
--     approved students have a team, so there it is the number of approved
--     students; a pending or rejected student who was given a team by hand
--     counts too.
--   * For a client role (authenticated, anon) the database always chooses; a
--     team sent with the update is ignored. A trusted caller (the service
--     role, the table owner) may set a team itself; without one the database
--     chooses for it too.
--   * With no team at all the approval is refused (hint 'no_teams').
--   * A student who already has a team keeps it: this trigger does nothing
--     then, and enforce_team_id_set_once() (0002) refuses any change as before.
--   * Nobody is moved. Teams that are uneven today even out only through new
--     approvals.
--
-- * assign_team_on_approval(): the trigger function. SECURITY DEFINER, so the
--   count sees every student whatever the caller's rights. It takes one
--   transaction-level advisory lock first, so two approvals at the same moment
--   cannot both count the same state: the second waits for the first to
--   commit, and its count (a new statement, so a new snapshot under READ
--   COMMITTED) then sees the first student's team.
-- * profiles_assign_team_on_approval: before update on profiles. Before-update
--   triggers fire in name order, so it runs before profiles_guard_link_columns
--   and profiles_team_id_set_once. Who is asking is decided in the trigger's
--   WHEN clause, not in the function: the clause is evaluated as the caller,
--   where current_user is still the caller's database role (inside the
--   SECURITY DEFINER function it would be the function's owner).
--
-- No row is deleted or changed.

-- ---------------------------------------------------------------------------
-- assign_team_on_approval()
-- ---------------------------------------------------------------------------

create or replace function public.assign_team_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
begin
  -- One approval at a time, until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('profiles:assign_team_on_approval', 0));

  select t.id into v_team_id
  from public.teams t
  order by
    (
      select count(*)
      from public.profiles p
      where p.team_id = t.id and p.role = 'student'
    ),
    random()
  limit 1;

  if v_team_id is null then
    raise exception 'a student cannot be approved while there is no team'
      using errcode = '22023', hint = 'no_teams';
  end if;

  new.team_id := v_team_id;
  return new;
end;
$$;

comment on function public.assign_team_on_approval() is
  '#99: puts a student who is being approved in a team with the fewest students (ties at random), under one transaction-level advisory lock. Raises with hint ''no_teams'' when there is no team.';

revoke all on function public.assign_team_on_approval() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trigger.
-- ---------------------------------------------------------------------------

create trigger profiles_assign_team_on_approval
  before update on public.profiles
  for each row
  when (
    new.role = 'student'
    and new.status = 'approved'
    and old.status is distinct from 'approved'
    -- Set once (0002): a student who has a team keeps it.
    and old.team_id is null
    -- A client never chooses; a trusted caller may.
    and (new.team_id is null or current_user in ('authenticated', 'anon'))
  )
  execute function public.assign_team_on_approval();

comment on trigger profiles_assign_team_on_approval on public.profiles is
  '#99: at approval the database chooses the student''s team. A team sent by a client role is ignored; the service role may set one itself.';
