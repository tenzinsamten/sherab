-- Story 7-3: parent read access (AD-12).
--
-- An approved parent reads their approved children's data, read-only:
--   * student-keyed SELECT policies add `or public.is_parent_of(student_id)`;
--   * class-keyed tables (classes, class_sessions) use is_parent_in_class();
--   * homework instances/assignments only when one of the parent's approved
--     children is targeted (never via is_parent_in_class alone);
--   * attendance only through child_attendance(), because
--     attendance_records.notes stays teacher-only (RLS cannot hide a column);
--   * class_people() gives a parent-only caller the teachers only;
--   * homework_counts(student_id) is the one Open/Overdue count shared by the
--     student dashboard and the parent cards.
-- No INSERT/UPDATE/DELETE policy is added anywhere.

-- ---------------------------------------------------------------------------
-- is_parent_in_class(class_id)
-- ---------------------------------------------------------------------------

create or replace function public.is_parent_in_class(p_class_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.class_enrollments e
    where e.class_id = p_class_id
      and public.is_parent_of(e.student_id)
  );
$$;

comment on function public.is_parent_in_class(uuid) is
  'Story 7-3 (AD-12): true when the caller is an approved parent with an approved child enrolled in the class.';

revoke all on function public.is_parent_in_class(uuid) from public, anon;
grant execute on function public.is_parent_in_class(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Homework targeting for parents (mirrors is_targeted_for_homework_*).
-- ---------------------------------------------------------------------------

create or replace function public.is_parent_targeted_for_homework_instance(p_instance_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.homework_status_history h
    where h.instance_id = p_instance_id
      and public.is_parent_of(h.student_id)
  );
$$;

comment on function public.is_parent_targeted_for_homework_instance(uuid) is
  'Story 7-3: true when one of the caller''s approved children is targeted by the homework instance.';

revoke all on function public.is_parent_targeted_for_homework_instance(uuid) from public, anon;
grant execute on function public.is_parent_targeted_for_homework_instance(uuid)
  to authenticated, service_role;

create or replace function public.is_parent_targeted_for_homework_assignment(p_assignment_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.homework_instances hi
    join public.homework_status_history h on h.instance_id = hi.id
    where hi.assignment_id = p_assignment_id
      and public.is_parent_of(h.student_id)
  );
$$;

comment on function public.is_parent_targeted_for_homework_assignment(uuid) is
  'Story 7-3: true when one of the caller''s approved children is targeted by an instance of the assignment.';

revoke all on function public.is_parent_targeted_for_homework_assignment(uuid) from public, anon;
grant execute on function public.is_parent_targeted_for_homework_assignment(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SELECT policies
-- ---------------------------------------------------------------------------

-- Student-keyed tables.
alter policy "homework_status_history_select_admin_teacher_or_own"
  on public.homework_status_history
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
  );

-- Parents see skill notes (teachers are told so in the notes field).
alter policy "skill_status_history_select_admin_or_assigned_teacher"
  on public.skill_status_history
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_parent_of(student_id)
  );

alter policy "student_streaks_select_admin_teacher_or_own"
  on public.student_streaks
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_teacher_of_student(student_id)
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
  );

alter policy "badges_earned_select_admin_or_own"
  on public.badges_earned
  using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
  );

alter policy "class_enrollments_select"
  on public.class_enrollments
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
  );

create policy "profiles_select_parent_of_child"
  on public.profiles for select
  using (public.is_parent_of(id));

-- Class-keyed tables.
create policy "classes_select_parent_in_class"
  on public.classes for select
  using (public.is_parent_in_class(id));

alter policy "class_sessions_select"
  on public.class_sessions
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_enrolled_in_class(auth.uid(), class_id)
    or public.is_parent_in_class(class_id)
  );

-- Homework: only what targets one of the parent's approved children.
alter policy "homework_instances_select_admin_teacher_or_targeted_student"
  on public.homework_instances
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_targeted_for_homework_instance(id)
    or public.is_parent_targeted_for_homework_instance(id)
  );

alter policy "homework_assignments_select_admin_teacher_or_targeted_student"
  on public.homework_assignments
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_targeted_for_homework_assignment(id)
    or public.is_parent_targeted_for_homework_assignment(id)
  );

-- attendance_records is deliberately unchanged: parents read attendance
-- only through child_attendance() below, never the notes column.

-- ---------------------------------------------------------------------------
-- child_attendance(student_id): date, class and present only (no notes).
-- ---------------------------------------------------------------------------

