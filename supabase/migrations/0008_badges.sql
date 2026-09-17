-- 0008_badges.sql
-- Story 4-2: Badges
--
-- Second trigger-written derived table in this codebase (ARCHITECTURE-
-- SPINE.md AD-3, CAP-5), following 0007_streaks.sql's precedent:
--
--   1. badges_earned (Code Map) -- one row per (student, badge_type,
--      milestone) ever crossed, unique on that triple so a re-fired
--      recompute is a no-op via ON CONFLICT DO NOTHING, never updated or
--      deleted once inserted (Always boundary).
--   2. badge_milestone_thresholds seeded into app_settings, exactly
--      mirroring streak_grace_weeks (0007) / homework_lookahead_days
--      (0004_homework.sql:103-109) -- a single admin-configurable JSON array
--      applying to both counts, defaulting to a curated ascending list
--      ([1, 5, 10, 25, 50, 100], decision resolved 2026-09-17), never a
--      uniform step.
--   3. recompute_student_badges(): a SECURITY DEFINER function that fully
--      recomputes one student's lifetime total for ONE badge_type from
--      source history on every call (never an incremental counter, same
--      reasoning as recompute_student_streak's backdated-insert handling) --
--      full recompute is correct under backfill (a late-arriving or
--      backdated attendance/homework row is never miscounted from stale
--      state) and cheap at this app's data scale (a single student's
--      lifetime attendance/homework-done history, one COUNT DISTINCT query),
--      exactly the trade-off Story 4-1's own spec states for
--      recompute_student_streak. It then iterates the fixed threshold array
--      (never a modulo/multiples calculation) inserting every milestone <=
--      that total not already present -- this is what gives a student with
--      substantial pre-existing history every already-crossed milestone in a
--      single catch-up recompute (I/O matrix).
--   4. trg_recompute_student_badges(): the AFTER INSERT trigger function on
--      both attendance_records (present = true) and homework_status_history
--      (status = 'done'), narrow WHEN clauses from the start (applying
--      Story 4-1's own review finding proactively, per Boundaries) --
--      wrapped in BEGIN...EXCEPTION WHEN OTHERS so a bug here can never
--      block the underlying insert it fired on, exactly like
--      trg_recompute_student_streak.
--   5. RLS: is_admin() or student_id = auth.uid() ONLY -- no teacher access
--      (Boundaries: "visible only on the student's own profile", unlike
--      streaks' three-way admin/teacher/student shape). Nearest structural
--      precedent for two separate-but-equivalent SELECT policies is
--      profiles_select_own/profiles_select_admin (0001_init.sql:171-177),
--      functionally OR'd the same way here as a single USING clause.
--
-- Counting rule (Always boundary, same distinct-pair discipline
-- recompute_student_streak already established): attendance counts
-- count(distinct session_date) -- attendance_records has no uniqueness
-- constraint on (student_id, session_date), so duplicate marks for the same
-- date must collapse to one. Homework counts count(distinct instance_id)
-- among status = 'done' rows -- a self-mark and a teacher on-behalf-of mark
-- for the same instance are two history rows but one logical completion.
-- Both existing indexes this recompute reads through --
-- attendance_records_student_session_idx and
-- homework_status_history_student_status_idx -- were already added by
-- 0007_streaks.sql, so no new index is needed here.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.badges_earned (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  badge_type text not null check (badge_type in ('attendance', 'homework')),
  milestone integer not null,
  earned_at timestamptz not null default now(),
  unique (student_id, badge_type, milestone)
);

comment on table public.badges_earned is
  'Trigger-written derived table (AD-3, CAP-5) -- never written directly by the client. One row per lifetime-count milestone a student has crossed for a given badge_type (''attendance'' = distinct session_date present=true count, ''homework'' = distinct instance_id status=''done'' count). A row is never updated or deleted once inserted (Always boundary). Visible only to the student themself and admin (Boundaries) -- unlike student_streaks, teachers have no read access here.';

comment on column public.badges_earned.milestone is
  'The threshold value (from app_settings.badge_milestone_thresholds at the time it was crossed) that this badge marks -- e.g. 5, 10, 25. Not recomputed if the setting later changes (same "applies only to future recomputes" behavior as streak_grace_weeks).';

-- ---------------------------------------------------------------------------
-- app_settings seed: badge milestone thresholds (Epic 4 context /
-- ARCHITECTURE-SPINE.md Consistency Conventions: admin-tunable, never
-- hardcoded). Mirrors streak_grace_weeks (0007_streaks.sql:63-69) /
-- homework_lookahead_days (0004_homework.sql:103-109) exactly, including the
-- idempotent `on conflict (key) do nothing` so it survives `supabase db
-- reset`. No admin screen edits this -- DB-only configuration (Never
-- boundary), same as those two settings.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'badge_milestone_thresholds',
  '[1, 5, 10, 25, 50, 100]'::jsonb,
  'Ascending, curated list of lifetime-count milestones (widening gaps as the count grows, not a uniform step) at which a student earns a badge. Applies to both the attendance count and the homework-done count independently. DB-only configuration -- no admin UI edits this, same precedent as streak_grace_weeks/homework_lookahead_days.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- recompute_student_badges(): the full-recompute core for ONE badge_type.
--
-- Always fully recomputes the student's lifetime total for the given
-- badge_type from source history (never an incremental counter) -- the same
-- reasoning as recompute_student_streak: this codebase already supports
-- backdated "catch-up" attendance inserts, which an incremental model would
-- silently miscount. Reads badge_milestone_thresholds fresh on every call so
-- a later admin change to the array takes effect on the next qualifying
-- write, without retroactively rewriting badges already inserted under an
-- older threshold list.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_student_badges(p_student_id uuid, p_badge_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  thresholds jsonb;
  current_total integer;
  threshold_value integer;
begin
  select value
  into thresholds
  from public.app_settings
  where key = 'badge_milestone_thresholds';

  -- Defensive fallback if the seed row is ever missing, not a JSON array, or
  -- a valid-but-empty array (which would otherwise mean no badge is ever
  -- awarded to anyone) -- mirrors recompute_student_streak's clamp against a
  -- misconfigured streak_grace_weeks value, never letting bad app_settings
  -- configuration silently disable badge awarding or crash the trigger that
  -- calls this function.
  if thresholds is null or jsonb_typeof(thresholds) <> 'array' or jsonb_array_length(thresholds) = 0
  then
    thresholds := '[1, 5, 10, 25, 50, 100]'::jsonb;
  end if;

  if p_badge_type = 'attendance' then
    -- Distinct session_date, present=true -- collapses a duplicate mark for
    -- the same date before counting (Always boundary: never raw row counts,
    -- since attendance_records has no uniqueness constraint on
    -- (student_id, session_date)).
    select count(distinct session_date)
    into current_total
    from public.attendance_records
    where student_id = p_student_id and present = true;
  elsif p_badge_type = 'homework' then
    -- Distinct instance_id among status='done' rows -- collapses a
    -- duplicate self+teacher done mark for the same instance before
    -- counting (Always boundary).
    select count(distinct instance_id)
    into current_total
    from public.homework_status_history
    where student_id = p_student_id and status = 'done';
  else
    -- Never reached by the two triggers below (each hardcodes its own
    -- badge_type) -- defensive against a future direct call with something
    -- else.
    return;
  end if;

  -- Iterate the fixed, small threshold array in order (never a
  -- modulo/multiples calculation, per Boundaries) and insert every
  -- milestone <= the current total that isn't already present. A student
  -- with substantial pre-existing history therefore gets every
  -- already-crossed milestone in this single recompute (I/O matrix
  -- "catch-up" case), and ON CONFLICT DO NOTHING makes a re-fire with an
  -- unchanged or already-passed total a true no-op.
  for threshold_value in
    select (elem)::integer
    from jsonb_array_elements_text(thresholds) as elem
  loop
    if threshold_value <= coalesce(current_total, 0) then
      insert into public.badges_earned (student_id, badge_type, milestone)
      values (p_student_id, p_badge_type, threshold_value)
      on conflict (student_id, badge_type, milestone) do nothing;
    end if;
  end loop;
end;
$$;

comment on function public.recompute_student_badges(uuid, text) is
  'Full recompute (Always boundary: never an incremental counter) of one student''s lifetime badge_type count and any newly-crossed milestone(s). SECURITY DEFINER so it can write badges_earned without a client-facing INSERT/UPDATE policy ever existing on that table (AD-3: trigger-written only). Called only from trg_recompute_student_badges() below.';

-- ---------------------------------------------------------------------------
-- Trigger function: exception-isolated so a bug here can never block the
-- attendance_records/homework_status_history insert that fired it (Always
-- boundary), exactly matching trg_recompute_student_streak's shape.
-- Determines which badge_type to recompute from the firing table, since a
-- single shared trigger function (matching 0007's precedent of reusing one
-- trigger function for both source tables) needs to know which count
-- changed.
-- ---------------------------------------------------------------------------

create or replace function public.trg_recompute_student_badges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_badge_type text;
begin
  if TG_TABLE_NAME = 'attendance_records' then
    v_badge_type := 'attendance';
  else
    v_badge_type := 'homework';
  end if;

  begin
    perform public.recompute_student_badges(new.student_id, v_badge_type);
  exception when others then
    raise warning 'recompute_student_badges failed for student % (badge_type %): %',
      new.student_id, v_badge_type, sqlerrm;
  end;
  return new;
end;
$$;

comment on function public.trg_recompute_student_badges() is
  'AFTER INSERT trigger target for both attendance_records (present = true) and homework_status_history (status = ''done''). Wraps the recompute call in BEGIN...EXCEPTION WHEN OTHERS so a bug here can never roll back or block the source-table insert (Always boundary) -- the only failure mode is a missed badge award plus a logged warning, never a lost attendance/homework write.';

-- Narrow WHEN clauses from the start (Boundaries: applying Story 4-1's own
-- review finding proactively, not added later as a patch) -- an absent
-- attendance mark or a non-''done'' homework transition can never change
-- either count, so both are skipped entirely rather than run as a no-op.
create trigger attendance_records_recompute_badges
  after insert on public.attendance_records
  for each row
  when (new.present = true)
  execute function public.trg_recompute_student_badges();

create trigger homework_status_history_recompute_badges
  after insert on public.homework_status_history
  for each row
  when (new.status = 'done')
  execute function public.trg_recompute_student_badges();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- is_admin() or student_id = auth.uid() ONLY (Boundaries: "visible only on
-- the student's own profile" -- no teacher access, unlike student_streaks'
-- three-way admin/teacher/student shape). No INSERT/UPDATE/DELETE policy --
-- trigger-written only by absence, matching student_streaks; a direct
-- client write attempt is rejected by RLS (recompute_student_badges() is
-- itself SECURITY DEFINER, owned by the migration role, which bypasses RLS
-- on the tables it writes -- the same mechanism 0007/0001 already rely on).
-- ---------------------------------------------------------------------------

alter table public.badges_earned enable row level security;

create policy "badges_earned_select_admin_or_own"
  on public.badges_earned for select
  using (
    public.is_admin()
    or student_id = auth.uid()
  );
