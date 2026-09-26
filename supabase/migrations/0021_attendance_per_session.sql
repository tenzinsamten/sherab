-- 0021_attendance_per_session.sql
--
-- Story 6-2: attendance per session and calendar holidays.
--
-- * attendance_records.class_session_id: every mark references a session of
--   its own class (composite FK (class_session_id, class_id), ON DELETE
--   RESTRICT). session_date stays, filled from the session's day by a BEFORE
--   INSERT trigger, so existing reads keep working.
-- * Backfill: every existing mark is mapped onto the session of its
--   (class, session_date). A missing class day is created (its insert
--   trigger adds the sessions of every class whose schedule matches it), and
--   a class that still has no session that day gets an extra session. No
--   mark is moved or changed; the migration aborts if one can't be mapped.
-- * INSERT policy: teacher of the class + student enrolled (admin bypasses
--   those two, as before), and for everyone: the session belongs to the
--   class, isn't cancelled (session or day) and its day is today (Berlin) or
--   earlier.
-- * Streaks: compute_student_streak() is the pure rule; recompute_student_
--   streak() (still the single streak path) stores its result. A week is a
--   session week only if one of the student's classes has a non-cancelled
--   session that week with at least one mark. Weeks are ISO Monday weeks of
--   the session day; the walk starts at the current Berlin week.
-- * The first mark on a session, and cancelling / restoring a session or a
--   class day with marks, recompute every enrolled student of the class.
-- * Badges count distinct session days.
-- * Schedule regeneration never deletes a session with marks.
-- * Proof: the mark count and every mark's student, class, present, day and
--   recorded_at are unchanged; every student_streaks row is unchanged; and
--   for every student_streaks row the new rule gives the same streak as the
--   old rule (both as of the current Berlin week). Any difference aborts.

-- ---------------------------------------------------------------------------
-- Snapshots (checked at the end)
-- ---------------------------------------------------------------------------

create temporary table _0021_marks_before as
select id, student_id, class_id, present, session_date, recorded_at, recorded_by, notes
from public.attendance_records;

create temporary table _0021_streaks_before as
select student_id, class_id, current_streak, last_qualifying_week, updated_at
from public.student_streaks;

-- The pre-0021 streak rule (0016), as a pure function of an "as of" week, so
-- the new rule can be compared with it on the real data.
create function pg_temp._0021_legacy_streak(
  p_student_id uuid,
  p_class_id uuid,
  p_as_of_week date,
  out current_streak integer,
  out last_qualifying_week date
)
language plpgsql
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
  iterations integer := 0;
begin
  current_streak := 0;
  last_qualifying_week := null;

  select (value ->> 'weeks')::integer into grace_weeks
  from public.app_settings where key = 'streak_grace_weeks';
  grace_weeks := greatest(coalesce(grace_weeks, 2), 0);

  select coalesce(array_agg(distinct date_trunc('week', ar.session_date::timestamp)::date), array[]::date[])
  into attendance_weeks
  from (
    select distinct session_date from public.attendance_records
    where student_id = p_student_id and present = true
  ) ar;

  select coalesce(array_agg(distinct date_trunc('week', hi.period_start::timestamp)::date), array[]::date[])
  into homework_weeks
  from (
    select distinct hsh.instance_id from public.homework_status_history hsh
    where hsh.student_id = p_student_id and hsh.status = 'done'
  ) done_pairs
  join public.homework_instances hi on hi.id = done_pairs.instance_id;

  select array(select unnest(attendance_weeks) intersect select unnest(homework_weeks))
  into qualifying_weeks;

  select coalesce(array_agg(distinct date_trunc('week', session_date::timestamp)::date), array[]::date[])
  into class_session_weeks
  from public.attendance_records
  where class_id = p_class_id
     or class_id in (select e.class_id from public.class_enrollments e where e.student_id = p_student_id);

  select min(w) into earliest_class_week from unnest(class_session_weeks) as w;

  if array_length(qualifying_weeks, 1) is not null then
    cursor_week := p_as_of_week;
    loop
      iterations := iterations + 1;
      exit when iterations > 2600;
      exit when earliest_class_week is not null and cursor_week < earliest_class_week;
      if cursor_week = any (class_session_weeks) then
        if cursor_week = any (qualifying_weeks) then
          current_streak := current_streak + 1;
          gap_count := 0;
          if last_qualifying_week is null then
            last_qualifying_week := cursor_week;
          end if;
        else
          gap_count := gap_count + 1;
          exit when gap_count > grace_weeks;
        end if;
      end if;
      cursor_week := cursor_week - 7;
    end loop;
  end if;
