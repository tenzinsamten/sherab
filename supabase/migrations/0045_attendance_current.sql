-- 0045_attendance_current.sql
--
-- #102: a correction of an attendance mark counts.
--
-- Marks are append-only (AD-5): saving a session again adds a row per
-- student, and no row is updated or deleted. Until now every reader looked
-- at all rows, so a "present" that was later corrected to "absent" still
-- counted for the streak and the badges, and a re-marked session showed
-- twice in the teacher's history and in the parent's list.
--
-- * attendance_current: the one definition of "the current mark" -- the
--   latest row per (session, student), by recorded_at desc, id desc.
--   security_invoker, so the caller's RLS on attendance_records applies
--   (admin and the class's teachers; nobody else reads a row).
-- * compute_student_streak (0028), recompute_student_badges (0021) and
--   child_attendance (0036) read it. Nothing else in them changes. The
--   "session has a mark" tests in the streak rule stay on attendance_records:
--   a session with any mark is a marked session.
-- * The latest mark wins for marks saved before this migration too. Streaks
--   are recomputed once for every session that has a student with more than
--   one mark. Earned badges are never removed, so badges need no recompute:
--   a correction can only lower the count.
-- * Proof: no existing mark is removed or changed (a mark saved while this
--   runs is fine), and every recomputed student's stored streak equals the
--   streak rule. Any difference aborts.
--
-- Before pushing to the hosted database, this counts the marks that change
-- meaning -- (session, student) pairs whose latest mark is absent while an
-- earlier one is present (run it before or after the migration; it reads
-- only attendance_records):
--
--   select count(*)
--   from (
--     select distinct on (class_session_id, student_id)
--            class_session_id, student_id, present
--     from public.attendance_records
--     order by class_session_id, student_id, recorded_at desc, id desc
--   ) latest
--   where not latest.present
--     and exists (
--       select 1
--       from public.attendance_records e
--       where e.class_session_id = latest.class_session_id
--         and e.student_id = latest.student_id
--         and e.present
--     );

-- ---------------------------------------------------------------------------
-- Snapshot (checked at the end)
-- ---------------------------------------------------------------------------

create temporary table _0045_marks_before as
select * from public.attendance_records;

-- ---------------------------------------------------------------------------
-- attendance_current: the latest mark per session and student
-- ---------------------------------------------------------------------------

-- class_id is in the key only so that a filter on it reaches the table
-- before the rows are reduced; a session belongs to one class (composite FK
-- attendance_records_class_session_fkey), so it never splits a pair.
create view public.attendance_current
with (security_invoker = true)
as
select distinct on (a.class_id, a.class_session_id, a.student_id)
  a.id,
  a.student_id,
  a.class_id,
  a.class_session_id,
  a.session_date,
  a.present,
  a.notes,
  a.recorded_by,
  a.recorded_at
from public.attendance_records a
order by a.class_id, a.class_session_id, a.student_id, a.recorded_at desc, a.id desc;

comment on view public.attendance_current is
  '#102: the current attendance mark -- the latest attendance_records row per (class_session_id, student_id), by recorded_at desc, id desc. Marks are append-only (AD-5); a correction is a newer row, and every reader of "the mark" reads this view. security_invoker: the caller''s RLS on attendance_records applies.';

revoke all on public.attendance_current from public, anon, authenticated;
grant select on public.attendance_current to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Streak: the current mark decides whether the student was present
-- (0028 body; only attendance_weeks reads attendance_current)
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
  protected_weeks date[];
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

  -- Weeks of the session days the student's current mark is present on
  -- (#102: the latest mark per session; distinct days, never raw row counts).
  select coalesce(array_agg(distinct date_trunc('week', pd.day::timestamp)::date), array[]::date[])
  into attendance_weeks
  from (
    select distinct d.day
    from public.attendance_current a
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

  -- Stories 7-4, 7-5: protected weeks. The student was present at no
  -- session that week, and the latest answer for every marked session they
  -- missed that week is on_leave + planned, or sick with an approved
  -- decision. Such a week behaves like a holiday. Pending or rejected Sick
  -- protects nothing.
  select coalesce(array_agg(pw.week), array[]::date[])
  into protected_weeks
  from (
    select date_trunc('week', d.day::timestamp)::date as week,
           bool_and(coalesce(
             (l.answer = 'on_leave' and l.classification = 'planned')
             or (l.answer = 'sick' and sd.decision = 'approved'),
             false
           )) as all_protected
    from public.class_sessions s
    join public.class_days d on d.id = s.class_day_id
    left join lateral (
      select h.answer, h.classification
      from public.session_leave_history h
      where h.class_session_id = s.id
        and h.student_id = p_student_id
      order by h.answered_at desc, h.id desc
      limit 1
    ) l on true
    left join public.sick_leave_decisions sd
      on sd.class_session_id = s.id
     and sd.student_id = p_student_id
    where s.class_id = any (student_classes)
      and not s.cancelled
      and not d.cancelled
      and exists (select 1 from public.attendance_records a where a.class_session_id = s.id)
    group by 1
  ) pw
  where pw.all_protected
    and not (pw.week = any (attendance_weeks));

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
        elsif cursor_week = any (protected_weeks) then
          -- Planned leave (7-4) or approved Sick (7-5): like a holiday week.
          null;
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
  'The streak rule (Stories 6-2, 7-4, 7-5, #102), without writing anything: consecutive qualifying weeks (the current mark of a non-cancelled session is present -- attendance_current -- + homework done) walking back from the ISO week containing p_as_of_week (default: today in Europe/Berlin). A week counts only if one of the student''s classes has a non-cancelled session with at least one mark in it; other weeks are holidays and consume no grace (app_settings.streak_grace_weeks). A week the student missed entirely, with planned On leave or approved Sick as the latest answer for every marked session they missed, is also treated as a holiday. Called by recompute_student_streak; service role may call it for tests.';

revoke all on function public.compute_student_streak(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.compute_student_streak(uuid, uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Badges: distinct session days of current "present" marks (0021 body)
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
    -- Distinct session days the student's current mark is present on
    -- (Story 6-2; #102: the latest mark per session), never raw row counts.
    select count(distinct d.day)
    into current_total
    from public.attendance_current a
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
-- child_attendance (0036): one row per session, the current mark
-- ---------------------------------------------------------------------------

create or replace function public.child_attendance(p_student_id uuid)
returns table (
  session_date date,
  class_id uuid,
  class_name text,
  present boolean,
  class_name_bo text,
  class_name_de text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not (p_student_id = auth.uid() or public.is_parent_of(p_student_id)) then
    raise exception 'not allowed to read this student''s attendance'
      using errcode = '42501';
  end if;

  return query
  select a.session_date, a.class_id, c.name, a.present, c.name_bo, c.name_de
  from public.attendance_current a
  join public.classes c on c.id = a.class_id
  where a.student_id = p_student_id
  order by a.session_date desc, c.name;
end;
$$;

comment on function public.child_attendance(uuid) is
  'Story 7-3 (AD-12): the student''s own or a parent''s child''s attendance -- date, class (its names in every language, 0036) and present only; notes stay teacher-only. One row per session: the current mark (#102, attendance_current).';

revoke all on function public.child_attendance(uuid) from public, anon;
grant execute on function public.child_attendance(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Old corrections take effect: recompute the streaks once
-- ---------------------------------------------------------------------------

-- Every session in which some student has more than one mark. The function
-- (0021) recomputes the session's marked and enrolled students, each one
-- exception-isolated.
do $$
declare
  v_sessions uuid[];
  v_wrong bigint;
begin
  select array_agg(distinct t.class_session_id) into v_sessions
  from (
    select a.class_session_id
    from public.attendance_records a
    group by a.class_session_id, a.student_id
    having count(*) > 1
  ) t;

  perform public.recompute_streaks_for_sessions(v_sessions);

  -- Proof: a failed recompute is only a warning in that function, so every
  -- student it covers (marked in, or enrolled in the class of, one of these
  -- sessions) must now have the stored streak the rule gives.
  select count(*) into v_wrong
  from (
    select e.student_id
    from public.class_enrollments e
    join public.class_sessions s on s.class_id = e.class_id
    where s.id = any (v_sessions)
    union
    select a.student_id
    from public.attendance_records a
    where a.class_session_id = any (v_sessions)
  ) t
  left join public.student_streaks ss on ss.student_id = t.student_id
  left join lateral public.compute_student_streak(ss.student_id, ss.class_id) c on true
  where ss.student_id is null
    or ss.current_streak is distinct from c.current_streak
    or ss.last_qualifying_week is distinct from c.last_qualifying_week;
  if v_wrong <> 0 then
    raise exception '0045: % students'' stored streak differs from the streak rule after the recompute', v_wrong;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Proof: no existing mark removed or changed
-- ---------------------------------------------------------------------------

do $$
declare
  v_diff bigint;
begin
  -- Every row of the snapshot is still there, unchanged. Rows saved since
  -- the snapshot are not looked at: a save during the migration is allowed.
  select count(*) into v_diff
  from (
    select * from _0045_marks_before except select * from public.attendance_records
  ) d;
  if v_diff <> 0 then
    raise exception '0045: % existing attendance marks were removed or changed', v_diff;
  end if;
end;
$$;

drop table _0045_marks_before;
