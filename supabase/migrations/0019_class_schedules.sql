-- 0019_class_schedules.sql
--
-- Story 6-4 (CAP-10 as amended 2026-09-26): class schedules and extra sessions.
--
-- * classes.schedule_weekdays / schedule_starts_on / schedule_ends_on: each
--   class's one schedule (ISO weekdays 1 = Mon .. 7 = Sun, a start date and an
--   optional end date). The time of day stays classes.default_start_time /
--   default_duration_minutes (0018). A new class defaults to Sunday only,
--   from today (Berlin), no end, time unset.
-- * A class gets a session on a class day only when the schedule matches it:
--     extract(isodow from day) = any(schedule_weekdays)
--     and day >= schedule_starts_on
--     and (schedule_ends_on is null or day <= schedule_ends_on)
--   Cancelled class days count as class days. The 0018 triggers that gave
--   every class a session on every class day are replaced accordingly.
-- * Changing a schedule regenerates the class's sessions dated today (Berlin)
--   or later: still-matching sessions keep their overrides and cancel flag,
--   non-matching non-extra sessions are removed, missing ones are added.
--   Sessions before today are never touched; extra sessions are never removed.
--   Regeneration runs in the same transaction as the schedule change, as the
--   table owner (SECURITY DEFINER), so no client needs insert/delete on
--   class_sessions. It is fired by an AFTER UPDATE OF <schedule columns>
--   trigger on classes, so set_class_schedule() and any other schedule write
--   (the admin's own classes UPDATE policy, service-role fixtures) regenerate
--   alike.
-- * class_sessions.extra: a one-off session added by add_extra_session() on a
--   class day outside the schedule.
-- * Backfill: every existing session is kept unchanged; each existing class's
--   schedule is derived from its sessions (weekdays = distinct ISO weekdays of
--   their class days, else Sunday; start = earliest such day, else today; no
--   end). The migration aborts if the sessions change.
--
-- Attendance, streaks and leave are untouched here (Stories 6-2, 6-3).

-- ---------------------------------------------------------------------------
-- Snapshot of every session before the change (checked at the end)
-- ---------------------------------------------------------------------------

create temporary table _0019_sessions_before as
select id, class_id, class_day_id, start_time_override, duration_minutes_override, cancelled
from public.class_sessions;

-- ---------------------------------------------------------------------------
-- Schedule columns + backfill
-- ---------------------------------------------------------------------------

alter table public.classes
  add column schedule_weekdays smallint[],
  add column schedule_starts_on date,
  add column schedule_ends_on date;

-- The backfill rule, as a function so it can be tested (service role only).
create or replace function public.class_schedule_from_sessions(
  p_class_id uuid,
  out weekdays smallint[],
  out starts_on date
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(
      array_agg(distinct extract(isodow from d.day)::smallint
        order by extract(isodow from d.day)::smallint),
      array[7]::smallint[]
    ),
    coalesce(min(d.day), (now() at time zone 'Europe/Berlin')::date)
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  where s.class_id = p_class_id;
$$;

comment on function public.class_schedule_from_sessions(uuid) is
  'Schedule derived from a class''s existing sessions, used by the 0019 backfill (Story 6-4): distinct ISO weekdays of their class days (else Sunday) and the earliest such day (else today, Berlin).';

revoke all on function public.class_schedule_from_sessions(uuid) from public, anon, authenticated;
grant execute on function public.class_schedule_from_sessions(uuid) to service_role;

update public.classes c
set (schedule_weekdays, schedule_starts_on) = (
  select f.weekdays, f.starts_on from public.class_schedule_from_sessions(c.id) f
);

alter table public.classes
  alter column schedule_weekdays set default array[7]::smallint[],
  alter column schedule_weekdays set not null,
  alter column schedule_starts_on set default ((now() at time zone 'Europe/Berlin')::date),
  alter column schedule_starts_on set not null,
  add constraint classes_schedule_weekdays_valid
    check (
      cardinality(schedule_weekdays) between 1 and 7
      and array_position(schedule_weekdays, null) is null
      and 1 <= all (schedule_weekdays)
      and 7 >= all (schedule_weekdays)
    ),
  add constraint classes_schedule_ends_after_start
    check (schedule_ends_on is null or schedule_ends_on >= schedule_starts_on);

comment on column public.classes.schedule_weekdays is
  'ISO weekdays (1 = Monday .. 7 = Sunday) on which this class has a session, if the day is a class day (Story 6-4).';
comment on column public.classes.schedule_starts_on is
  'First date the class''s schedule covers (Story 6-4). Defaults to today in Europe/Berlin.';
comment on column public.classes.schedule_ends_on is
  'Last date the class''s schedule covers (Story 6-4). NULL = no end.';

-- ---------------------------------------------------------------------------
-- Extra sessions
-- ---------------------------------------------------------------------------

alter table public.class_sessions
  add column extra boolean not null default false;

comment on column public.class_sessions.extra is
  'True for a one-off session added outside the class''s schedule (Story 6-4). Never removed by schedule regeneration.';

-- ---------------------------------------------------------------------------
-- Schedule matching
-- ---------------------------------------------------------------------------

create or replace function public.class_schedule_matches(
  p_day date,
  p_weekdays smallint[],
  p_starts_on date,
  p_ends_on date
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select extract(isodow from p_day)::smallint = any (p_weekdays)
    and p_day >= p_starts_on
    and (p_ends_on is null or p_day <= p_ends_on);
$$;

comment on function public.class_schedule_matches(date, smallint[], date, date) is
  'True when a class day falls on the schedule: weekday in p_weekdays and between p_starts_on and p_ends_on (inclusive; NULL end = open) (Story 6-4).';

-- A new class day gets a session for every class whose schedule matches it.
create or replace function public.create_sessions_for_class_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.class_sessions (class_id, class_day_id)
  select c.id, new.id
  from public.classes c
  where public.class_schedule_matches(
    new.day, c.schedule_weekdays, c.schedule_starts_on, c.schedule_ends_on
  )
  on conflict on constraint class_sessions_one_per_class_day do nothing;
  return new;
end;
$$;

-- A new class gets a session on every existing class day its schedule
-- matches (cancelled days included, so restoring such a day brings them back).
create or replace function public.create_sessions_for_class()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.class_sessions (class_id, class_day_id)
  select new.id, d.id
  from public.class_days d
  where public.class_schedule_matches(
    d.day, new.schedule_weekdays, new.schedule_starts_on, new.schedule_ends_on
  )
  on conflict on constraint class_sessions_one_per_class_day do nothing;
  return new;
end;
$$;

-- The 0018 triggers keep their names and now call the functions above.

-- Regenerates a class's sessions dated today (Berlin) or later after its
-- schedule changed.
create or replace function public.regenerate_class_sessions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  -- Future scheduled sessions that no longer match go; extras stay.
  delete from public.class_sessions s
  using public.class_days d
  where d.id = s.class_day_id
    and s.class_id = new.id
    and not s.extra
    and d.day >= v_today
    and not public.class_schedule_matches(
      d.day, new.schedule_weekdays, new.schedule_starts_on, new.schedule_ends_on
    );

  -- Missing future matching sessions are added; existing ones (with their
  -- overrides and cancel flag, or an extra on that day) are kept.
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

create trigger classes_regenerate_sessions
  after update of schedule_weekdays, schedule_starts_on, schedule_ends_on on public.classes
  for each row
  execute function public.regenerate_class_sessions();

revoke all on function public.create_sessions_for_class_day() from public, anon, authenticated;
revoke all on function public.create_sessions_for_class() from public, anon, authenticated;
revoke all on function public.regenerate_class_sessions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_class_schedule
-- ---------------------------------------------------------------------------

create or replace function public.set_class_schedule(
  p_class_id uuid,
  p_weekdays smallint[],
  p_start_time time,
  p_duration_minutes integer,
  p_starts_on date,
  p_ends_on date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_weekdays smallint[];
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to edit this class''s schedule'
      using errcode = '42501';
  end if;

  select array_agg(distinct w order by w) into v_weekdays
  from unnest(p_weekdays) as w;

  if v_weekdays is null
    or array_position(v_weekdays, null) is not null
    or not (1 <= all (v_weekdays) and 7 >= all (v_weekdays)) then
    raise exception 'pick at least one weekday (1-7)' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'the schedule needs a start date' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'the end date must be on or after the start date' using errcode = '22023';
  end if;
  if p_duration_minutes is not null and p_duration_minutes not between 15 and 480 then
    raise exception 'duration must be 15-480 minutes' using errcode = '22023';
  end if;

  -- Sessions before today never change: a past session following the class
  -- time keeps the time it had, frozen into its own override, before the
  -- class time changes (a NULL old time stays NULL). Writes nothing when the
  -- time does not change.
  update public.class_sessions s
  set start_time_override = case
        when s.start_time_override is null
          and c.default_start_time is distinct from p_start_time
        then c.default_start_time
        else s.start_time_override
      end,
      duration_minutes_override = case
        when s.duration_minutes_override is null
          and c.default_duration_minutes is distinct from p_duration_minutes
        then c.default_duration_minutes
        else s.duration_minutes_override
      end
  from public.class_days d, public.classes c
  where d.id = s.class_day_id
    and c.id = s.class_id
    and s.class_id = p_class_id
    and d.day < (now() at time zone 'Europe/Berlin')::date
    and (
      (s.start_time_override is null
        and c.default_start_time is not null
        and c.default_start_time is distinct from p_start_time)
      or (s.duration_minutes_override is null
        and c.default_duration_minutes is not null
        and c.default_duration_minutes is distinct from p_duration_minutes)
    );

  -- Writing the schedule columns fires classes_regenerate_sessions.
  update public.classes
  set schedule_weekdays = v_weekdays,
      schedule_starts_on = p_starts_on,
      schedule_ends_on = p_ends_on,
      default_start_time = p_start_time,
      default_duration_minutes = p_duration_minutes
  where id = p_class_id;

  if not found then
    raise exception 'class not found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.set_class_schedule(uuid, smallint[], time, integer, date, date) is
  'Sets a class''s schedule (weekdays, start time, duration, start/end date) and regenerates its sessions from today (Berlin) on (Story 6-4). Past sessions keep their displayed time (frozen into their overrides). Admin or any teacher of the class.';

revoke all on function public.set_class_schedule(uuid, smallint[], time, integer, date, date) from public, anon;
grant execute on function public.set_class_schedule(uuid, smallint[], time, integer, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- add_extra_session
-- ---------------------------------------------------------------------------

create or replace function public.add_extra_session(
  p_class_id uuid,
  p_class_day_id uuid,
  p_start_time time,
  p_duration_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to add a session to this class'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.classes where id = p_class_id) then
    raise exception 'class not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.class_days where id = p_class_day_id) then
    raise exception 'class day not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.class_days where id = p_class_day_id and cancelled) then
    raise exception 'the class day is cancelled' using errcode = '22023';
  end if;
  if p_duration_minutes is not null and p_duration_minutes not between 15 and 480 then
    raise exception 'duration must be 15-480 minutes' using errcode = '22023';
  end if;

  insert into public.class_sessions (
    class_id, class_day_id, start_time_override, duration_minutes_override, extra, updated_by
  )
  values (p_class_id, p_class_day_id, p_start_time, p_duration_minutes, true, auth.uid())
  on conflict on constraint class_sessions_one_per_class_day do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'the class already has a session on this day' using errcode = '23505';
  end if;
  return v_id;
end;
$$;

comment on function public.add_extra_session(uuid, uuid, time, integer) is
  'Adds a one-off (extra) session of a class on a class day (Story 6-4). Admin or any teacher of the class; 23505 if the class already has a session that day, 22023 if the day is cancelled.';

revoke all on function public.add_extra_session(uuid, uuid, time, integer) from public, anon;
grant execute on function public.add_extra_session(uuid, uuid, time, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Effective view: + extra
-- ---------------------------------------------------------------------------

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
  s.extra
from public.class_sessions s
join public.class_days d on d.id = s.class_day_id
join public.classes c on c.id = s.class_id;

comment on view public.class_sessions_effective is
  'Sessions with effective start time / duration (override, else class default), cancelled = session or day cancelled, and extra (Stories 6-1, 6-4). security_invoker: the caller''s RLS on class_sessions, class_days and classes applies.';

revoke all on public.class_sessions_effective from anon;
grant select on public.class_sessions_effective to authenticated;

-- ---------------------------------------------------------------------------
-- Every session kept, unchanged
-- ---------------------------------------------------------------------------

do $$
declare
  v_before bigint;
  v_after bigint;
  v_changed bigint;
begin
  select count(*) into v_before from _0019_sessions_before;
  select count(*) into v_after from public.class_sessions;
  if v_before <> v_after then
    raise exception '0019: class_sessions count changed from % to %', v_before, v_after;
  end if;

  select count(*) into v_changed
  from _0019_sessions_before b
  left join public.class_sessions s on s.id = b.id
  where s.id is null
    or s.class_id <> b.class_id
    or s.class_day_id <> b.class_day_id
    or s.start_time_override is distinct from b.start_time_override
    or s.duration_minutes_override is distinct from b.duration_minutes_override
    or s.cancelled <> b.cancelled
    or s.extra;
  if v_changed <> 0 then
    raise exception '0019: % existing class_sessions changed', v_changed;
  end if;

  -- Every existing session matches its class's derived schedule.
  select count(*) into v_changed
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  join public.classes c on c.id = s.class_id
  where not public.class_schedule_matches(
    d.day, c.schedule_weekdays, c.schedule_starts_on, c.schedule_ends_on
  );
  if v_changed <> 0 then
    raise exception '0019: % existing class_sessions do not match the derived schedule', v_changed;
  end if;
end;
$$;

drop table _0019_sessions_before;