create or replace function public.child_attendance(p_student_id uuid)
returns table (session_date date, class_id uuid, class_name text, present boolean)
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
  select a.session_date, a.class_id, c.name, a.present
  from public.attendance_records a
  join public.classes c on c.id = a.class_id
  where a.student_id = p_student_id
  order by a.session_date desc, c.name;
end;
$$;

comment on function public.child_attendance(uuid) is
  'Story 7-3 (AD-12): the student''s own or a parent''s child''s attendance -- date, class and present only; notes stay teacher-only.';

revoke all on function public.child_attendance(uuid) from public, anon;
grant execute on function public.child_attendance(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- homework_counts(student_id): Open and Overdue, the student To-do rule.
--   Open    = assigned, not Done or Reviewed, instance not archived, student
--             still enrolled in the class, due_date <= today + lookahead
--             (isTodoVisible in student-homework.ts).
--   Overdue = Open and due_date < today. Today is Europe/Berlin.
-- ---------------------------------------------------------------------------

create or replace function public.homework_counts(p_student_id uuid)
returns table (open_count integer, overdue_count integer)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_days integer;
begin
  if not (
    p_student_id = auth.uid()
    or public.is_parent_of(p_student_id)
    or public.is_teacher_of_student(p_student_id)
    or public.is_admin()
  ) then
    raise exception 'not allowed to read this student''s homework counts'
      using errcode = '42501';
  end if;

  -- Admin-tunable look-ahead (default 14, as in student-homework.ts).
  select case
           when jsonb_typeof(s.value -> 'days') = 'number'
             then floor((s.value ->> 'days')::numeric)::integer
         end
    into v_days
  from public.app_settings s
  where s.key = 'homework_lookahead_days';
  v_days := coalesce(v_days, 14);

  return query
  with progress as (
    select h.instance_id,
           bool_or(h.status = 'assigned') as assigned,
           bool_or(h.status in ('done', 'reviewed')) as finished
    from public.homework_status_history h
    where h.student_id = p_student_id
    group by h.instance_id
  ),
  open_items as (
    select hi.due_date
    from progress p
    join public.homework_instances hi on hi.id = p.instance_id
    where p.assigned
      and not p.finished
      and hi.archived_at is null
      and hi.due_date <= v_today + v_days
      and exists (
        select 1
        from public.class_enrollments e
        where e.student_id = p_student_id
          and e.class_id = hi.class_id
      )
  )
  select count(*)::integer,
         (count(*) filter (where o.due_date < v_today))::integer
  from open_items o;
end;
$$;

comment on function public.homework_counts(uuid) is
  'Story 7-3: Open and Overdue homework counts for a student (caller must be the student, their parent, a teacher of the student or the admin). Same rule as the student To-do list.';

revoke all on function public.homework_counts(uuid) from public, anon;
grant execute on function public.homework_counts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- class_people(class_id): a caller authorized only as a parent in the class
-- gets the teachers only (no classmates' names).
-- ---------------------------------------------------------------------------

create or replace function public.class_people(p_class_id uuid)
returns table (person_id uuid, display_name text, is_teacher boolean)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_full boolean := public.is_admin()
    or public.is_teacher_of_class(p_class_id)
    or public.is_enrolled_in_class(auth.uid(), p_class_id);
begin
  if not (v_full or public.is_parent_in_class(p_class_id)) then
    raise exception 'not allowed to list the people of class %', p_class_id
      using errcode = '42501';
  end if;

  return query
  select people.person_id, people.display_name, people.is_teacher
  from (
    select p.id as person_id,
           coalesce(p.display_name, p.registration_name, '') as display_name,
           true as is_teacher
    from public.class_teachers ct
    join public.profiles p on p.id = ct.teacher_id
    where ct.class_id = p_class_id
    union all
    select p.id,
           coalesce(p.display_name, p.registration_name, ''),
           false
    from public.class_enrollments e
    join public.profiles p on p.id = e.student_id
    where v_full
      and e.class_id = p_class_id
      and p.role = 'student'
      and p.status = 'approved'
  ) people
  order by people.is_teacher desc, people.display_name;
end;
$$;

comment on function public.class_people(uuid) is
  'Class people (0017); since Story 7-3 a caller authorized only as a parent in the class gets the teachers only.';

revoke all on function public.class_people(uuid) from public, anon;
grant execute on function public.class_people(uuid) to authenticated, service_role;
