-- 0018_calendar.sql
--
-- Story 6-1 (CAP-9, CAP-10): class days and sessions.
--
-- * class_days: school-wide dates on which classes happen. Admin-owned,
--   readable by every signed-in user. Never hard-deleted: "removing" a day
--   sets class_days.cancelled, and restoring it clears that flag again.
-- * classes.default_start_time / default_duration_minutes: each class's
--   default schedule, set by the admin or any teacher of the class through
--   set_class_default() (like set_class_syllabus in 0014: there is no teacher
--   UPDATE policy on classes, which would expose name and code too).
-- * class_sessions: one row per (class, class day), created by triggers only.
--   Nullable overrides replace the class default for that one day; a NULL
--   override follows the default, so a default change reaches every
--   non-overridden session. The session's own cancelled flag is separate
--   from the day's, so restoring a day returns each session's prior state.
-- * class_sessions_effective: security_invoker view resolving the effective
--   start time / duration and cancelled state.
--
-- Times are Munich-local wall-clock values (`time` + `date`), not instants.
-- Attendance, streaks and badges are untouched here (Story 6-2).

-- ---------------------------------------------------------------------------
-- Class defaults
-- ---------------------------------------------------------------------------

alter table public.classes
  add column default_start_time time,
  add column default_duration_minutes integer
    constraint classes_default_duration_range
      check (default_duration_minutes between 15 and 480);

comment on column public.classes.default_start_time is
  'Default Munich-local start time of this class''s sessions (Story 6-1). NULL = not set yet.';
comment on column public.classes.default_duration_minutes is
  'Default length of this class''s sessions in minutes, 15-480 (Story 6-1). NULL = not set yet.';

create or replace function public.set_class_default(
  p_class_id uuid,
  p_start_time time,
  p_duration_minutes integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to edit this class''s schedule'
      using errcode = '42501';
  end if;

  update public.classes
  set default_start_time = p_start_time,
      default_duration_minutes = p_duration_minutes
  where id = p_class_id;

  if not found then
    raise exception 'class not found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.set_class_default(uuid, time, integer) is
  'Sets a class''s default start time and duration (Story 6-1). Admin or any teacher of the class; only writes those two columns.';

revoke all on function public.set_class_default(uuid, time, integer) from public, anon;
grant execute on function public.set_class_default(uuid, time, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Class days
-- ---------------------------------------------------------------------------

create table public.class_days (
  id uuid primary key default gen_random_uuid(),
  day date not null
    constraint class_days_day_unique unique,
  cancelled boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.class_days is
  'School-wide dates on which classes happen (Story 6-1). Admin-written, readable by every signed-in user. Never deleted: cancelled = removed, and every session on the day counts as cancelled.';

alter table public.class_days enable row level security;

create policy "class_days_select_signed_in"
  on public.class_days for select
  to authenticated
  using (true);

create policy "class_days_insert_admin"
  on public.class_days for insert
  with check (public.is_admin());

create policy "class_days_update_admin"
  on public.class_days for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy: removing a day is a soft cancel. The date and author
-- can't be changed after creation.
revoke insert, update, delete on public.class_days from authenticated;
grant insert (day) on public.class_days to authenticated;
grant update (cancelled) on public.class_days to authenticated;

-- ---------------------------------------------------------------------------
-- Class sessions
-- ---------------------------------------------------------------------------

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  class_day_id uuid not null references public.class_days (id) on delete cascade,
  start_time_override time,
  duration_minutes_override integer
    constraint class_sessions_duration_override_range
      check (duration_minutes_override between 15 and 480),
  cancelled boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint class_sessions_one_per_class_day unique (class_id, class_day_id)
);

comment on table public.class_sessions is
  'One session per class per class day (Story 6-1), created by triggers only. NULL overrides follow the class default. cancelled is the session''s own flag, independent of class_days.cancelled.';

create index class_sessions_class_day_id_idx on public.class_sessions (class_day_id);

alter table public.class_sessions enable row level security;

create policy "class_sessions_select"
  on public.class_sessions for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_enrolled_in_class(auth.uid(), class_id)
  );

create policy "class_sessions_update_admin_or_teacher"
  on public.class_sessions for update
  using (public.is_admin() or public.is_teacher_of_class(class_id))
  with check (public.is_admin() or public.is_teacher_of_class(class_id));

-- Rows come from the triggers below only (no insert/delete policy); a
-- session can't be moved to another class or day.
revoke insert, update, delete on public.class_sessions from authenticated;
grant update (start_time_override, duration_minutes_override, cancelled)
  on public.class_sessions to authenticated;

-- Who changed a session and when is stamped server-side, never trusted from
-- the client.
create or replace function public.stamp_class_session_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger class_sessions_stamp_update
  before update on public.class_sessions
  for each row
  execute function public.stamp_class_session_update();

-- A new class day gets a session for every class ...
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
  on conflict on constraint class_sessions_one_per_class_day do nothing;
  return new;
end;
$$;

create trigger class_days_create_sessions
  after insert on public.class_days
  for each row
  execute function public.create_sessions_for_class_day();

-- ... and a new class gets a session on every existing class day
-- (cancelled days included, so restoring such a day brings its sessions back).
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
  on conflict on constraint class_sessions_one_per_class_day do nothing;
  return new;
end;
$$;

create trigger classes_create_sessions
  after insert on public.classes
  for each row
  execute function public.create_sessions_for_class();

revoke all on function public.create_sessions_for_class_day() from public, anon, authenticated;
revoke all on function public.create_sessions_for_class() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Effective view
-- ---------------------------------------------------------------------------

create view public.class_sessions_effective
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
  s.updated_at
from public.class_sessions s
join public.class_days d on d.id = s.class_day_id
join public.classes c on c.id = s.class_id;

comment on view public.class_sessions_effective is
  'Sessions with effective start time / duration (override, else class default) and cancelled = session or day cancelled (Story 6-1). security_invoker: the caller''s RLS on class_sessions, class_days and classes applies.';

revoke all on public.class_sessions_effective from anon;
grant select on public.class_sessions_effective to authenticated;
