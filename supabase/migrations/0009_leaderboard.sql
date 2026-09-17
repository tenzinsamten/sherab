-- 0009_leaderboard.sql
-- Story 4-3: Team leaderboard
--
-- The leaderboard's rank is deliberately NOT a stored/materialized sum
-- (ARCHITECTURE-SPINE.md Structural Seed, Epic 4 context Technical
-- Decisions) -- it's a read-time SUM of student_streaks.current_streak per
-- team, so a student's streak change or a team-assignment edit is reflected
-- on the very next read without any owner having to keep an aggregate in
-- sync. team_leaderboard() is the sole read path for that aggregate.
--
-- Shape mirrors the codebase's existing SECURITY DEFINER read-function
-- precedent exactly: is_targeted_for_homework_instance()
-- (0004_homework.sql:135-148, `language sql security definer stable`) for
-- the function signature/attributes, and validate_class_code()
-- (0002_student_registration.sql:183-198) for the "returns table(...),
-- grant execute to a role" shape. Unlike validate_class_code (explicit grant
-- to anon, authenticated -- a deliberate pre-session lookup for the join
-- wizard), this only grants authenticated, matching the Always boundary
-- ("GRANT EXECUTE ... TO authenticated only") and every other function in
-- this codebase's grant shape. Note this project's default privileges
-- already grant EXECUTE on every new public-schema function to anon as well
-- (confirmed empirically against is_admin()/recompute_student_streak(),
-- neither of which grants anon anything explicitly either) -- so, as with
-- every other function here, this GRANT line documents intent/precedent
-- shape rather than being the actual anon-blocking mechanism; the real
-- barrier keeping an unauthenticated visitor off this data is the route
-- layer (src/routes/leaderboard/+page.server.ts redirects to /login without
-- a session) -- consistent with AD-2 treating RLS/grants as the
-- authorization boundary for authenticated roles, not as an anon firewall,
-- and with this function exposing no PII regardless (team-level sums only).
--
-- Scope of the SUM (Always boundary): profiles.role = 'student' AND
-- profiles.status = 'approved' AND profiles.team_id IS NOT NULL -- the same
-- approved-student gate teacher/classes/[id]/+page.server.ts:64-65 already
-- uses for roster reads. A student with a streak but no team assignment is
-- therefore excluded from every team's sum entirely (I/O matrix), and an
-- unapproved/pending/rejected student never contributes regardless of
-- team_id. LEFT JOINed from teams (not an inner join) so a team with zero
-- qualifying students still appears, with COALESCE(SUM(...), 0) giving it an
-- explicit 0 rather than being dropped from the result set (I/O matrix:
-- "Team with no approved students / no streak rows"). student_streaks is
-- itself LEFT JOINed from profiles (not every approved student has ever
-- triggered a recompute, per shapeStudentStreak's null-row precedent in
-- Story 4-1) -- a student with no student_streaks row contributes 0, not
-- NULL, to their team's SUM.
--
-- Ordered total_streak DESC, team_name ASC (Always boundary) -- the
-- team_name ASC tie-break is what makes repeated loads of a genuine tie
-- deterministic (I/O matrix: "Tied totals").

create or replace function public.team_leaderboard()
returns table (team_id uuid, team_name text, total_streak integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id as team_id,
    t.name as team_name,
    -- SUM(integer) defaults to bigint in Postgres, but student_streaks.
    -- current_streak is itself `integer` (0007_streaks.sql) -- a per-team
    -- sum can never legitimately exceed that range, so this is cast back
    -- down to integer rather than widening the return type, keeping this
    -- function's declared column type and the generated TS RPC type
    -- (database.types.ts) genuinely in agreement instead of `number` merely
    -- happening to also fit a bigint at this app's scale.
    coalesce(sum(ss.current_streak), 0)::integer as total_streak
  from public.teams t
  left join public.profiles p
    on p.team_id = t.id
    and p.role = 'student'
    and p.status = 'approved'
  left join public.student_streaks ss
    on ss.student_id = p.id
  group by t.id, t.name
  order by total_streak desc, t.name asc;
$$;

comment on function public.team_leaderboard() is
  'Read-time aggregate (never stored/materialized, per Epic 4 context''s explicit decision) -- SUM of student_streaks.current_streak per team, scoped to approved students with a team assigned. SECURITY DEFINER so it can read across every student''s student_streaks row (bypassing that table''s own admin/teacher/own-row RLS by design, same precedent as validate_class_code) without exposing any individual student''s streak value through this function''s return shape -- only the per-team total. Every team appears even with a zero total (LEFT JOIN + COALESCE); ordered total_streak DESC, team_name ASC for a deterministic tie-break.';

grant execute on function public.team_leaderboard() to authenticated;
