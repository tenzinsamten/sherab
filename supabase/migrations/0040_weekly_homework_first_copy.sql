-- #96: students see a weekly homework's first week as soon as it is created.
--
-- Until now only the nightly job (generate-recurring-homework-instances,
-- 03:00 UTC, 0005) made the students' copies of a weekly series, so a
-- teacher who created weekly homework got "created" and the students saw
-- nothing until the next morning.
--
-- * generate_recurring_homework_for_series(series, today): the per-series
--   loop that used to live inside generate_recurring_homework_instances()
--   (0016), moved here unchanged. Internal: no client role may call it.
-- * generate_recurring_homework_instances(): the nightly function, now a
--   loop over the series that calls the function above with current_date.
--   Same series, same weeks, same due dates, same students, same result.
-- * create_weekly_homework_first_copies(series): what the create page calls.
--   Admin or a teacher of the series' class only, weekly series only; makes
--   the copies for every week up to today in Munich (Europe/Berlin).
--
-- UNIQUE(assignment_id, period_start) (0005) with ON CONFLICT DO NOTHING
-- keeps the two paths from ever making a second copy of a week, whichever
-- runs first.
--
-- No "New" push notification is sent for these copies (decision of #92):
-- that notice is only sent when the app asks for it (announceHomework), and
-- nothing here does.

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
  -- The same conditions the nightly function has always selected series by:
  -- weekly, not paused, with a start date and a due offset. Anything else
  -- creates nothing.
  select id, class_id, recurrence_start_date, due_offset_days, ends_on
  into assignment_row
  from public.homework_assignments
  where id = p_assignment_id
    and recurrence_rule is not null
    and paused_at is null
    and recurrence_start_date is not null
    and due_offset_days is not null;

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
  -- to max_period_iterations. ends_on is checked per period, so the weeks
  -- before it are still made.
  --
  -- UNIQUE(assignment_id, period_start) (AD-8, Story 3-1) plus the ON
  -- CONFLICT DO NOTHING below make every iteration idempotent however often
  -- and from whichever path (nightly, on creation) this runs, and race-safe
  -- against a concurrent call (0005, review finding #3: a plain "if not
  -- exists(...) then insert" would be a check-then-act race whose losing
  -- insert raises an uncaught unique-violation that rolls back the whole
  -- call -- for the nightly function, every other series of that run too).
  while period <= p_today
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

comment on function public.generate_recurring_homework_for_series(uuid, date) is
  '#96: makes the students'' copies of one weekly series for every week from its start date up to p_today (not paused, not past ends_on, at most 104 weeks per call). Idempotent through UNIQUE(assignment_id, period_start). Returns the number of weeks created. Internal: called by generate_recurring_homework_instances() (nightly) and create_weekly_homework_first_copies() (on creation); no client role can execute it.';

revoke all on function public.generate_recurring_homework_for_series(uuid, date) from public;
revoke all on function public.generate_recurring_homework_for_series(uuid, date)
  from anon, authenticated;
grant execute on function public.generate_recurring_homework_for_series(uuid, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- generate_recurring_homework_instances(): the nightly job, same result
-- ---------------------------------------------------------------------------

create or replace function public.generate_recurring_homework_instances()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row record;
  instances_created integer := 0;
begin
  for assignment_row in
    -- Every weekly series. Which of them get copies (not paused, with a
    -- start date and a due offset) is decided in one place, by
    -- generate_recurring_homework_for_series().
    select id
    from public.homework_assignments
    where recurrence_rule is not null
  loop
    instances_created := instances_created
      + public.generate_recurring_homework_for_series(assignment_row.id, current_date);
  end loop;

  return instances_created;
end;
$$;

-- CREATE OR REPLACE keeps the function's privileges (0005: revoked from
-- public, anon and authenticated) and the cron job.
comment on function public.generate_recurring_homework_instances() is
  'The nightly generator (pg_cron, 03:00 UTC): for every weekly series that is not paused, makes the students'' copies of each week up to current_date through generate_recurring_homework_for_series(). Not executable by anon/authenticated. Returns the number of weeks created. Since #96 the first weeks of a series are also made on creation, by create_weekly_homework_first_copies().';

-- ---------------------------------------------------------------------------
-- create_weekly_homework_first_copies(series): called by the create page
-- ---------------------------------------------------------------------------

create or replace function public.create_weekly_homework_first_copies(p_assignment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_recurrence_rule jsonb;
begin
  select class_id, recurrence_rule
  into v_class_id, v_recurrence_rule
  from public.homework_assignments
  where id = p_assignment_id;

  -- One answer for "no such homework" and "not yours", so the function does
  -- not tell a caller which ids exist.
  if v_class_id is null
     or not (public.is_admin() or public.is_teacher_of_class(v_class_id)) then
    raise exception 'not allowed to create copies of this homework'
      using errcode = '42501';
  end if;

  if v_recurrence_rule is null then
    raise exception 'not a weekly homework series'
      using errcode = '22023';
  end if;

  -- Today in Munich, the app's "today" (src/lib/berlin-date.ts): between
  -- 00:00 and 02:00 there it is still yesterday in UTC.
  return public.generate_recurring_homework_for_series(
    p_assignment_id,
    (now() at time zone 'Europe/Berlin')::date
  );
end;
$$;

comment on function public.create_weekly_homework_first_copies(uuid) is
  '#96: makes the students'' copies of a weekly homework series for every week up to today (Europe/Berlin), so students see it as soon as the teacher creates it. Admin or a teacher of the series'' class only; refuses anything that is not a weekly series. Creates nothing for a start date in the future or a paused series. The nightly job never makes a second copy of a week. Returns the number of weeks created.';

-- Signed-in users only. Not service_role: with no auth.uid() the check above
-- always refuses it.
revoke all on function public.create_weekly_homework_first_copies(uuid)
  from public, anon, service_role;
grant execute on function public.create_weekly_homework_first_copies(uuid) to authenticated;
