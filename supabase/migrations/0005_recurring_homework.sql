-- 0005_recurring_homework.sql
-- Story 3-2: Recurring Homework Assignments
--
-- Extends Story 3-1's homework_assignments/homework_instances/
-- homework_status_history model directly (Cross-Story Dependencies: "must
-- not special-case recurring instances in a way that breaks 3-1's
-- Done/Reviewed reads, and editing or ending a recurring series must never
-- touch past instances"). No new tables -- recurrence is expressed entirely
-- as new columns on homework_assignments plus a trusted generator function
-- that writes homework_instances/homework_status_history the exact same
-- shape Story 3-1's client-side createAssignment already writes for the
-- one-off case.
--
-- Three additions (Code Map):
--   1. New homework_assignments columns (recurrence_start_date,
--      due_offset_days, ends_on, paused_at) + a shape CHECK constraint that
--      enforces the Never boundary ("recurrence_rule.frequency only ever
--      accepts 'weekly'") at the DB level, not just app validation.
--   2. generate_recurring_homework_instances(): a SECURITY DEFINER function,
--      scheduled via pg_cron, that is the *only* path by which a recurring
--      assignment's homework_instances rows ever get created (AD-8) -- never
--      a direct client insert, matching Story 3-1's RLS restriction exactly
--      as-is (Boundaries: "this story adds the trusted generator, never a
--      client-side bypass").
--   3. Closes the deferred Story 3-1 gap on homework_instances_update_admin_
--      or_assigned_teacher: that policy's USING/WITH CHECK never restricted
--      *which columns* an authorized teacher could UPDATE (only archived_at/
--      archived_by are meant to be client-writable) -- column-level GRANT/
--      REVOKE closes it, independently of RLS's row-level check.

-- ---------------------------------------------------------------------------
-- homework_assignments: recurrence columns
--
-- recurrence_rule (Story 3-1) stays the single "is this a series?" signal:
-- NULL = one-off, non-NULL = recurring. The new columns below only ever
-- carry a value when recurrence_rule is set -- the CHECK constraint enforces
-- that shape unconditionally, not just as an app-level convention.
--
-- due_offset_days is genuinely new state (Story 3-1 had no such column --
-- period_start and due_date were both just the teacher-chosen date for a
-- one-off instance). Recurring instances instead have their due_date
-- computed once at generation time as period_start + due_offset_days
-- (Intent: "due_offset_days changes only affect instances not yet
-- generated, since due_date is computed once at generation time") -- editing
-- this column on homework_assignments therefore can never retroactively
-- change an already-generated instance's due_date, by construction: the
-- generator only ever reads it at INSERT time, never again.
-- ---------------------------------------------------------------------------

alter table public.homework_assignments
  add column recurrence_start_date date,
  add column due_offset_days integer,
  add column ends_on date,
  add column paused_at timestamptz;

comment on column public.homework_assignments.recurrence_start_date is
  'First period_start of the series (only set when recurrence_rule is not null). The generator walks forward from here in 7-day steps -- see generate_recurring_homework_instances().';
comment on column public.homework_assignments.due_offset_days is
  'Days after a generated instance''s period_start that it is due (due_date = period_start + due_offset_days). Read fresh by the generator at each instance''s creation time only -- editing it later never touches already-generated instances (Intent).';
comment on column public.homework_assignments.ends_on is
  'If set, the generator stops creating instances whose period_start would fall after this date -- the endSeries action''s target column. Already-generated instances (even ones with a due_date past this) are never touched (Never boundary).';
comment on column public.homework_assignments.paused_at is
  'If set, the generator skips this assignment entirely regardless of ends_on -- the pauseSeries action''s target column. No resume path exists in this story (Boundaries/Tasks scope this to weekly-only, pause/end, nothing more) -- unpausing is out of scope, left for a future story.';

alter table public.homework_assignments
  add constraint homework_assignments_recurrence_shape check (
    (
      recurrence_rule is null
      and recurrence_start_date is null
      and due_offset_days is null
      and ends_on is null
      and paused_at is null
    )
    or (
      recurrence_rule is not null
      and recurrence_rule ->> 'frequency' = 'weekly'
      and recurrence_start_date is not null
      and due_offset_days is not null
      and due_offset_days >= 0
      and due_offset_days <= 365
    )
  );

comment on constraint homework_assignments_recurrence_shape on public.homework_assignments is
  'DB-level enforcement of the Never boundary ("recurrence_rule.frequency only ever accepts weekly this story") plus the structural requirement that a series always carries a start date and offset, and a one-off assignment never carries any recurrence-only column -- not just an app-level convention (AD-8''s UNIQUE constraint precedent).';

-- ---------------------------------------------------------------------------
-- homework_assignments: UPDATE policy
--
-- Mirrors Story 3-1's homework_instances_update_admin_or_assigned_teacher
-- (Code Map) for the row-level check. Column-level GRANT/REVOKE below
-- restricts this the same way homework_instances is restricted further
-- down: only the columns the app's own actions actually write
-- (title/reference_link/due_offset_days via editSeries, paused_at via
-- pauseSeries, ends_on via endSeries) are client-writable. class_id/
-- created_by/skill_area and, critically, recurrence_rule/
-- recurrence_start_date are NOT client-writable post-creation -- the shape
-- CHECK constraint alone cannot stop a well-formed direct-API update from
-- setting all four recurrence columns together on a previously one-off
-- assignment, converting it into a live recurring series the app never
-- intended (review finding #1).
-- ---------------------------------------------------------------------------

create policy "homework_assignments_update_admin_or_assigned_teacher"
  on public.homework_assignments for update
  using (public.is_admin() or public.is_teacher_of_class(class_id))
  with check (public.is_admin() or public.is_teacher_of_class(class_id));

revoke update on public.homework_assignments from authenticated;
grant update (title, reference_link, due_offset_days, paused_at, ends_on)
  on public.homework_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Recurring-instance generation
--
-- ARCHITECTURE-SPINE.md: "Recurring-instance generation is the one piece of
-- this epic that is not a DB trigger... it runs as a scheduled function" --
-- this story picks pg_cron (running inside the existing local Postgres
-- instance) over a hosted Supabase Edge Function cron trigger, per this
-- story's own Never boundary ("Do not provision a hosted Supabase cron
-- trigger or Edge Function -- pg_cron runs inside the existing local
-- Postgres instance, consistent with every prior story's 'no production
-- hosting' boundary"). ARCHITECTURE-SPINE.md's own Deferred section left
-- this exact choice open ("an implementation detail for Story 4" [sic,
-- really this story] "not an architectural invariant") -- documented here,
-- not treated as pre-decided, per the epic context's explicit instruction.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

-- SECURITY DEFINER + owned by the migration role (same "bypasses RLS"
-- pattern 0001_init.sql's is_admin()/handle_new_user() already establish) --
-- this is what makes the function a genuinely trusted connection distinct
-- from any client-issued request, not merely "a function a client happens
-- not to be told about." The two inserts below (homework_instances,
-- homework_status_history) therefore never go through RLS at all -- they
-- are authorized by nothing except "this code path is unreachable from any
-- client role" (enforced below via REVOKE EXECUTE), exactly the "trusted
-- connection" AD-8/Story 3-1's RLS comment already anticipates.
create or replace function public.generate_recurring_homework_instances()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row record;
  period date;
  period_iterations integer;
  new_instance_id uuid;
  instances_created integer := 0;
  -- Safety backstop, not a UX decision (review finding #4): caps how many
  -- weekly periods a single run will backfill for one assignment (~2 years).
  -- An assignment with more of a catch-up gap than this just continues
  -- catching up on the next scheduled run -- this only prevents an
  -- unbounded synchronous burst (e.g. from a start date far in the past)
  -- from ballooning or failing one whole cron invocation for every
  -- assignment.
  max_period_iterations constant integer := 104;
begin
  -- "for every homework_assignments row with recurrence_rule IS NOT NULL,
  -- not paused, not past ends_on" (Code Map). ends_on is checked per-period
  -- in the inner loop below (a series can have some already-valid periods
  -- before ends_on and none after -- excluding the whole assignment row
  -- here would also wrongly skip those earlier, still-legitimate periods on
  -- a re-run after a backfill gap).
  for assignment_row in
    select id, class_id, recurrence_start_date, due_offset_days, ends_on
    from public.homework_assignments
    where recurrence_rule is not null
      and paused_at is null
      and recurrence_start_date is not null
      and due_offset_days is not null
  loop
    period := assignment_row.recurrence_start_date;
    period_iterations := 0;

    -- Walks every weekly period from the series' start up through today,
    -- not just "the current one" -- this is deliberate catch-up behavior:
    -- if the generator hasn't run in a while (e.g. the Supabase free-tier
    -- project auto-paused after 7 days idle, AD-6, or a local dev instance
    -- was simply off), a later run still backfills every missed period
    -- rather than silently skipping straight to "now" and losing a week's
    -- assignment, up to max_period_iterations (review finding #4).
    -- UNIQUE(assignment_id, period_start) (AD-8, Story 3-1) plus the ON
    -- CONFLICT DO NOTHING below make every iteration idempotent regardless
    -- of how many times this function runs, and race-safe against a
    -- concurrent invocation racing the same check (review finding #3: a
    -- plain "if not exists(...) then insert" here would be a check-then-act
    -- race whose losing insert raises an uncaught unique-violation that
    -- rolls back this entire function call, including every other
    -- assignment already processed in this run).
    while period <= current_date
      and (assignment_row.ends_on is null or period <= assignment_row.ends_on)
      and period_iterations < max_period_iterations
    loop
      insert into public.homework_instances (assignment_id, class_id, period_start, due_date)
      values (
        assignment_row.id,
        assignment_row.class_id,
        period,
        period + assignment_row.due_offset_days
      )
      on conflict (assignment_id, period_start) do nothing
      returning id into new_instance_id;

      if new_instance_id is not null then
        -- Fresh 'assigned' rows for the then-current approved roster (Code
        -- Map) -- reuses the exact role='student' and status='approved'
        -- pattern 0003/0004 already established for writes, read anew on
        -- every single generation run rather than snapshotted once at
        -- series-creation time, so a student approved after the series
        -- started still gets targeted by every future period.
        -- recorded_by is NULL -- there is no acting user for a time-based,
        -- system-generated row (unlike Story 3-1's teacher-initiated
        -- 'assigned' rows, which always set recorded_by to the creating
        -- teacher).
        insert into public.homework_status_history (
          instance_id, student_id, class_id, status, recorded_by
        )
        select
          new_instance_id,
          p.id,
          assignment_row.class_id,
          'assigned',
          null
        from public.profiles p
        where p.class_id = assignment_row.class_id
          and p.role = 'student'
          and p.status = 'approved';

        instances_created := instances_created + 1;
      end if;

      period := period + 7;
      period_iterations := period_iterations + 1;
    end loop;
  end loop;

  return instances_created;
end;
$$;

comment on function public.generate_recurring_homework_instances() is
  'Trusted-connection generator (AD-8): the only code path that ever inserts a homework_instances row for a recurring assignment (recurrence_rule IS NOT NULL). Scheduled via pg_cron below; EXECUTE is revoked from anon/authenticated (below) so no client role can invoke it directly -- a client-callable SECURITY DEFINER function here would itself be exactly the "client-side bypass" the Never boundary rules out, even though it is not a raw client insert. Returns the count of instances created, for observability/testing.';

-- Revoke both the implicit PUBLIC grant Postgres gives every new function by
-- default, and the explicit per-role grant this project's auto_expose_new_
-- tables setting (supabase/config.toml) gives anon/authenticated/service_role
-- on every new public-schema function -- REVOKE ... FROM PUBLIC alone does
-- NOT undo that second, role-specific grant. service_role is deliberately
-- left untouched: src/lib/server/rls.spec.ts's Story 3-2 tests call this
-- function directly via the existing service-role adminClient, the same
-- "trusted connection" a scheduled pg_cron job (which also runs outside any
-- client role) represents.
revoke execute on function public.generate_recurring_homework_instances() from public;
revoke execute on function public.generate_recurring_homework_instances() from anon, authenticated;

-- Interval choice (documented per epic context instruction, not pre-decided):
-- daily, not weekly-on-Sunday-only and not hourly. Weekly-only risks a
-- single missed run (e.g. the free-tier project auto-pausing after 7 days
-- idle, AD-6) silently delaying a whole week's homework with nothing to
-- notice or correct it until the next scheduled Sunday; hourly is
-- unnecessary churn for a cadence that only ever needs day-level precision
-- (due dates are dates, not timestamps) given this project's usage is
-- weekly-concentrated (Sunday classes) per epic context. Daily also keeps
-- the generator's own catch-up loop above doing at most a handful of
-- iterations even after a multi-day gap, rather than accumulating dozens of
-- unprocessed periods. 03:00 UTC is simply a low-traffic hour; nothing in
-- this project depends on the exact minute. cron.schedule() with a fixed job
-- name is itself idempotent (re-running this migration, e.g. via
-- `supabase db reset`, updates the existing job rather than creating a
-- duplicate one).
select cron.schedule(
  'generate-recurring-homework-instances',
  '0 3 * * *',
  $$select public.generate_recurring_homework_instances();$$
);

-- ---------------------------------------------------------------------------
-- homework_instances: close the deferred Story 3-1 column-privilege gap
--
-- homework_instances_update_admin_or_assigned_teacher (0004) never
-- restricted *which* columns a caller passing its USING/WITH CHECK row-level
-- test could write -- only archived_at/archived_by are meant to be
-- client-writable (Story 3-1's archiving action); due_date/period_start must
-- never be client-settable at all (this story's Always boundary: "Editing a
-- series never UPDATEs homework_instances... due_date is computed once at
-- generation time" -- a column-level write path would be exactly the kind of
-- backdoor that boundary rules out, RLS row-check or not). PostgREST enforces
-- column privileges independently of RLS (a column-level GRANT failure surfaces
-- as its own error, checked before RLS's row-level USING/WITH CHECK is even
-- evaluated for that column) -- no new policy logic needed, per Code Map.
-- ---------------------------------------------------------------------------

revoke update on public.homework_instances from authenticated;
grant update (archived_at, archived_by) on public.homework_instances to authenticated;
