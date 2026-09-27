-- 0027_session_leave.sql
--
-- Story 7-4: parent session leave -- Coming / On leave, planned vs
-- short-notice.
--
-- * session_starts_at(session): the one place a session's start instant is
--   computed: class day + (override, else class default, else 00:00) as
--   Europe/Berlin wall-clock time. class_sessions_effective gains it as
--   starts_at (appended column) so screens never compute it themselves.
-- * app_settings.leave_notice_weeks (default 2): the Leave Notice Period.
--   DB-only, like streak_grace_weeks.
-- * session_leave_history: append-only answers (coming / on_leave / sick)
--   per (session, student); the latest row is current. A BEFORE INSERT
--   trigger stamps actor and time, enforces enrolment, cancellation and the
--   cutoffs, and freezes the classification (classify_leave). Only the
--   parent inserts (RLS is_parent_of); the student, the parent, the class's
--   teachers and the admin read. No UPDATE / DELETE.
-- * preview_leave(): the classification the UI shows before saving.
-- * session_leave_masked(): classmates / teammates see Sick as On leave;
--   nobody else (parents included) gets anything.
-- * compute_student_streak: a missed session week whose every missed marked
--   session has the latest answer on_leave + planned is a holiday week.
--   An AFTER INSERT trigger recomputes the student's streak.
-- * Leave rows cascade with their session, so regenerate_class_sessions
--   (0026, only deletes future unmarked sessions) removes them too.

-- ---------------------------------------------------------------------------
-- Setting
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'leave_notice_weeks',
  '{"weeks": 2}'::jsonb,
  'Leave Notice Period (Story 7-4): an On leave answer set at least this many weeks before the session starts is Planned (protects the streak week); a later one is Short-notice. The classification is frozen when the answer is saved.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- session_starts_at(session)
-- ---------------------------------------------------------------------------

create or replace function public.session_starts_at(p_class_session_id uuid)
returns timestamptz
language sql
security invoker
set search_path = ''
stable
as $$
  select (d.day + coalesce(s.start_time_override, c.default_start_time, time '00:00'))
           at time zone 'Europe/Berlin'
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  join public.classes c on c.id = s.class_id
  where s.id = p_class_session_id;
$$;

comment on function public.session_starts_at(uuid) is
  'Story 7-4: the instant a session starts -- class day + (override, else class default, else 00:00) in Europe/Berlin. The only place a session start is computed. Security invoker: a client only gets the start of a session its RLS lets it read (NULL otherwise); the definer trigger, classify_leave and preview_leave read every session.';

revoke all on function public.session_starts_at(uuid) from public, anon;
grant execute on function public.session_starts_at(uuid) to authenticated, service_role;

-- Effective view: + starts_at (appended; the 0019 columns are unchanged).
create or replace view public.class_sessions_effective
with (security_invoker = true)
as
select
  s.id,
  s.class_id,
  c.name as class_name,
  s.class_day_id,
  d.day,
  coalesce(s.start_time_override, c.default_start_time) as start_time,
  coalesce(s.duration_minutes_override, c.default_duration_minutes) as duration_minutes,
  s.start_time_override,
  s.duration_minutes_override,
  s.cancelled as session_cancelled,
  d.cancelled as day_cancelled,
  (s.cancelled or d.cancelled) as cancelled,
  s.updated_at,
  s.extra,
  public.session_starts_at(s.id) as starts_at
from public.class_sessions s
join public.class_days d on d.id = s.class_day_id
join public.classes c on c.id = s.class_id;

comment on view public.class_sessions_effective is
  'Sessions with effective start time / duration (override, else class default), cancelled = session or day cancelled, extra (Stories 6-1, 6-4) and starts_at = session_starts_at() (Story 7-4). security_invoker: the caller''s RLS on class_sessions, class_days and classes applies.';

-- ---------------------------------------------------------------------------
-- classify_leave(session, at)
-- ---------------------------------------------------------------------------