end;
$$;

create temporary table _0021_as_of as
select date_trunc('week', (now() at time zone 'Europe/Berlin')::date::timestamp)::date as week;

create temporary table _0021_legacy_streaks as
select b.student_id, b.class_id, l.current_streak, l.last_qualifying_week
from _0021_streaks_before b
cross join _0021_as_of a
cross join lateral pg_temp._0021_legacy_streak(b.student_id, b.class_id, a.week) l;

-- ---------------------------------------------------------------------------
-- class_session_id + backfill
-- ---------------------------------------------------------------------------

-- Target of the composite FK below: a mark's session must be of its class.
alter table public.class_sessions
  add constraint class_sessions_id_class_unique unique (id, class_id);

alter table public.attendance_records
  add column class_session_id uuid;

-- The backfill rule, as a function so it can be tested (service role only):
-- the session of p_class_id on p_day, creating the class day (whose insert
-- trigger adds the schedule-matching sessions) and, if the class still has
-- none that day, an extra session.
create or replace function public.attendance_backfill_session(p_class_id uuid, p_day date)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_day_id uuid;
  v_session_id uuid;
begin
  insert into public.class_days (day)
  values (p_day)
  on conflict on constraint class_days_day_unique do nothing
  returning id into v_day_id;

  if v_day_id is not null then
    -- The day is new: its insert trigger just gave a session to every class
    -- whose schedule matches it. Only p_class_id met that day, so the other
    -- classes' (unmarked) sessions go again.
    delete from public.class_sessions s
    where s.class_day_id = v_day_id
      and s.class_id <> p_class_id
      and not s.extra;
  else
    select d.id into v_day_id from public.class_days d where d.day = p_day;
  end if;

  select s.id into v_session_id
  from public.class_sessions s
  where s.class_id = p_class_id and s.class_day_id = v_day_id;

  if v_session_id is null then
    insert into public.class_sessions (class_id, class_day_id, extra)
    values (p_class_id, v_day_id, true)
    returning id into v_session_id;
  end if;

  return v_session_id;
end;
$$;

comment on function public.attendance_backfill_session(uuid, date) is
  'Session of a class on a date for the 0021 attendance backfill (Story 6-2): creates the class day if missing (keeping only this class''s session on it), then an extra session if the class has none that day. Service role only.';

revoke all on function public.attendance_backfill_session(uuid, date) from public, anon, authenticated;
grant execute on function public.attendance_backfill_session(uuid, date) to service_role;

do $$
declare
  r record;
  v_session_id uuid;
  v_unmapped bigint;
  v_cancelled text;
begin
  -- A legacy mark on a cancelled class day, or on an existing cancelled
  -- session of its class, would land on a cancelled session and stop its week
  -- from counting. Stop here with the offending (class, date) pairs, so they
  -- can be sorted out (e.g. restore the day) before re-running.
  select string_agg(format('(%s, %s, %s marks)', x.class_id, x.session_date, x.marks), ', ')
  into v_cancelled
  from (
    select a.class_id, a.session_date, count(*) as marks
    from public.attendance_records a
    join public.class_days d on d.day = a.session_date
    left join public.class_sessions s on s.class_id = a.class_id and s.class_day_id = d.id
    where d.cancelled or coalesce(s.cancelled, false)
    group by a.class_id, a.session_date
    order by a.session_date, a.class_id
    limit 20
  ) x;
  if v_cancelled is not null then
    raise exception '0021: attendance marks on cancelled sessions or class days (class_id, date, marks; first 20): %',
      v_cancelled;
  end if;

  for r in
    select distinct class_id, session_date from public.attendance_records order by session_date, class_id
  loop
    v_session_id := public.attendance_backfill_session(r.class_id, r.session_date);
    update public.attendance_records
    set class_session_id = v_session_id
    where class_id = r.class_id and session_date = r.session_date;
  end loop;

  select count(*) into v_unmapped from public.attendance_records where class_session_id is null;
  if v_unmapped <> 0 then
    raise exception '0021: % attendance marks could not be mapped to a session', v_unmapped;
  end if;
