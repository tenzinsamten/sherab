-- 0036_localized_names.sql
--
-- #76 (2026-10-03): classes and teams get a name per supported language.
-- `name` stays the English name; name_bo (Tibetan) and name_de (German) are
-- new. The app shows the name of the viewer's language and falls back to
-- `name` when that language has none (src/lib/localized-name.ts).
--
-- Both new columns are nullable: existing rows have neither, and German is
-- optional. That Tibetan is required for a new or edited class / team is the
-- forms' rule, not the database's.
--
-- Everything that returns a class or team name now returns the two new
-- names next to it. Existing columns are unchanged, so the deployed code
-- keeps working between `db push` and the new deploy. request_class_join
-- (0031, returns the English name as text) is left alone for the same
-- reason; the app reads the names through validate_class_code instead.

alter table public.classes
  add column name_bo text
    constraint classes_name_bo_not_blank check (name_bo is null or btrim(name_bo) <> ''),
  add column name_de text
    constraint classes_name_de_not_blank check (name_de is null or btrim(name_de) <> '');

alter table public.teams
  add column name_bo text
    constraint teams_name_bo_not_blank check (name_bo is null or btrim(name_bo) <> ''),
  add column name_de text
    constraint teams_name_de_not_blank check (name_de is null or btrim(name_de) <> '');

comment on column public.classes.name is 'English name; the fallback for a language with no name.';
comment on column public.classes.name_bo is 'Tibetan name (NULL = show the English name).';
comment on column public.classes.name_de is 'German name (NULL = show the English name).';
comment on column public.teams.name is 'English name; the fallback for a language with no name.';
comment on column public.teams.name_bo is 'Tibetan name (NULL = show the English name).';
comment on column public.teams.name_de is 'German name (NULL = show the English name).';

-- Unique per language, the same rule as the English name (0010, 0012).
create unique index classes_name_bo_unique_idx
  on public.classes (lower(btrim(name_bo))) where name_bo is not null;
create unique index classes_name_de_unique_idx
  on public.classes (lower(btrim(name_de))) where name_de is not null;
create unique index teams_name_bo_unique_idx
  on public.teams (lower(btrim(name_bo))) where name_bo is not null;
create unique index teams_name_de_unique_idx
  on public.teams (lower(btrim(name_de))) where name_de is not null;

-- Admins may rename a team (classes have classes_update_admin since 0001).
create policy "teams_update_admin"
  on public.teams for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- validate_class_code (0002) + name_bo, name_de
-- ---------------------------------------------------------------------------

drop function public.validate_class_code(text);

create function public.validate_class_code(p_code text)
returns table (id uuid, name text, name_bo text, name_de text)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.name, c.name_bo, c.name_de
  from public.classes c
  where c.code = upper(btrim(p_code));
$$;

comment on function public.validate_class_code(text) is
  'Returns zero rows for an unknown/malformed code. SECURITY DEFINER so the join wizard can look up a class before the visitor has any session. Parameter is p_code (not code) to avoid ambiguity with classes.code in the WHERE clause. Returns the class''s names in every language (0036).';

grant execute on function public.validate_class_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- team_leaderboard (0009) + team_name_bo, team_name_de
-- ---------------------------------------------------------------------------

drop function public.team_leaderboard();