create or replace function public.classify_leave(p_class_session_id uuid, p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_weeks integer;
  v_start timestamptz;
begin
  select (value ->> 'weeks')::integer into v_weeks
  from public.app_settings
  where key = 'leave_notice_weeks';
  v_weeks := greatest(coalesce(v_weeks, 2), 0);

  v_start := public.session_starts_at(p_class_session_id);
  if v_start is null then
    return null;
  end if;

  if p_at <= v_start - make_interval(weeks => v_weeks) then
    return 'planned';
  end if;
  return 'short_notice';
end;
$$;

comment on function public.classify_leave(uuid, timestamptz) is
  'Story 7-4: how an On leave answer given at p_at counts -- planned when at or before session_starts_at - leave_notice_weeks, else short_notice. NULL for an unknown session.';

revoke all on function public.classify_leave(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.classify_leave(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- session_leave_history
-- ---------------------------------------------------------------------------

create table public.session_leave_history (
  id bigint generated always as identity primary key,
  class_session_id uuid not null references public.class_sessions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  answer text not null
    constraint session_leave_history_answer_valid
      check (answer in ('coming', 'on_leave', 'sick')),
  classification text
    constraint session_leave_history_classification_valid
      check (classification in ('planned', 'short_notice')),
  answered_by uuid references public.profiles (id) on delete set null,
  answered_at timestamptz not null default now(),
  constraint session_leave_history_classification_only_on_leave
    check ((answer = 'on_leave') = (classification is not null))
);

comment on table public.session_leave_history is
  'Story 7-4: append-only session answers (coming / on_leave / sick) per (session, student); the latest row (answered_at, then id) is current. Written only by the student''s approved parent. classification is stamped at insert and never changes.';

create index session_leave_history_session_student_idx
  on public.session_leave_history (class_session_id, student_id, answered_at desc, id desc);
create index session_leave_history_student_idx
  on public.session_leave_history (student_id);

alter table public.session_leave_history enable row level security;

create policy "session_leave_history_insert_parent"
  on public.session_leave_history for insert
  to authenticated
  with check (public.is_parent_of(student_id));

create policy "session_leave_history_select"
  on public.session_leave_history for select
  to authenticated
  using (
    student_id = auth.uid()
    or public.is_parent_of(student_id)
    or public.is_admin()
    or exists (
      select 1
      from public.class_sessions s
      where s.id = class_session_id
        and public.is_teacher_of_class(s.class_id)
    )
  );

-- No UPDATE / DELETE policy (append-only).
revoke all on public.session_leave_history from anon;
revoke insert, update, delete on public.session_leave_history from authenticated;
grant select on public.session_leave_history to authenticated;
grant insert (class_session_id, student_id, answer, classification)
  on public.session_leave_history to authenticated;

-- BEFORE INSERT: stamp, validate, classify.
create or replace function public.trg_session_leave_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_day date;
  v_cancelled boolean;
  v_start timestamptz;
begin
  -- Only the student's approved parent writes leave (the same rule as the
  -- insert policy). Checked first: a BEFORE trigger runs ahead of the RLS
  -- WITH CHECK, and nobody else should learn why a row would be refused.
  -- The service role is not exempt.
  if not public.is_parent_of(new.student_id) then
    raise exception 'only the student''s parent can set leave'
      using errcode = '42501';
  end if;

  new.answered_by := auth.uid();
  new.answered_at := now();

  select s.class_id, d.day, (s.cancelled or d.cancelled)
  into v_class_id, v_day, v_cancelled
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  where s.id = new.class_session_id;

  if v_class_id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if not public.is_enrolled_in_class(new.student_id, v_class_id) then
    raise exception 'student is not enrolled in this session''s class'
      using errcode = '22023', hint = 'leave_not_enrolled';
  end if;

  if v_cancelled then
    raise exception 'session is cancelled'
      using errcode = '22023', hint = 'leave_cancelled';
  end if;

  if new.answer in ('coming', 'on_leave') then
    v_start := public.session_starts_at(new.class_session_id);
    if now() >= v_start then
      raise exception 'session has already started'
        using errcode = '22023', hint = 'leave_started';
    end if;
  elsif new.answer = 'sick' then
    if (now() at time zone 'Europe/Berlin')::date > v_day + 1 then
      raise exception 'sick can only be set until the end of the day after the session'
        using errcode = '22023', hint = 'leave_sick_closed';
    end if;
  end if;

  -- Never the client's value.
  new.classification := case
    when new.answer = 'on_leave' then public.classify_leave(new.class_session_id, now())
    else null
  end;

  return new;
end;
$$;

revoke all on function public.trg_session_leave_before_insert() from public, anon, authenticated;

create trigger session_leave_history_before_insert
  before insert on public.session_leave_history
  for each row
  execute function public.trg_session_leave_before_insert();

-- AFTER INSERT: the streak is recomputed through the one streak path.
create or replace function public.trg_session_leave_recompute_streak()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
begin
  select s.class_id into v_class_id
  from public.class_sessions s
  where s.id = new.class_session_id;

  begin
    perform public.recompute_student_streak(new.student_id, v_class_id);
  exception when others then
    raise warning 'recompute_student_streak failed for student % (class %): %',
      new.student_id, v_class_id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.trg_session_leave_recompute_streak() from public, anon, authenticated;

create trigger session_leave_history_recompute_streak
  after insert on public.session_leave_history
  for each row
  execute function public.trg_session_leave_recompute_streak();

-- ---------------------------------------------------------------------------
-- preview_leave(session, student)
-- ---------------------------------------------------------------------------

create or replace function public.preview_leave(p_class_session_id uuid, p_student_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_parent_of(p_student_id) then
    raise exception 'not allowed to set leave for this student'
      using errcode = '42501';
  end if;
  return public.classify_leave(p_class_session_id, now());
end;
$$;

comment on function public.preview_leave(uuid, uuid) is
  'Story 7-4: the classification (planned / short_notice) an On leave answer saved now would get. The student''s approved parent only.';

revoke all on function public.preview_leave(uuid, uuid) from public, anon;
grant execute on function public.preview_leave(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- session_leave_masked(session): classmates and teammates
-- ---------------------------------------------------------------------------

create or replace function public.session_leave_masked(p_class_session_id uuid)
returns table (student_id uuid, display_name text, answer text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_class_id uuid;
  v_enrolled boolean;
  v_team uuid;
begin
  select s.class_id into v_class_id
  from public.class_sessions s
  where s.id = p_class_session_id;

  v_enrolled := v_class_id is not null
    and public.is_enrolled_in_class(auth.uid(), v_class_id);

  select p.team_id into v_team
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'student'
    and p.status = 'approved';

  if not v_enrolled and not (
    v_team is not null
    and v_class_id is not null
    and exists (
      select 1
      from public.class_enrollments e
      join public.profiles p on p.id = e.student_id
      where e.class_id = v_class_id
        and p.team_id = v_team
    )
  ) then
    raise exception 'not allowed to read this session''s answers'
      using errcode = '42501';
  end if;

  return query
  select l.student_id, p.display_name,
         case when l.answer = 'sick' then 'on_leave' else l.answer end
  from (
    select distinct on (h.student_id) h.student_id, h.answer
    from public.session_leave_history h
    where h.class_session_id = p_class_session_id
    order by h.student_id, h.answered_at desc, h.id desc
  ) l
  join public.profiles p on p.id = l.student_id
  where public.is_enrolled_in_class(l.student_id, v_class_id)
    and (v_enrolled or p.team_id = v_team)
  order by lower(p.display_name), l.student_id;
end;
$$;

comment on function public.session_leave_masked(uuid) is
  'Story 7-4: current answers for a session as classmates (enrolled in its class) or teammates see them: Sick is shown as on_leave. 42501 for anyone else, parents included.';

revoke all on function public.session_leave_masked(uuid) from public, anon;
grant execute on function public.session_leave_masked(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Streak: planned leave protects the week (0021 body + protected_weeks)
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

  -- Story 7-4: protected weeks. The student was present at no session that
  -- week, and the latest answer for every marked session they missed that
  -- week is on_leave + planned. Such a week behaves like a holiday.
  select coalesce(array_agg(pw.week), array[]::date[])
  into protected_weeks
  from (
    select date_trunc('week', d.day::timestamp)::date as week,
           bool_and(coalesce(l.answer = 'on_leave' and l.classification = 'planned', false)) as all_planned
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
    where s.class_id = any (student_classes)
      and not s.cancelled
      and not d.cancelled
      and exists (select 1 from public.attendance_records a where a.class_session_id = s.id)
    group by 1
  ) pw
  where pw.all_planned
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
          -- Planned leave (Story 7-4): like a holiday week.
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
  'The streak rule (Stories 6-2, 7-4), without writing anything: consecutive qualifying weeks (present at a non-cancelled session + homework done) walking back from the ISO week containing p_as_of_week (default: today in Europe/Berlin). A week counts only if one of the student''s classes has a non-cancelled session with at least one mark in it; other weeks are holidays and consume no grace (app_settings.streak_grace_weeks). A week the student missed entirely, with planned On leave as the latest answer for every marked session they missed, is also treated as a holiday. Called by recompute_student_streak; service role may call it for tests.';

revoke all on function public.compute_student_streak(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.compute_student_streak(uuid, uuid, date) to service_role;
