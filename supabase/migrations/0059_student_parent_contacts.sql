-- 0059_student_parent_contacts.sql
--
-- spec-second-parent, CAP-6: teachers see both parents and who set each
-- leave answer (AD-12, AD-13).
--
-- * student_parent_contacts(p_student_ids uuid[]) (AD-12) returns the
--   active parents (display name and email) of each student the caller may
--   see: a teacher of the student (the same checks as actor_display_name,
--   0055), the admin, or the student's linked parent (is_parent_of). Other
--   ids are silently left out. Removed links are never returned. It takes an
--   array so a class roster needs one call. No new profiles or
--   student_parents SELECT policy is added.
-- * sick_leave_queue() also returns answered_by_name, the
--   actor_display_name(student, answered_by) of the current Sick answer.
--   The return type changes, so the function is dropped and created again;
--   the body is 0054's verbatim plus the column, and grants and comment are
--   kept (comment extended).

-- ---------------------------------------------------------------------------
-- student_parent_contacts(p_student_ids)
-- ---------------------------------------------------------------------------

create or replace function public.student_parent_contacts(p_student_ids uuid[])
returns table (
  student_id uuid,
  parent_id uuid,
  display_name text,
  email text
)
language sql
security definer
set search_path = ''
stable
as $$
  select sp.student_id,
         sp.parent_id,
         pp.display_name,
         pp.email
  from public.student_parents sp
  join public.profiles pp on pp.id = sp.parent_id
  where sp.student_id = any (p_student_ids)
    and sp.removed_at is null
    and (
      public.is_admin()
      or public.is_parent_of(sp.student_id)
      or public.is_teacher_of_student(sp.student_id)
      or exists (
        select 1
        from public.profiles s
        where s.id = sp.student_id
          and s.role = 'student'::public.user_role
          and s.class_id is not null
          and public.is_teacher_of_class(s.class_id)
      )
    )
  order by sp.student_id, sp.slot;
$$;

comment on function public.student_parent_contacts(uuid[]) is
  'spec-second-parent CAP-6 (AD-12): the active parents (display name, email) of the given students, ordered by student and slot. Rows only for students the caller may see as a contact: a teacher of the student, the admin, or a linked parent (is_parent_of). Other ids are silently left out; removed links are never returned.';

revoke all on function public.student_parent_contacts(uuid[]) from public, anon, service_role;
grant execute on function public.student_parent_contacts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- sick_leave_queue(): 0054 plus answered_by_name.
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
  class_name_de text,
  answered_by_name text
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
         public.has_link_to(l.student_id),
         c.name_bo,
         c.name_de,
         public.actor_display_name(l.student_id, l.answered_by)
  from (
    select distinct on (h.class_session_id, h.student_id)
           h.class_session_id, h.student_id, h.answer, h.answered_at, h.answered_by
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
  'Story 7-5: current Sick answers on non-cancelled sessions of the classes the caller teaches (every class for the admin), with the decision (NULL = pending), whether the system decided it, own_child = the caller is the student''s parent (no decision controls), the class''s names in every language (0036) and answered_by_name, the parent who set the answer via actor_display_name (0059; NULL when unknown). Anyone else gets no rows.';

revoke all on function public.sick_leave_queue() from public, anon;
grant execute on function public.sick_leave_queue() to authenticated, service_role;