create function public.team_leaderboard()
returns table (
  team_id uuid,
  team_name text,
  total_streak integer,
  team_name_bo text,
  team_name_de text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id as team_id,
    t.name as team_name,
    -- SUM(integer) is bigint; current_streak is integer (0007), so the
    -- total is cast back down to match the declared column type (0009).
    coalesce(sum(ss.current_streak), 0)::integer as total_streak,
    t.name_bo as team_name_bo,
    t.name_de as team_name_de
  from public.teams t
  left join public.profiles p
    on p.team_id = t.id
    and p.role = 'student'
    and p.status = 'approved'
  left join public.student_streaks ss
    on ss.student_id = p.id
  group by t.id, t.name, t.name_bo, t.name_de
  order by total_streak desc, t.name asc;
$$;

comment on function public.team_leaderboard() is
  'Read-time aggregate (never stored/materialized, per Epic 4 context''s explicit decision) -- SUM of student_streaks.current_streak per team, scoped to approved students with a team assigned. SECURITY DEFINER so it can read across every student''s student_streaks row (bypassing that table''s own admin/teacher/own-row RLS by design, same precedent as validate_class_code) without exposing any individual student''s streak value through this function''s return shape -- only the per-team total. Every team appears even with a zero total (LEFT JOIN + COALESCE); ordered total_streak DESC, team_name ASC for a deterministic tie-break. Returns the team''s names in every language (0036).';

grant execute on function public.team_leaderboard() to authenticated;

-- ---------------------------------------------------------------------------
-- list_enrollable_students (0016) + class_names_bo, class_names_de
-- (each class's name in that language, else its English name)
-- ---------------------------------------------------------------------------

drop function public.list_enrollable_students(uuid);

create function public.list_enrollable_students(p_class_id uuid)
returns table (
  id uuid,
  display_name text,
  email text,
  class_names text,
  class_names_bo text,
  class_names_de text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to list students for class %', p_class_id
      using errcode = '42501';
  end if;

  return query
  select
    p.id,
    coalesce(p.display_name, p.registration_name),
    p.email,
    coalesce(string_agg(c.name, ', ' order by c.name), ''),
    coalesce(
      string_agg(coalesce(c.name_bo, c.name), ', ' order by coalesce(c.name_bo, c.name)),
      ''
    ),
    coalesce(
      string_agg(coalesce(c.name_de, c.name), ', ' order by coalesce(c.name_de, c.name)),
      ''
    )
  from public.profiles p
  left join public.class_enrollments e on e.student_id = p.id
  left join public.classes c on c.id = e.class_id
  where p.role = 'student'
    and p.status = 'approved'
    and not public.is_enrolled_in_class(p.id, p_class_id)
  group by p.id, p.display_name, p.registration_name, p.email
  order by coalesce(p.display_name, p.registration_name);
end;
$$;

revoke all on function public.list_enrollable_students(uuid) from public, anon;
grant execute on function public.list_enrollable_students(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- class_sessions_effective (0027) + class_name_bo, class_name_de (appended;
-- the earlier columns are unchanged)
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
  s.extra,
  public.session_starts_at(s.id) as starts_at,
  c.name_bo as class_name_bo,
  c.name_de as class_name_de
from public.class_sessions s
join public.class_days d on d.id = s.class_day_id
join public.classes c on c.id = s.class_id;

comment on view public.class_sessions_effective is
  'Sessions with effective start time / duration (override, else class default), cancelled = session or day cancelled, extra (Stories 6-1, 6-4), starts_at = session_starts_at() (Story 7-4) and the class''s names in every language (0036). security_invoker: the caller''s RLS on class_sessions, class_days and classes applies.';

-- ---------------------------------------------------------------------------
-- child_attendance (0025) + class_name_bo, class_name_de
-- ---------------------------------------------------------------------------

drop function public.child_attendance(uuid);

create function public.child_attendance(p_student_id uuid)
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
  from public.attendance_records a
  join public.classes c on c.id = a.class_id
  where a.student_id = p_student_id
  order by a.session_date desc, c.name;
end;
$$;

comment on function public.child_attendance(uuid) is
  'Story 7-3 (AD-12): the student''s own or a parent''s child''s attendance -- date, class (its names in every language, 0036) and present only; notes stay teacher-only.';

revoke all on function public.child_attendance(uuid) from public, anon;
grant execute on function public.child_attendance(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sick_leave_queue (0028) + class_name_bo, class_name_de
-- ---------------------------------------------------------------------------

drop function public.sick_leave_queue();

create function public.sick_leave_queue()
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
  own_child boolean,
  class_name_bo text,
  class_name_de text
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
         public.is_parent_of(l.student_id),
         c.name_bo,
         c.name_de
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
  'Story 7-5: current Sick answers on non-cancelled sessions of the classes the caller teaches (every class for the admin), with the decision (NULL = pending), whether the system decided it, own_child = the caller is the student''s parent (no decision controls) and the class''s names in every language (0036). Anyone else gets no rows.';

revoke all on function public.sick_leave_queue() from public, anon;
grant execute on function public.sick_leave_queue() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- preview_leave_range / set_leave_range (0030) + class_name_bo, class_name_de
-- ---------------------------------------------------------------------------

drop function public.set_leave_range(uuid, date, date, uuid, text);
drop function public.preview_leave_range(uuid, date, date, uuid, text);

create function public.preview_leave_range(
  p_student uuid,
  p_from date,
  p_to date,
  p_class uuid default null,
  p_answer text default 'on_leave'
)
returns table (
  session_id uuid,
  day date,
  class_id uuid,
  class_name text,
  outcome text,
  class_name_bo text,
  class_name_de text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if not public.is_parent_of(p_student) then
    raise exception 'not allowed to set leave for this student'
      using errcode = '42501';
  end if;

  if p_from is null or p_to is null
     or p_from < v_today
     or p_to < p_from
     or p_to - p_from > 181 then
    raise exception 'the leave period must start today or later, end on or after its start and span at most 26 weeks (182 days including both)'
      using errcode = '22023', hint = 'leave_range_invalid';
  end if;

  if p_answer is null or p_answer not in ('on_leave', 'coming') then
    raise exception 'the answer must be on_leave or coming'
      using errcode = '22023', hint = 'leave_range_invalid';
  end if;

  return query
  select s.id,
         d.day,
         s.class_id,
         c.name,
         case
           -- The same order as trg_session_leave_before_insert (0028).
           when sd.id is not null then 'decided'
           when s.cancelled or d.cancelled then 'cancelled'
           when now() >= public.session_starts_at(s.id) then 'started'
           when l.answer = 'sick' then 'sick'
           when p_answer = 'on_leave' and l.answer = 'on_leave' then 'already_on_leave'
           when p_answer = 'on_leave' then public.classify_leave(s.id, now())
           when l.answer = 'on_leave' then 'coming'
           else 'already_coming'
         end,
         c.name_bo,
         c.name_de
  from public.class_sessions s
  join public.class_days d on d.id = s.class_day_id
  join public.classes c on c.id = s.class_id
  join public.class_enrollments e
    on e.class_id = s.class_id
   and e.student_id = p_student
  left join lateral (
    select h.answer
    from public.session_leave_history h
    where h.class_session_id = s.id
      and h.student_id = p_student
    order by h.answered_at desc, h.id desc
    limit 1
  ) l on true
  left join public.sick_leave_decisions sd
    on sd.class_session_id = s.id
   and sd.student_id = p_student
  where d.day between p_from and p_to
    and (p_class is null or s.class_id = p_class)
  order by d.day,
           coalesce(s.start_time_override, c.default_start_time) nulls first,
           lower(c.name),
           s.id;
end;
$$;

comment on function public.preview_leave_range(uuid, date, date, uuid, text) is
  'B11 (#57): what saving p_answer (on_leave / coming) for every session of the student''s enrolled classes (or only p_class) dated p_from..p_to (Europe/Berlin) would do, per session: planned / short_notice / coming (would change), already_on_leave / already_coming (untouched), started / cancelled / decided / sick (skipped). The student''s approved parent only (42501); p_from >= today, p_to >= p_from, p_to - p_from <= 181 (26 weeks inclusive), else 22023 hint leave_range_invalid. Writes nothing. Returns the class''s names in every language (0036).';

revoke all on function public.preview_leave_range(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.preview_leave_range(uuid, date, date, uuid, text) to authenticated, service_role;

create function public.set_leave_range(
  p_student uuid,
  p_from date,
  p_to date,
  p_class uuid,
  p_answer text
)
returns table (
  session_id uuid,
  day date,
  class_id uuid,
  class_name text,
  outcome text,
  class_name_bo text,
  class_name_de text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  v_current text;
  v_classification text;
  v_hint text;
begin
  -- Permission first: nobody else learns anything about the input.
  if not public.is_parent_of(p_student) then
    raise exception 'not allowed to set leave for this student'
      using errcode = '42501';
  end if;

  if p_answer is null or p_answer not in ('on_leave', 'coming') then
    raise exception 'the answer must be on_leave or coming'
      using errcode = '22023', hint = 'leave_range_invalid';
  end if;

  -- The limits are preview_leave_range's.
  for r in
    select * from public.preview_leave_range(p_student, p_from, p_to, p_class, p_answer)
  loop
    session_id := r.session_id;
    day := r.day;
    class_id := r.class_id;
    class_name := r.class_name;
    class_name_bo := r.class_name_bo;
    class_name_de := r.class_name_de;
    outcome := r.outcome;

    if r.outcome in ('planned', 'short_notice', 'coming') then
      -- The trigger's lock (lock_session_student_leave's key), then the
      -- latest answer again: one saved since the preview (another tab, the
      -- other parent) is left alone.
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(r.session_id::text || ':' || p_student::text, 0)
      );
      select h.answer into v_current
      from public.session_leave_history h
      where h.class_session_id = r.session_id
        and h.student_id = p_student
      order by h.answered_at desc, h.id desc
      limit 1;

      if v_current = 'sick' then
        outcome := 'sick';
      elsif p_answer = 'on_leave' and v_current = 'on_leave' then
        outcome := 'already_on_leave';
      elsif p_answer = 'coming' and v_current is distinct from 'on_leave' then
        outcome := 'already_coming';
      else
        begin
          -- Through RLS and the existing triggers; the classification is the
          -- one the BEFORE INSERT trigger freezes, never the preview's.
          insert into public.session_leave_history (class_session_id, student_id, answer)
          values (r.session_id, p_student, p_answer)
          returning classification into v_classification;
          outcome := coalesce(v_classification, 'coming');
        exception
          when sqlstate '22023' then
            -- Refused since the preview: skipped and reported.
            get stacked diagnostics v_hint = pg_exception_hint;
            outcome := case v_hint
              when 'leave_started' then 'started'
              when 'leave_cancelled' then 'cancelled'
              when 'leave_decided' then 'decided'
              else 'skipped'
            end;
          when sqlstate 'P0002' then
            -- The session was deleted mid-save.
            outcome := 'skipped';
        end;
      end if;
    end if;

    return next;
  end loop;
end;
$$;

comment on function public.set_leave_range(uuid, date, date, uuid, text) is
  'B11 (#57): sets p_answer (on_leave / coming) on every session preview_leave_range reports as changing (planned / short_notice / coming), one session_leave_history row each, through RLS and the existing triggers. Returns every session with its outcome; saved On leave rows carry the frozen classification. Each session is locked and its latest answer re-read first, so an answer saved since the preview is left untouched. Sessions already at p_answer, decided, cancelled, started or sick are left untouched; a refusal at save time (22023, or P0002 for a deleted session) is reported (skipped for an unlisted reason), only 42501 aborts. Security invoker.';

revoke all on function public.set_leave_range(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.set_leave_range(uuid, date, date, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- list_class_join_requests / my_class_join_requests (0031)
-- + class_name_bo, class_name_de (and current_classes_bo / _de: each class's
-- name in that language, else its English name)
-- ---------------------------------------------------------------------------

drop function public.list_class_join_requests();

create function public.list_class_join_requests()
returns table (
  request_id uuid,
  student_id uuid,
  student_name text,
  current_classes text,
  class_id uuid,
  class_name text,
  requested_at timestamptz,
  own_child boolean,
  current_classes_bo text,
  current_classes_de text,
  class_name_bo text,
  class_name_de text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'teacher')
  ) then
    raise exception 'not allowed to list class join requests'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.student_id,
    coalesce(s.display_name, s.registration_name),
    coalesce(ec.names, ''),
    r.class_id,
    c.name,
    r.requested_at,
    public.is_parent_of(r.student_id),
    coalesce(ec.names_bo, ''),
    coalesce(ec.names_de, ''),
    c.name_bo,
    c.name_de
  from public.class_join_requests r
  join public.profiles s on s.id = r.student_id
  join public.classes c on c.id = r.class_id
  left join lateral (
    select
      string_agg(k.name, ', ' order by k.name) as names,
      string_agg(coalesce(k.name_bo, k.name), ', ' order by coalesce(k.name_bo, k.name)) as names_bo,
      string_agg(coalesce(k.name_de, k.name), ', ' order by coalesce(k.name_de, k.name)) as names_de
    from public.class_enrollments e
    join public.classes k on k.id = e.class_id
    where e.student_id = r.student_id
  ) ec on true
  where r.status = 'pending'
    and s.role = 'student'
    and s.status = 'approved'
    and not public.is_enrolled_in_class(r.student_id, r.class_id)
    and (public.is_admin() or public.is_teacher_of_class(r.class_id))
  order by r.requested_at, r.id;
end;
$$;

comment on function public.list_class_join_requests() is
  'B12a (#67): pending class join requests the caller may see: the admin all, a teacher those for classes they teach (anyone else 42501); approved students only, and not for a class the student is already in. own_child = the caller is the student''s parent (then they can''t decide). Class names come in every language (0036).';

revoke all on function public.list_class_join_requests() from public, anon;
grant execute on function public.list_class_join_requests() to authenticated;

drop function public.my_class_join_requests();

create function public.my_class_join_requests()
returns table (
  id uuid,
  class_id uuid,
  class_name text,
  status text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  class_name_bo text,
  class_name_de text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'student'
  ) then
    raise exception 'only a student has class join requests'
      using errcode = '42501';
  end if;

  return query
  select r.id, r.class_id, c.name, r.status, r.requested_at, r.reviewed_at,
         c.name_bo, c.name_de
  from public.class_join_requests r
  join public.classes c on c.id = r.class_id
  where r.student_id = auth.uid()
    and (
      (r.status = 'pending' and not public.is_enrolled_in_class(r.student_id, r.class_id))
      or (r.status = 'rejected' and r.dismissed_at is null)
    )
  order by r.requested_at desc, r.id;
end;
$$;

comment on function public.my_class_join_requests() is
  'B12a (#67): the calling student''s pending requests (not for a class they are already in) and rejected ones not yet dismissed, newest first, with the class''s names in every language (students can''t read a class they are not in). Anyone else 42501.';

revoke all on function public.my_class_join_requests() from public, anon;
grant execute on function public.my_class_join_requests() to authenticated;