end;
$$;

alter table public.attendance_records
  alter column class_session_id set not null,
  add constraint attendance_records_class_session_fkey
    foreign key (class_session_id, class_id)
    references public.class_sessions (id, class_id)
    on delete restrict;

comment on column public.attendance_records.class_session_id is
  'The session this mark is for (Story 6-2). Must be a session of class_id. A session with marks can''t be deleted.';
comment on column public.attendance_records.session_date is
  'The day of class_session_id, stamped by a BEFORE INSERT trigger (Story 6-2); any client value is overwritten. Kept for existing reads.';

create index attendance_records_class_session_id_idx
  on public.attendance_records (class_session_id);

-- session_date always follows the session.
create or replace function public.stamp_attendance_session_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  select d.day into v_day
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  where s.id = new.class_session_id;

  -- An unknown session is left to RLS / the foreign key to reject.
  if v_day is not null then
    new.session_date := v_day;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_attendance_session_date() from public, anon, authenticated;

create trigger attendance_records_stamp_session_date
  before insert on public.attendance_records
  for each row
  execute function public.stamp_attendance_session_date();

-- ---------------------------------------------------------------------------
-- INSERT policy
-- ---------------------------------------------------------------------------

drop policy "attendance_records_insert_admin_or_assigned_teacher" on public.attendance_records;
create policy "attendance_records_insert_admin_or_assigned_teacher"
  on public.attendance_records for insert
  with check (
    recorded_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.is_teacher_of_class(class_id)
        and public.is_enrolled_in_class(student_id, attendance_records.class_id)
      )
    )
    and exists (
      select 1
      from public.class_sessions s
      join public.class_days d on d.id = s.class_day_id
      where s.id = attendance_records.class_session_id
        and s.class_id = attendance_records.class_id
        and not s.cancelled
        and not d.cancelled
        and d.day <= (now() at time zone 'Europe/Berlin')::date
    )
  );

-- ---------------------------------------------------------------------------
-- Streaks
-- ---------------------------------------------------------------------------

create or replace function public.compute_student_streak(
  p_student_id uuid,
  p_class_id uuid,
  p_as_of_week date default null,
  out current_streak integer,
  out last_qualifying_week date
)
language plpgsql
set search_path = ''
as $$
declare
  grace_weeks integer;
  student_classes uuid[];
  attendance_weeks date[];
  homework_weeks date[];
  class_session_weeks date[];
  qualifying_weeks date[];
  earliest_class_week date;
  cursor_week date;
  gap_count integer := 0;
  iterations integer := 0;
  max_weeks_back constant integer := 2600;
