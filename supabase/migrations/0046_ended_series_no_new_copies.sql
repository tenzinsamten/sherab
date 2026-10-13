-- 0046_ended_series_no_new_copies.sql
--
-- #103: an ended weekly homework series makes no new copies.
--
-- Ending a series sets ends_on to today (endSeries). Until now the generator
-- (0005, 0040) still made every week whose start was on or before ends_on,
-- including weeks that had no copy yet when the series was ended. A series
-- created and ended on the same day got its copy from the next nightly run,
-- and the students saw that homework beside the series that replaced it.
--
-- * generate_recurring_homework_for_series(series, today): a series whose
--   ends_on is p_today or earlier is ended and gets nothing -- no catch-up
--   week either. The per-week "period <= ends_on" test is gone: with ends_on
--   after p_today it was always true (the walk stops at p_today). Nothing
--   else in the function changes.
-- * generate_recurring_homework_instances() (nightly) and
--   create_weekly_homework_first_copies() (on creation) are not redefined:
--   both go through the function above, so both stop. The nightly job keeps
--   current_date (UTC); at its time, 03:00 UTC, that is Munich's date, the
--   date endSeries writes to ends_on.
--
-- Copies that already exist are never touched. No data is changed.

-- ---------------------------------------------------------------------------
-- generate_recurring_homework_for_series(series, today)
-- ---------------------------------------------------------------------------

create or replace function public.generate_recurring_homework_for_series(
  p_assignment_id uuid,
  p_today date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row record;
  period date;
  period_iterations integer := 0;
  new_instance_id uuid;
  instances_created integer := 0;
  -- Safety backstop (0005, review finding #4): at most 104 weeks (~2 years)
  -- are walked per call for one series, so a start date far in the past
  -- cannot balloon or fail one call. The walk restarts at the start date on
  -- every call and counts weeks that already exist, so a series whose start
  -- date is more than 104 weeks back never reaches the current week (tracked
  -- in deferred-work.md).
  max_period_iterations constant integer := 104;
begin
  -- Weekly, not paused, with a start date and a due offset, and not ended
  -- (#103): once ends_on is p_today or earlier the series makes nothing,
  -- whichever weeks are still missing. Anything else creates nothing.
  select id, class_id, recurrence_start_date, due_offset_days
  into assignment_row
  from public.homework_assignments
  where id = p_assignment_id
    and recurrence_rule is not null
    and paused_at is null
    and recurrence_start_date is not null
    and due_offset_days is not null
    and (ends_on is null or ends_on > p_today);

  if not found then
    return 0;
  end if;

  period := assignment_row.recurrence_start_date;

  -- Walks every weekly period from the series' start up through p_today,
  -- not just "the current one" -- this is deliberate catch-up behavior (0005):
  -- if the generator hasn't run in a while (e.g. the Supabase free-tier
  -- project auto-paused after 7 days idle, AD-6, or a local dev instance was
  -- simply off), a later run still backfills every missed period rather than
  -- silently skipping straight to "now" and losing a week's assignment, up
  -- to max_period_iterations.
  --
  -- UNIQUE(assignment_id, period_start) (AD-8, Story 3-1) plus the ON
  -- CONFLICT DO NOTHING below make every iteration idempotent however often
  -- and from whichever path (nightly, on creation) this runs, and race-safe
  -- against a concurrent call (0005, review finding #3).
  while period <= p_today
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
      -- 'assigned' for the students enrolled and approved right now.
      -- recorded_by is NULL: a generated row has no acting user.
      insert into public.homework_status_history (
        instance_id, student_id, class_id, status, recorded_by
      )
      select
        new_instance_id,
        e.student_id,
        assignment_row.class_id,
        'assigned',
        null
      from public.class_enrollments e
      join public.profiles p on p.id = e.student_id
      where e.class_id = assignment_row.class_id
        and p.role = 'student'
        and p.status = 'approved';

      instances_created := instances_created + 1;
    end if;

    period := period + 7;
    period_iterations := period_iterations + 1;
  end loop;

  return instances_created;
end;
$$;

-- CREATE OR REPLACE keeps the function's privileges (0040: service_role only).
comment on function public.generate_recurring_homework_for_series(uuid, date) is
  '#96, #103: makes the students'' copies of one weekly series for every week from its start date up to p_today (at most 104 weeks per call). Nothing for a paused series or an ended one (ends_on on or before p_today), catch-up weeks included. Idempotent through UNIQUE(assignment_id, period_start). Returns the number of weeks created. Internal: called by generate_recurring_homework_instances() (nightly) and create_weekly_homework_first_copies() (on creation); no client role can execute it.';

comment on function public.create_weekly_homework_first_copies(uuid) is
  '#96: makes the students'' copies of a weekly homework series for every week up to today (Europe/Berlin), so students see it as soon as the teacher creates it. Admin or a teacher of the series'' class only; refuses anything that is not a weekly series. Creates nothing for a start date in the future, a paused series or an ended one (#103). The nightly job never makes a second copy of a week. Returns the number of weeks created.';

comment on column public.homework_assignments.ends_on is
  'The day the series was ended -- the endSeries action''s target column (today in Munich). From that day on the generator makes no copy for the series at all, weeks not yet made included (#103). Already-generated instances are never touched.';
