-- 0030_leave_range.sql
--
-- B11 (#57): date-range leave for parents. A parent picks a from / to
-- period (and optionally one class) and sets every session of the child in
-- it to On leave -- or back to Coming -- in one go, after a preview.
--
-- * preview_leave_range(): what a save would do to each of the child's
--   sessions in the period, without writing anything. Security definer,
--   gated on is_parent_of like preview_leave (0027).
-- * set_leave_range(): security invoker. Inserts one session_leave_history
--   row per session that changes, so RLS and the existing BEFORE / AFTER
--   INSERT triggers (actor / time stamp, enrolment, cancel, start, decided,
--   frozen classification, streak recompute) do every check. Each session
--   is locked (the trigger's per-(session, student) advisory lock) and its
--   latest answer re-read before writing, so an answer saved since the
--   preview is never overwritten. A row the trigger refuses (22023) or a
--   session deleted mid-save (P0002) is skipped and reported; only a
--   permission refusal (42501) aborts the whole save.
--
-- No table, column, trigger or policy changes. No stored "leave period":
-- the range covers the sessions that exist when the parent saves.
--
-- Outcome per session:
--   planned / short_notice  On leave would be set, with this classification
--   coming                  Coming would be set (the current answer is On leave)
--   already_on_leave        On leave chosen, already On leave (untouched: a
--                           re-save would re-freeze Planned as Short-notice)
--   already_coming          Coming chosen, and the session is not On leave
--                           (Coming or no answer yet): untouched
--   decided / cancelled / started / sick   skipped (the trigger's order)
--   skipped                 refused for another reason at save time

-- ---------------------------------------------------------------------------
-- preview_leave_range(student, from, to, class, answer)
-- ---------------------------------------------------------------------------

create or replace function public.preview_leave_range(
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
  outcome text
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
         end
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
  'B11 (#57): what saving p_answer (on_leave / coming) for every session of the student''s enrolled classes (or only p_class) dated p_from..p_to (Europe/Berlin) would do, per session: planned / short_notice / coming (would change), already_on_leave / already_coming (untouched), started / cancelled / decided / sick (skipped). The student''s approved parent only (42501); p_from >= today, p_to >= p_from, p_to - p_from <= 181 (26 weeks inclusive), else 22023 hint leave_range_invalid. Writes nothing.';

revoke all on function public.preview_leave_range(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.preview_leave_range(uuid, date, date, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_leave_range(student, from, to, class, answer)
-- ---------------------------------------------------------------------------

create or replace function public.set_leave_range(
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
  outcome text
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