begin
  current_streak := 0;
  last_qualifying_week := null;

  select (value ->> 'weeks')::integer
  into grace_weeks
  from public.app_settings
  where key = 'streak_grace_weeks';
  grace_weeks := greatest(coalesce(grace_weeks, 2), 0);

  -- The firing class plus every class the student is enrolled in (#42).
  select array_agg(distinct c) into student_classes
  from (
    select p_class_id as c
    union
    select e.class_id from public.class_enrollments e where e.student_id = p_student_id
  ) cs
  where c is not null;

  -- Weeks of the session days the student was marked present on (distinct
  -- days, never raw row counts).
  select coalesce(array_agg(distinct date_trunc('week', pd.day::timestamp)::date), array[]::date[])
  into attendance_weeks
  from (
    select distinct d.day
    from public.attendance_records a
    join public.class_sessions s on s.id = a.class_session_id
    join public.class_days d on d.id = s.class_day_id
    where a.student_id = p_student_id and a.present = true
      and not s.cancelled
      and not d.cancelled
  ) pd;

  select coalesce(array_agg(distinct date_trunc('week', hi.period_start::timestamp)::date), array[]::date[])
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

  -- Session weeks: a non-cancelled session of one of the student's classes
  -- that has at least one mark. A week without one is a holiday.
  select coalesce(array_agg(distinct date_trunc('week', d.day::timestamp)::date), array[]::date[])
  into class_session_weeks
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  where s.class_id = any (student_classes)
    and not s.cancelled
    and not d.cancelled
    and exists (select 1 from public.attendance_records a where a.class_session_id = s.id);

  select min(w) into earliest_class_week from unnest(class_session_weeks) as w;

  if array_length(qualifying_weeks, 1) is not null then
    -- Normalized to its Monday, so any day of the week may be passed.
    cursor_week := date_trunc(
      'week',
      coalesce(p_as_of_week, (now() at time zone 'Europe/Berlin')::date)::timestamp
    )::date;

    loop
      iterations := iterations + 1;
      exit when iterations > max_weeks_back;
      exit when earliest_class_week is not null and cursor_week < earliest_class_week;

      if cursor_week = any (class_session_weeks) then
        if cursor_week = any (qualifying_weeks) then
          current_streak := current_streak + 1;
          gap_count := 0;
          if last_qualifying_week is null then
            last_qualifying_week := cursor_week;
          end if;
        else
          gap_count := gap_count + 1;
          exit when gap_count > grace_weeks;
        end if;
      end if;
      -- else: holiday week -- no effect on grace or the streak.

      cursor_week := cursor_week - 7;
    end loop;
  end if;
end;
$$;

comment on function public.compute_student_streak(uuid, uuid, date) is
  'The streak rule (Story 6-2), without writing anything: consecutive qualifying weeks (present at a non-cancelled session + homework done) walking back from the ISO week containing p_as_of_week (default: today in Europe/Berlin). A week counts only if one of the student''s classes has a non-cancelled session with at least one mark in it; other weeks are holidays and consume no grace (app_settings.streak_grace_weeks). Called by recompute_student_streak; service role may call it for tests.';

revoke all on function public.compute_student_streak(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.compute_student_streak(uuid, uuid, date) to service_role;

create or replace function public.recompute_student_streak(p_student_id uuid, p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
  v_last date;
begin
  select c.current_streak, c.last_qualifying_week
  into v_streak, v_last
  from public.compute_student_streak(p_student_id, p_class_id) c;

  insert into public.student_streaks (student_id, class_id, current_streak, last_qualifying_week, updated_at)
  values (p_student_id, p_class_id, v_streak, v_last, now())
  on conflict (student_id) do update
    set class_id = excluded.class_id,
        current_streak = excluded.current_streak,
        last_qualifying_week = excluded.last_qualifying_week,
        updated_at = now();
end;
$$;

comment on function public.recompute_student_streak(uuid, uuid) is
  'The single streak path: stores compute_student_streak() for one student (Story 6-2). SECURITY DEFINER so it can write student_streaks, which has no client write policy. Called only from triggers.';

-- Recomputes every student a change to these sessions can affect: the
-- enrolled students of their classes and anyone marked on them. Each
-- recompute is exception-isolated, like trg_recompute_student_streak.
create or replace function public.recompute_streaks_for_sessions(p_session_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    return;
  end if;

  for r in
    select distinct on (t.student_id) t.student_id, t.class_id
    from (
      select e.student_id, e.class_id
      from public.class_enrollments e
      join public.class_sessions s on s.class_id = e.class_id
      where s.id = any (p_session_ids)
      union
      select a.student_id, a.class_id
      from public.attendance_records a
      where a.class_session_id = any (p_session_ids)
    ) t
    order by t.student_id, t.class_id
  loop
    begin
      perform public.recompute_student_streak(r.student_id, r.class_id);
    exception when others then
      raise warning 'recompute_student_streak failed for student % (class %): %',
        r.student_id, r.class_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.recompute_streaks_for_sessions(uuid[]) from public, anon, authenticated;

-- Attendance: recompute the marked students, and -- when a session gets its
-- first mark(s) in this statement, which makes its week a session week for
-- the whole class -- every enrolled student of that class. Statement-level,
-- so a multi-row insert recomputes each student once.
create or replace function public.trg_attendance_recompute_streaks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_first_marked uuid[];
begin
  select array_agg(distinct n.class_session_id) into v_first_marked
  from new_rows n
  where not exists (
    select 1
    from public.attendance_records a
    where a.class_session_id = n.class_session_id
      and a.id not in (select n2.id from new_rows n2)
  );

  perform public.recompute_streaks_for_sessions(v_first_marked);

  for r in
    select distinct on (n.student_id) n.student_id, n.class_id
    from new_rows n
    where not (n.class_session_id = any (coalesce(v_first_marked, array[]::uuid[])))
    order by n.student_id, n.class_id
  loop
    begin
      perform public.recompute_student_streak(r.student_id, r.class_id);
    exception when others then
      raise warning 'recompute_student_streak failed for student % (class %): %',
        r.student_id, r.class_id, sqlerrm;
    end;
  end loop;

  return null;
end;
$$;

revoke all on function public.trg_attendance_recompute_streaks() from public, anon, authenticated;

drop trigger attendance_records_recompute_streak on public.attendance_records;

create trigger attendance_records_recompute_streak
  after insert on public.attendance_records
  referencing new table as new_rows
  for each statement
  execute function public.trg_attendance_recompute_streaks();

-- Cancelling or restoring a session with marks changes its week for the
-- whole class. A session on a cancelled day stays cancelled either way.
create or replace function public.trg_class_session_cancel_recompute_streaks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.class_days d where d.id = new.class_day_id and not d.cancelled)
    and exists (select 1 from public.attendance_records a where a.class_session_id = new.id)
  then
    perform public.recompute_streaks_for_sessions(array[new.id]);
  end if;
  return null;
end;
$$;

revoke all on function public.trg_class_session_cancel_recompute_streaks() from public, anon, authenticated;

create trigger class_sessions_cancel_recompute_streaks
  after update of cancelled on public.class_sessions
  for each row
  when (old.cancelled is distinct from new.cancelled)
  execute function public.trg_class_session_cancel_recompute_streaks();

-- Cancelling or restoring a class day does the same for each of its
-- (not individually cancelled) sessions with marks.
create or replace function public.trg_class_day_cancel_recompute_streaks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions uuid[];
begin
  select array_agg(s.id) into v_sessions
  from public.class_sessions s
  where s.class_day_id = new.id
    and not s.cancelled
    and exists (select 1 from public.attendance_records a where a.class_session_id = s.id);

  perform public.recompute_streaks_for_sessions(v_sessions);
  return null;
end;
$$;

revoke all on function public.trg_class_day_cancel_recompute_streaks() from public, anon, authenticated;

create trigger class_days_cancel_recompute_streaks
  after update of cancelled on public.class_days
  for each row
  when (old.cancelled is distinct from new.cancelled)
  execute function public.trg_class_day_cancel_recompute_streaks();

-- ---------------------------------------------------------------------------
-- Badges: distinct session days
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

  if thresholds is null or jsonb_typeof(thresholds) <> 'array' or jsonb_array_length(thresholds) = 0
  then
    thresholds := '[1, 5, 10, 25, 50, 100]'::jsonb;
  end if;

  if p_badge_type = 'attendance' then
    -- Distinct session days the student was marked present on (Story 6-2),
    -- never raw row counts.
    select count(distinct d.day)
    into current_total
    from public.attendance_records a
    join public.class_sessions s on s.id = a.class_session_id
    join public.class_days d on d.id = s.class_day_id
    where a.student_id = p_student_id and a.present = true;
  elsif p_badge_type = 'homework' then
    select count(distinct instance_id)
    into current_total
    from public.homework_status_history
    where student_id = p_student_id and status = 'done';
  else
    return;
  end if;

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

-- ---------------------------------------------------------------------------
-- Schedule regeneration keeps sessions with marks
-- ---------------------------------------------------------------------------

create or replace function public.regenerate_class_sessions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  -- Future scheduled sessions that no longer match go; extras and sessions
  -- with attendance marks stay.
  delete from public.class_sessions s
  using public.class_days d
  where d.id = s.class_day_id
    and s.class_id = new.id
    and not s.extra
    and d.day >= v_today
    and not public.class_schedule_matches(
      d.day, new.schedule_weekdays, new.schedule_starts_on, new.schedule_ends_on
    )
    and not exists (
      select 1 from public.attendance_records a where a.class_session_id = s.id
    );

  insert into public.class_sessions (class_id, class_day_id)
  select new.id, d.id
  from public.class_days d
  where d.day >= v_today
    and public.class_schedule_matches(
      d.day, new.schedule_weekdays, new.schedule_starts_on, new.schedule_ends_on
    )
  on conflict on constraint class_sessions_one_per_class_day do nothing;

  return new;
end;
$$;

revoke all on function public.regenerate_class_sessions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Proof: marks and streaks unchanged
-- ---------------------------------------------------------------------------

do $$
declare
  v_before bigint;
  v_after bigint;
  v_changed bigint;
  v_diff text;
begin
  select count(*) into v_before from _0021_marks_before;
  select count(*) into v_after from public.attendance_records;
  if v_before <> v_after then
    raise exception '0021: attendance mark count changed from % to %', v_before, v_after;
  end if;

  -- Every mark keeps student, class, present, day, recorded_at (and author,
  -- notes), and its session is of its class on its day.
  select count(*) into v_changed
  from _0021_marks_before b
  left join public.attendance_records a on a.id = b.id
  left join public.class_sessions s on s.id = a.class_session_id
  left join public.class_days d on d.id = s.class_day_id
  where a.id is null
    or a.student_id <> b.student_id
    or a.class_id <> b.class_id
    or a.present <> b.present
    or a.session_date <> b.session_date
    or a.recorded_at <> b.recorded_at
    or a.recorded_by is distinct from b.recorded_by
    or a.notes is distinct from b.notes
    or s.class_id is distinct from b.class_id
    or d.day is distinct from b.session_date;
  if v_changed <> 0 then
    raise exception '0021: % attendance marks changed', v_changed;
  end if;

  -- Stored streak rows untouched.
  select count(*) into v_after from public.student_streaks;
  select count(*) into v_before from _0021_streaks_before;
  if v_before <> v_after then
    raise exception '0021: student_streaks count changed from % to %', v_before, v_after;
  end if;

  select count(*) into v_changed
  from _0021_streaks_before b
  left join public.student_streaks s on s.student_id = b.student_id
  where s.student_id is null
    or s.class_id is distinct from b.class_id
    or s.current_streak <> b.current_streak
    or s.last_qualifying_week is distinct from b.last_qualifying_week
    or s.updated_at <> b.updated_at;
  if v_changed <> 0 then
    raise exception '0021: % student_streaks rows changed', v_changed;
  end if;

  -- The new rule gives every student the streak the old rule gives.
  create temporary table _0021_streak_diff as
  select l.student_id,
    l.current_streak as old_streak, l.last_qualifying_week as old_week,
    n.current_streak as new_streak, n.last_qualifying_week as new_week
  from _0021_legacy_streaks l
  cross join _0021_as_of a
  cross join lateral public.compute_student_streak(l.student_id, l.class_id, a.week) n
  where n.current_streak <> l.current_streak
     or n.last_qualifying_week is distinct from l.last_qualifying_week;

  select count(*) into v_changed from _0021_streak_diff;
  if v_changed <> 0 then
    select string_agg(
      format('%s: %s/%s -> %s/%s', x.student_id, x.old_streak, x.old_week, x.new_streak, x.new_week),
      ', ')
    into v_diff
    from (select * from _0021_streak_diff order by student_id limit 20) x;
    raise exception '0021: the calendar streak rule changes % students'' streaks (student: old streak/last week -> new; first 20): %',
      v_changed, v_diff;
  end if;
  drop table _0021_streak_diff;
end;
$$;

drop table _0021_marks_before;
drop table _0021_streaks_before;
drop table _0021_legacy_streaks;
drop table _0021_as_of;
drop function pg_temp._0021_legacy_streak(uuid, uuid, date);
