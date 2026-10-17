-- 0052_class_day_move_delete.sql
--
-- Issue #105 (SPEC-class-day-admin): the admin moves a future class day to
-- another future date, or deletes an untouched future one.
--
-- * class_days.moved (default false): set by a trigger whenever a day's date
--   changes. regenerate_class_sessions keeps a moved day's sessions, so a
--   later schedule edit never deletes what the admin moved there.
-- * A move is `update class_days set day = ...`. Sessions follow through
--   class_day_id (their date comes from the day), and so do the leave
--   answers (classification stays as answered) and sick-leave decisions on
--   them. attendance_records.session_date, a copy of the day, is updated by
--   class_days_follow_move. A moved day keeps exactly its own sessions:
--   regenerate_class_sessions neither removes nor adds any on it.
-- * Rules, enforced by BEFORE triggers so they hold whatever the client does
--   (AD-2); an RLS policy can't tell a date change from a cancel:
--     - a move: the day and the target date are both after today (Berlin),
--       else SQLSTATE CD001. A target that already has a class day fails on
--       class_days_day_unique (23505).
--     - a delete: the day is after today (Berlin), else CD001; none of its
--       sessions has an attendance record, a leave answer or a sick-leave
--       decision, else CD002 (the app points to Cancel day).
--   Cancel / restore (an update of cancelled only) is not guarded, so past
--   days keep working as before.
-- * The rules apply to client requests (auth.role() authenticated / anon).
--   The service role and direct database sessions (migrations, seeds, test
--   fixtures) are not limited by them.
-- * Admin-only: a new delete policy, plus the column grant update (day) and
--   delete. Non-admins are stopped by RLS (zero rows), as for cancel.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

alter table public.class_days
  add column moved boolean not null default false;

comment on column public.class_days.moved is
  'True once the day''s date has been changed (issue #105). Set by the class_days_guard_move trigger, never by the client. regenerate_class_sessions keeps a moved day''s sessions.';

comment on table public.class_days is
  'School-wide dates on which classes happen (Story 6-1). Admin-written, readable by every signed-in user. cancelled = soft removal; a future day can be moved (moved = true) or, while untouched, deleted (issue #105).';

-- ---------------------------------------------------------------------------
-- Policies and grants
-- ---------------------------------------------------------------------------

create policy "class_days_delete_admin"
  on public.class_days for delete
  using ((select public.is_admin()));

grant update (day) on public.class_days to authenticated;
grant delete on public.class_days to authenticated;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create or replace function public.class_days_guard_move()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if new.day is not distinct from old.day then
    return new;
  end if;

  if coalesce(auth.role(), '') in ('authenticated', 'anon')
    and (old.day <= v_today or new.day <= v_today) then
    raise exception 'only future class days can be moved, and only to a future date'
      using errcode = 'CD001';
  end if;

  new.moved := true;
  return new;
end;
$$;

comment on function public.class_days_guard_move() is
  'Trigger (issue #105): a client may move a class day only when the day and the new date are after today (Berlin), else SQLSTATE CD001. Marks the day moved.';

revoke all on function public.class_days_guard_move() from public, anon, authenticated;

create trigger class_days_guard_move
  before update of day on public.class_days
  for each row
  execute function public.class_days_guard_move();

-- attendance_records.session_date is a copy of the day, stamped at insert
-- (0021): a move carries it to the new date. Security definer, so every mark
-- on the day follows, not only those the caller's RLS shows.
create or replace function public.class_days_follow_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attendance_records a
  set session_date = new.day
  from public.class_sessions s
  where s.class_day_id = new.id
    and a.class_session_id = s.id
    and a.session_date is distinct from new.day;
  return null;
end;
$$;

comment on function public.class_days_follow_move() is
  'Trigger (issue #105): after a class day''s date changes, moves attendance_records.session_date of its sessions'' marks to the new date.';

revoke all on function public.class_days_follow_move() from public, anon, authenticated;

create trigger class_days_follow_move
  after update of day on public.class_days
  for each row
  when (old.day is distinct from new.day)
  execute function public.class_days_follow_move();

-- Security definer: the "untouched" check must see every attendance record,
-- answer and decision, not only those the admin's RLS shows.
create or replace function public.class_days_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return old;
  end if;

  if old.day <= (now() at time zone 'Europe/Berlin')::date then
    raise exception 'only future class days can be deleted'
      using errcode = 'CD001';
  end if;

  -- Locks the day's sessions, so an answer or decision inserted meanwhile
  -- (its foreign key check needs a key-share lock on the session) waits for
  -- this delete and then finds its session gone.
  perform 1
  from public.class_sessions s
  where s.class_day_id = old.id
  for update;

  if exists (
    select 1
    from public.class_sessions s
    where s.class_day_id = old.id
      and (
        exists (select 1 from public.attendance_records a where a.class_session_id = s.id)
        or exists (select 1 from public.session_leave_history h where h.class_session_id = s.id)
        or exists (select 1 from public.sick_leave_decisions k where k.class_session_id = s.id)
      )
  ) then
    raise exception 'this class day has attendance, answers or sick-leave decisions; cancel it instead'
      using errcode = 'CD002';
  end if;

  return old;
end;
$$;

comment on function public.class_days_guard_delete() is
  'Trigger (issue #105): a client may delete a class day only when it is after today (Berlin), else CD001, and none of its sessions has attendance, a leave answer or a sick-leave decision, else CD002.';

revoke all on function public.class_days_guard_delete() from public, anon, authenticated;

create trigger class_days_guard_delete
  before delete on public.class_days
  for each row
  execute function public.class_days_guard_delete();

-- ---------------------------------------------------------------------------
-- regenerate_class_sessions: 0026 body, keeping moved days' sessions
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
  -- Future scheduled sessions that no longer match go; extras, sessions with
  -- attendance marks and sessions on moved days (issue #105) stay. A moved
  -- day is never touched: no session is removed from it or added to it.
  delete from public.class_sessions s
  using public.class_days d
  where d.id = s.class_day_id
    and s.class_id = new.id
    and not s.extra
    and not d.moved
    and d.day >= v_today
    and not public.class_schedule_matches(
      d.day, new.schedule_weekdays, new.schedule_starts_on, new.schedule_ends_on,
      new.schedule_interval_weeks
    )
    and not exists (
      select 1 from public.attendance_records a where a.class_session_id = s.id
    );

  -- A moved day keeps exactly its own sessions: none are added either.
  insert into public.class_sessions (class_id, class_day_id)
  select new.id, d.id
  from public.class_days d
  where d.day >= v_today
    and not d.moved
    and public.class_schedule_matches(
      d.day, new.schedule_weekdays, new.schedule_starts_on, new.schedule_ends_on,
      new.schedule_interval_weeks
    )
  on conflict on constraint class_sessions_one_per_class_day do nothing;

  return new;
end;
$$;

revoke all on function public.regenerate_class_sessions() from public, anon, authenticated;
