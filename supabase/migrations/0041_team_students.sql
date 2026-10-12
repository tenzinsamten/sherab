-- 0041_team_students.sql
--
-- #97: a page per team that lists the team's students by name.
--
-- Who may see a team's students is decided here, not by the page:
--   * the admin;
--   * any teacher (profiles.role = 'teacher');
--   * any approved student;
--   * an approved parent, only for a team one of their own approved
--     children is in (is_parent_of(), 0024).
-- Everyone else -- a pending or rejected student, a parent who is not
-- approved, a parent of no child in the team, a caller without a session --
-- is refused.
--
-- * can_view_team(p_team_id): the rule above, as a boolean. For the admin, a
--   teacher and an approved student it does not look at the team at all, so
--   it is also true for an id that is no team; team_students() then returns
--   no row. A parent gets false for such an id.
-- * viewable_team_ids(): the teams the caller may open, so the pages know
--   where a team's name is a link (a parent on the leaderboard gets their
--   children's teams only).
-- * team_students(p_team_id): the team's names in every language and its
--   approved students' names, sorted. One row per student; a team without
--   students gives one row with a null student_name; an unknown team gives
--   no row; a caller who may not see the team is refused with 42501.
--   Nothing else about a student is returned (no id, class, streak).
--
-- No table, policy or existing function changes: class_people() (0025) keeps
-- hiding classmates from parents, and team_leaderboard() keeps returning
-- team totals only.

-- ---------------------------------------------------------------------------
-- can_view_team(team_id)
-- ---------------------------------------------------------------------------

create or replace function public.can_view_team(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('admin', 'teacher')
          or (me.role = 'student' and me.status = 'approved')
        )
    )
    or exists (
      select 1
      from public.profiles child
      where child.team_id = p_team_id
        and public.is_parent_of(child.id)
    );
$$;

comment on function public.can_view_team(uuid) is
  '#97: true when the caller may see the team''s students -- the admin, a teacher, an approved student, or an approved parent with an approved child in the team. For the first three it is true for any id, also one that is no team (team_students() then returns no row).';

revoke all on function public.can_view_team(uuid) from public, anon;
grant execute on function public.can_view_team(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- viewable_team_ids(): the teams the caller may open.
-- ---------------------------------------------------------------------------

create or replace function public.viewable_team_ids()
returns table (team_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select t.id
  from public.teams t
  where public.can_view_team(t.id);
$$;

comment on function public.viewable_team_ids() is
  '#97: the teams whose students the caller may see (can_view_team). Empty for a caller who may see none.';

revoke all on function public.viewable_team_ids() from public, anon;
grant execute on function public.viewable_team_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- team_students(team_id): the team's names and its approved students' names.
-- ---------------------------------------------------------------------------

create or replace function public.team_students(p_team_id uuid)
returns table (
  team_name text,
  team_name_bo text,
  team_name_de text,
  student_name text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.can_view_team(p_team_id) then
    raise exception 'not allowed to list the students of team %', p_team_id
      using errcode = '42501';
  end if;

  return query
  select t.name,
         t.name_bo,
         t.name_de,
         -- The name shown for a student elsewhere (class_people, 0025).
         case when p.id is null then null
              else coalesce(p.display_name, p.registration_name, '')
         end
  from public.teams t
  left join public.profiles p
    on p.team_id = t.id
    and p.role = 'student'
    and p.status = 'approved'
  where t.id = p_team_id
  order by lower(coalesce(p.display_name, p.registration_name, '')),
           coalesce(p.display_name, p.registration_name, ''),
           p.id;
end;
$$;

comment on function public.team_students(uuid) is
  '#97: a team''s names in every language and its approved students'' names, sorted by name. One row per student; one row with a null student_name for a team without students; no row for an unknown team. Refuses (42501) a caller for whom can_view_team() is false. Names only -- no student id, class or result.';

revoke all on function public.team_students(uuid) from public, anon;
grant execute on function public.team_students(uuid) to authenticated, service_role;
