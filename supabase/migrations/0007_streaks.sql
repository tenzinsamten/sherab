-- 0007_streaks.sql
-- Story 4-1: Streaks
--
-- First trigger-written *aggregate* derived table in this codebase
-- (ARCHITECTURE-SPINE.md AD-3, CAP-4). handle_new_user() (0001) is a 1:1
-- insert trigger, not an aggregate recompute -- there is no existing
-- precedent to extend, so this migration authors the pattern fresh:
--
--   1. student_streaks (Code Map) -- one row per student, upserted via
--      ON CONFLICT (student_id) DO UPDATE, mirroring the app_settings seed
--      pattern's idempotency.
--   2. streak_grace_weeks seeded into app_settings, exactly mirroring
--      homework_lookahead_days (0004_homework.sql:103-109).
--   3. recompute_student_streak(): a SECURITY DEFINER function that fully
--      recomputes a student's streak from source history on every call --
--      never an incremental counter (Always boundary), because this
--      codebase already supports backdated "catch-up" attendance inserts
--      landing on their true session week (0003:64's documented intent),
--      which an incremental model would silently miscount under a
--      late-arriving backdated row.
--   4. trg_recompute_student_streak(): the AFTER INSERT trigger function on
--      both attendance_records (every insert) and homework_status_history
--      (status = 'done' inserts only -- an 'assigned'/'reviewed' row can
--      never change a qualifying week), wrapping the recompute call in
--      BEGIN...EXCEPTION WHEN OTHERS so a bug in this first-of-its-kind
--      trigger can never block the underlying insert it fired on.
--   5. RLS mirroring homework_status_history's three-way shape (0004:257-263).
--
-- Week bucketing: a "week" is date_trunc('week', d)::date (the Monday of the
-- ISO week containing plain date d) applied to attendance_records.session_date
-- for attendance and homework_instances.period_start (joined via
-- homework_status_history.instance_id) for homework -- never recorded_at, so
-- no timezone conversion is ever needed to decide which week a row belongs
-- to (Always boundary).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.student_streaks (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  current_streak integer not null default 0,
  last_qualifying_week date,
  updated_at timestamptz not null default now()
);

comment on table public.student_streaks is
  'Trigger-written derived table (AD-3, CAP-4) -- never written directly by the client. current_streak = consecutive calendar weeks (attendance present=true AND homework marked Done, both required) counting back from the most recent qualifying week, tolerating up to app_settings.streak_grace_weeks consecutive real (non-holiday) misses before the walk stops. A week where the whole class held zero attendance_records rows (no session, e.g. a holiday) is excluded from grace consumption entirely -- distinct from an individual student''s own absence in a week the class did meet, which does consume grace. Fully recomputed from source history on every trigger fire (see recompute_student_streak()), never an incremental counter.';

comment on column public.student_streaks.last_qualifying_week is
  'The Monday of the most recent week (date_trunc(''week'', ...)) in which this student satisfied both conditions -- null if the student has never qualified, or if the streak has fully expired (see recompute_student_streak()).';

-- ---------------------------------------------------------------------------
-- app_settings seed: streak grace period (Epic 4 context / ARCHITECTURE-
-- SPINE.md Consistency Conventions: admin-tunable, never hardcoded). Mirrors
-- homework_lookahead_days (0004_homework.sql:103-109) exactly, including the
-- idempotent `on conflict (key) do nothing` so it survives `supabase db
-- reset`. No admin screen edits this -- DB-only configuration, same as
-- homework_lookahead_days (Never boundary).
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'streak_grace_weeks',
  '{"weeks": 2}'::jsonb,
  'How many consecutive qualifying-free weeks (attendance present AND homework Done both required) a student may miss before their streak resets to 0. A week where the whole class held zero attendance sessions (e.g. a holiday) is excluded from this count entirely -- only a week the class actually met, that the student missed, consumes grace.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Supporting indexes (Code Map)
--
-- attendance_records already has attendance_records_student_recorded_idx
-- (student_id, recorded_at desc) (0003:66-67) -- sorted by recorded_at, not
-- session_date, which is what the recompute below actually buckets by.
-- homework_status_history is only indexed on (instance_id, student_id)
-- (0004:84-85) -- the recompute instead starts from student_id (and status),
-- then joins outward to homework_instances via instance_id. attendance_
-- records_class_id_idx (0003:71-72) supports the class_session_weeks
-- query's WHERE class_id filter, but not an index-only fetch of
-- session_date -- the composite index below covers both.
-- ---------------------------------------------------------------------------

create index attendance_records_student_session_idx
  on public.attendance_records (student_id, session_date);

create index attendance_records_class_session_idx
  on public.attendance_records (class_id, session_date);

create index homework_status_history_student_status_idx
  on public.homework_status_history (student_id, status);

-- ---------------------------------------------------------------------------
-- recompute_student_streak(): the full-recompute core.
--
-- Algorithm (single backward walk, unified for both "has the streak expired
-- since the most recent qualifying week" and "how far back does the
-- qualifying run extend" -- there is no separate incremental state, so both
-- questions are answered by the same walk):
--
--   1. Build the student's set of qualifying weeks: weeks present in BOTH
--      the distinct-(student_id, session_date) present=true attendance weeks
--      AND the distinct-(student_id, instance_id) done-pair homework weeks
--      (never raw row counts -- Always boundary; a duplicate self+teacher
--      done mark for the same instance collapses to the same instance_id,
--      and therefore the same period_start week, before this set is built).
--   2. Build the set of weeks the whole class held at least one session
--      (any attendance_records row for class_id, any student, any present
--      value) -- a week absent from this set is a class-wide holiday,
--      excluded from grace consumption entirely.
--   3. Walk backward one week at a time starting at *today's* week (not the
--      most recent qualifying week) -- this is what lets the walk detect
--      "the most recent qualifying week is now too stale" (I/O matrix:
--      misses more than grace -> resets to 0) using the exact same gap
--      counter that also tolerates a single short gap inside an
--      already-found run (I/O matrix: misses fewer than grace -> preserved).
--      A week outside the class-session set is skipped with no effect on
--      the gap counter at all. A qualifying week increments current_streak
--      and resets the gap counter to 0. Any other (real, class-met) week
--      increments the gap counter; once the gap counter exceeds
--      streak_grace_weeks, the walk stops -- whatever was accumulated so far
--      is the final current_streak (0 if no qualifying week was ever
--      reached before the walk stopped, which is exactly the "resets to 0"
--      case, since the gap between the last true qualifying week and today
--      exceeded grace before the walk ever got there).
--   4. Upsert the result -- ON CONFLICT (student_id) DO UPDATE, mirroring
--      the app_settings seed pattern's idempotency. A student's first-ever
--      qualifying week naturally yields current_streak = 1 (the loop
--      increments before ever exiting on that iteration), never 0.
--
-- A max-iteration backstop (max_weeks_back) exists purely as a defensive
-- bound in case class_session_weeks is ever empty (e.g. a homework-only
-- trigger fires before the class has any attendance_records row at all) --
-- ordinarily the walk exits as soon as it passes the class's earliest
-- recorded session week.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_student_streak(p_student_id uuid, p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  grace_weeks integer;
  attendance_weeks date[];
  homework_weeks date[];
  class_session_weeks date[];
  qualifying_weeks date[];
  earliest_class_week date;
  cursor_week date;
  gap_count integer := 0;
  computed_streak integer := 0;
  computed_last_qualifying date := null;
  iterations integer := 0;
  max_weeks_back constant integer := 2600; -- ~50 years of weeks; safety backstop only, generous since the cost of raising it is free
begin
  select (value ->> 'weeks')::integer
  into grace_weeks
  from public.app_settings
  where key = 'streak_grace_weeks';

  -- Clamped to >= 0 -- a misconfigured negative value here must never make
  -- gap_count's first real miss (gap_count = 1 > grace_weeks) exit the walk
  -- more eagerly than an ordinary grace = 0 would (i.e. never worse than "no
  -- grace at all"), so every stored streak stays a legitimate consecutive
  -- run even under bad app_settings input.
  grace_weeks := greatest(coalesce(grace_weeks, 2), 0);

  -- Distinct (student_id, session_date) present=true rows -> their week
  -- buckets. The inner "distinct session_date" collapses a duplicate mark
  -- for the same date before bucketing (Always boundary: never raw row
  -- counts).
  select coalesce(array_agg(distinct date_trunc('week', ar.session_date)::date), array[]::date[])
  into attendance_weeks
  from (
    select distinct session_date
    from public.attendance_records
    where student_id = p_student_id and present = true
  ) ar;

  -- Distinct (student_id, instance_id) done pairs -> their instance's
  -- period_start week bucket. The inner distinct collapses a duplicate
  -- self+teacher done mark for the same instance before this ever reaches
  -- the join (Always boundary).
  select coalesce(array_agg(distinct date_trunc('week', hi.period_start)::date), array[]::date[])
  into homework_weeks
  from (
    select distinct hsh.instance_id
    from public.homework_status_history hsh
    where hsh.student_id = p_student_id and hsh.status = 'done'
  ) done_pairs
  join public.homework_instances hi on hi.id = done_pairs.instance_id;

  select array(
    select unnest(attendance_weeks)
    intersect
    select unnest(homework_weeks)
  )
  into qualifying_weeks;

  -- Any attendance_records row for this class, any student, any present
  -- value -- a teacher only marks attendance when a session actually
  -- happened, so a week with zero such rows is a class-wide holiday.
  select coalesce(array_agg(distinct date_trunc('week', session_date)::date), array[]::date[])
  into class_session_weeks
  from public.attendance_records
  where class_id = p_class_id;

  select min(w) into earliest_class_week from unnest(class_session_weeks) as w;

  if array_length(qualifying_weeks, 1) is not null then
    -- UTC-pinned (Consistency Conventions: all timestamps UTC), not the
    -- session's/connection's local `current_date`, so "today's week" is
    -- computed identically regardless of the calling role/session's
    -- timezone setting.
    cursor_week := date_trunc('week', (now() at time zone 'utc')::date)::date;

    loop
      iterations := iterations + 1;
      exit when iterations > max_weeks_back;
      exit when earliest_class_week is not null and cursor_week < earliest_class_week;

      if cursor_week = any (class_session_weeks) then
        if cursor_week = any (qualifying_weeks) then
          computed_streak := computed_streak + 1;
          gap_count := 0;
          if computed_last_qualifying is null then
            computed_last_qualifying := cursor_week;
          end if;
        else
          gap_count := gap_count + 1;
          exit when gap_count > grace_weeks;
        end if;
      end if;
      -- else: class-wide holiday week -- excluded from grace consumption
      -- entirely, no effect on gap_count or computed_streak.

      cursor_week := cursor_week - 7;
    end loop;
  end if;

  insert into public.student_streaks (student_id, class_id, current_streak, last_qualifying_week, updated_at)
  values (p_student_id, p_class_id, computed_streak, computed_last_qualifying, now())
  on conflict (student_id) do update
    set class_id = excluded.class_id,
        current_streak = excluded.current_streak,
        last_qualifying_week = excluded.last_qualifying_week,
        updated_at = now();
end;
$$;

comment on function public.recompute_student_streak(uuid, uuid) is
  'Full recompute (Always boundary: never an incremental counter) of one student''s streak from attendance_records/homework_status_history. SECURITY DEFINER so it can write student_streaks without a client-facing INSERT/UPDATE policy ever existing on that table (AD-3: trigger-written only). Called only from trg_recompute_student_streak() below.';

-- ---------------------------------------------------------------------------
-- Trigger function: exception-isolated so a bug in this first-of-its-kind
-- trigger can never block the attendance_records/homework_status_history
-- insert that fired it (Always boundary).
-- ---------------------------------------------------------------------------

create or replace function public.trg_recompute_student_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.recompute_student_streak(new.student_id, new.class_id);
  exception when others then
    raise warning 'recompute_student_streak failed for student % (class %): %',
      new.student_id, new.class_id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function public.trg_recompute_student_streak() is
  'AFTER INSERT trigger target for both attendance_records and homework_status_history. Wraps the recompute call in BEGIN...EXCEPTION WHEN OTHERS so a bug here can never roll back or block the source-table insert (Always boundary) -- the only failure mode is a stale student_streaks row plus a logged warning, never a lost attendance/homework write.';

create trigger attendance_records_recompute_streak
  after insert on public.attendance_records
  for each row execute function public.trg_recompute_student_streak();

-- Only a 'done' insert can ever change qualifying_weeks (recompute_student_
-- streak's homework_weeks query filters on status = 'done') -- an 'assigned'
-- or 'reviewed' insert can never affect the streak, so this WHEN clause
-- skips the recompute entirely for those rather than running it as a no-op.
create trigger homework_status_history_recompute_streak
  after insert on public.homework_status_history
  for each row
  when (new.status = 'done')
  execute function public.trg_recompute_student_streak();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Mirrors homework_status_history's three-way shape exactly (0004:257-263):
-- admin, any teacher assigned to the student's class, or the student
-- themself (decision, resolved 2026-09-17: not student-only). No INSERT/
-- UPDATE/DELETE policy -- trigger-written only by absence, matching every
-- other append/derived-table pattern in this codebase; a direct client
-- write attempt is rejected by RLS (recompute_student_streak() itself is
-- SECURITY DEFINER, owned by the migration role, which bypasses RLS on the
-- tables it writes -- the same mechanism 0001's handle_new_user() already
-- relies on).
-- ---------------------------------------------------------------------------

alter table public.student_streaks enable row level security;

create policy "student_streaks_select_admin_teacher_or_own"
  on public.student_streaks for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or student_id = auth.uid()
  );
