-- 0028_sick_leave_decisions.sql
--
-- Story 7-5: Sick leave with teacher approval.
--
-- * sick_leave_decisions: one final decision (approved / rejected) per
--   (session, student). A BEFORE INSERT trigger stamps decided_by =
--   auth.uid() (NULL = system, the 0005 convention) and decided_at, and
--   refuses the insert unless the student's current answer is sick.
--   RLS: a teacher of the session's class or the admin decides, never the
--   student's own parent (the first AD-4 self-decision guard). The
--   student, their parent, the class's teachers and the admin read. No
--   UPDATE / DELETE: a decision is final.
-- * trg_session_leave_before_insert (0027) redefined: once a decision
--   exists, every new answer for that (session, student) is refused with
--   hint leave_decided. The decided Sick stays the current answer. Sick
--   is also refused for a session dated after today (leave_sick_closed).
-- * approve_stale_sick_leave(): the daily catch-up job. Every undecided
--   current Sick on a non-cancelled session that started at least 14 days ago is approved
--   with a NULL actor. Idempotent (on conflict do nothing). service_role
--   only; scheduled with pg_cron.
-- * sick_leave_queue(): the /requests Sick leave section and nav badge --
--   current Sick answers on non-cancelled sessions of the classes the caller teaches (every class
--   for the admin), with their decision and whether the student is the
--   caller's own child.
-- * compute_student_streak: a missed session whose current answer is Sick
--   with an approved decision also protects the week. An AFTER INSERT
--   trigger on decisions recomputes the student's streak.

-- ---------------------------------------------------------------------------
-- sick_leave_decisions
-- ---------------------------------------------------------------------------

create table public.sick_leave_decisions (
  id bigint generated always as identity primary key,
  class_session_id uuid not null references public.class_sessions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  decision text not null
    constraint sick_leave_decisions_decision_valid
      check (decision in ('approved', 'rejected')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint sick_leave_decisions_one_per_session_student
    unique (class_session_id, student_id)
);

comment on table public.sick_leave_decisions is
  'Story 7-5: the final decision on a Sick answer per (session, student). decided_by NULL = system (the auto-approval job). Written by a teacher of the class or the admin, never by the student''s own parent. No updates or deletes.';

comment on column public.sick_leave_decisions.decided_by is
  'Who decided. NULL = the system (approve_stale_sick_leave), following the 0005 convention.';

create index sick_leave_decisions_student_idx
  on public.sick_leave_decisions (student_id);

alter table public.sick_leave_decisions enable row level security;

create policy "sick_leave_decisions_insert_teacher_or_admin"
  on public.sick_leave_decisions for insert
  to authenticated
  with check (
    (
      public.is_admin()
      or exists (
        select 1
        from public.class_sessions s
        where s.id = class_session_id
          and public.is_teacher_of_class(s.class_id)
      )
    )
    and not public.is_parent_of(student_id)
  );

create policy "sick_leave_decisions_select"
  on public.sick_leave_decisions for select
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

-- No UPDATE / DELETE policy: a decision is final.
revoke all on public.sick_leave_decisions from anon;
revoke insert, update, delete on public.sick_leave_decisions from authenticated;
grant select on public.sick_leave_decisions to authenticated;
grant insert (class_session_id, student_id, decision)
  on public.sick_leave_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- Serialising answers and decisions for one (session, student)
-- ---------------------------------------------------------------------------

-- Both BEFORE INSERT triggers take this lock, so a decision and a new
-- answer for the same (session, student) never interleave: the decision
-- always sees the answer it is attached to as the current one.
create or replace function public.lock_session_student_leave(p_class_session_id uuid, p_student_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_class_session_id::text || ':' || p_student_id::text, 0)
  );
$$;

comment on function public.lock_session_student_leave(uuid, uuid) is
  'Story 7-5: transaction advisory lock for one (session, student), taken by the leave and decision BEFORE INSERT triggers.';

revoke all on function public.lock_session_student_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lock_session_student_leave(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Decisions: BEFORE INSERT (stamp, only a current Sick is decided)
-- ---------------------------------------------------------------------------

create or replace function public.trg_sick_leave_decision_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_answer text;
begin
  select s.class_id into v_class_id
  from public.class_sessions s
  where s.id = new.class_session_id;

  if v_class_id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  -- A signed-in caller must pass the insert policy's rule. Checked first
  -- (a BEFORE trigger runs ahead of the RLS WITH CHECK), so nobody else
  -- learns whether the student is Sick. auth.uid() is NULL only for the
  -- trusted paths (the auto-approval job, the service role).
  if auth.uid() is not null and not (
    (public.is_admin() or public.is_teacher_of_class(v_class_id))
    and not public.is_parent_of(new.student_id)
  ) then
    raise exception 'not allowed to decide this sick leave'
      using errcode = '42501';
  end if;

  perform public.lock_session_student_leave(new.class_session_id, new.student_id);

  -- Never the client's values.
  new.decided_by := auth.uid();
  new.decided_at := now();

  select h.answer into v_answer
  from public.session_leave_history h
  where h.class_session_id = new.class_session_id
    and h.student_id = new.student_id
  order by h.answered_at desc, h.id desc
  limit 1;

  if v_answer is distinct from 'sick' then
    raise exception 'only a current Sick answer can be decided'
      using errcode = '22023', hint = 'leave_not_sick';
  end if;

  return new;
end;
$$;

revoke all on function public.trg_sick_leave_decision_before_insert() from public, anon, authenticated;

create trigger sick_leave_decisions_before_insert
  before insert on public.sick_leave_decisions
  for each row
  execute function public.trg_sick_leave_decision_before_insert();

-- AFTER INSERT: the week is recalculated through the one streak path.
create or replace function public.trg_sick_leave_decision_recompute_streak()
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

revoke all on function public.trg_sick_leave_decision_recompute_streak() from public, anon, authenticated;

create trigger sick_leave_decisions_recompute_streak
  after insert on public.sick_leave_decisions
  for each row
  execute function public.trg_sick_leave_decision_recompute_streak();

-- ---------------------------------------------------------------------------
-- Leave answers: refused once the session is decided (0027 body + lock +
-- leave_decided)
-- ---------------------------------------------------------------------------

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

  -- Story 7-5: a decided Sick locks the session's answers for good.
  perform public.lock_session_student_leave(new.class_session_id, new.student_id);
  if exists (
    select 1
    from public.sick_leave_decisions sd
    where sd.class_session_id = new.class_session_id
      and sd.student_id = new.student_id
  ) then
    raise exception 'sick leave for this session has been decided'
      using errcode = '22023', hint = 'leave_decided';
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
    -- Story 7-5 (decision 2): Sick only for sessions dated yesterday or
    -- today (Europe/Berlin) -- never ahead, never after the day after.
    if (now() at time zone 'Europe/Berlin')::date > v_day + 1
       or v_day > (now() at time zone 'Europe/Berlin')::date then
      raise exception 'sick can only be set for a session dated yesterday or today'
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

-- ---------------------------------------------------------------------------
-- approve_stale_sick_leave(): the daily catch-up job
-- ---------------------------------------------------------------------------

create or replace function public.approve_stale_sick_leave()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- decided_by is stamped from auth.uid(), which is NULL here (pg_cron and
  -- the service role carry no user): the system actor.
  insert into public.sick_leave_decisions (class_session_id, student_id, decision)
  select l.class_session_id, l.student_id, 'approved'
  from (
    select distinct on (h.class_session_id, h.student_id)
           h.class_session_id, h.student_id, h.answer
    from public.session_leave_history h
    order by h.class_session_id, h.student_id, h.answered_at desc, h.id desc
  ) l
  join public.class_sessions s on s.id = l.class_session_id
  join public.class_days d on d.id = s.class_day_id
  where l.answer = 'sick'
    -- A cancelled session (or class day) has nothing to decide.
    and not (s.cancelled or d.cancelled)
    and not exists (
      select 1
      from public.sick_leave_decisions sd
      where sd.class_session_id = l.class_session_id
        and sd.student_id = l.student_id
    )
    and public.session_starts_at(l.class_session_id) <= now() - interval '14 days'
  on conflict (class_session_id, student_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.approve_stale_sick_leave() is
  'Story 7-5: approves (system actor, decided_by NULL) every current Sick answer on a non-cancelled session with no decision whose session started at least 14 days ago. Idempotent and catches up after missed runs. Returns the number approved. service_role / pg_cron only.';

revoke all on function public.approve_stale_sick_leave() from public, anon, authenticated;
grant execute on function public.approve_stale_sick_leave() to service_role;

-- Daily, like the 0005 generator; a fixed name keeps re-runs idempotent.
select cron.schedule(
  'approve-stale-sick-leave',
  '15 3 * * *',
  $$select public.approve_stale_sick_leave();$$
);

-- ---------------------------------------------------------------------------
-- sick_leave_queue(): the teacher / admin Sick leave list
-- ---------------------------------------------------------------------------

create or replace function public.sick_leave_queue()
returns table (
  class_session_id uuid,
  student_id uuid,
  student_name text,
  class_id uuid,
  class_name text,
  day date,
  start_time time,
  answered_at timestamptz,
  decision text,
  decided_at timestamptz,
  decided_by_system boolean,
  own_child boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select l.class_session_id,
         l.student_id,
         coalesce(p.display_name, p.registration_name, ''),
         s.class_id,
         c.name,
         d.day,
         coalesce(s.start_time_override, c.default_start_time),
         l.answered_at,
         sd.decision,
         sd.decided_at,
         (sd.id is not null and sd.decided_by is null),
         public.is_parent_of(l.student_id)
  from (
    select distinct on (h.class_session_id, h.student_id)
           h.class_session_id, h.student_id, h.answer, h.answered_at
    from public.session_leave_history h
    order by h.class_session_id, h.student_id, h.answered_at desc, h.id desc
  ) l
  join public.class_sessions s on s.id = l.class_session_id
  join public.class_days d on d.id = s.class_day_id
  join public.classes c on c.id = s.class_id
  join public.profiles p on p.id = l.student_id
  left join public.sick_leave_decisions sd
    on sd.class_session_id = l.class_session_id
   and sd.student_id = l.student_id
  where l.answer = 'sick'
    and not (s.cancelled or d.cancelled)
    and (public.is_admin() or public.is_teacher_of_class(s.class_id))
  order by d.day, coalesce(s.start_time_override, c.default_start_time) nulls first, lower(coalesce(p.display_name, ''));
$$;

comment on function public.sick_leave_queue() is
  'Story 7-5: current Sick answers on non-cancelled sessions of the classes the caller teaches (every class for the admin), with the decision (NULL = pending), whether the system decided it, and own_child = the caller is the student''s parent (no decision controls). Anyone else gets no rows.';

revoke all on function public.sick_leave_queue() from public, anon;
grant execute on function public.sick_leave_queue() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Streak: approved Sick also protects the week (0027 body + approved sick)
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
  'The streak rule (Stories 6-2, 7-4, 7-5), without writing anything: consecutive qualifying weeks (present at a non-cancelled session + homework done) walking back from the ISO week containing p_as_of_week (default: today in Europe/Berlin). A week counts only if one of the student''s classes has a non-cancelled session with at least one mark in it; other weeks are holidays and consume no grace (app_settings.streak_grace_weeks). A week the student missed entirely, with planned On leave or approved Sick as the latest answer for every marked session they missed, is also treated as a holiday. Called by recompute_student_streak; service role may call it for tests.';

revoke all on function public.compute_student_streak(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.compute_student_streak(uuid, uuid, date) to service_role;
