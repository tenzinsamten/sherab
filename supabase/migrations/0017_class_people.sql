-- 0017_class_people.sql
--
-- #46: a student's class page shows who teaches the class and who else is in
-- it. Students can't read class_teachers or other students' profiles (RLS
-- only allows their own rows), so this is one narrow SECURITY DEFINER read:
-- display names only, for one class, and only for someone in that class
-- (enrolled student, its teacher, or an admin).

create or replace function public.class_people(p_class_id uuid)
returns table (person_id uuid, display_name text, is_teacher boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not (
    public.is_admin()
    or public.is_teacher_of_class(p_class_id)
    or public.is_enrolled_in_class(auth.uid(), p_class_id)
  ) then
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
    where e.class_id = p_class_id
      and p.role = 'student'
      and p.status = 'approved'
  ) people
  order by people.is_teacher desc, people.display_name;
end;
$$;

comment on function public.class_people(uuid) is
  'Teachers and enrolled students of one class, display names only (#46). Callable by the class''s students and teachers and by admins.';

revoke all on function public.class_people(uuid) from public, anon;
grant execute on function public.class_people(uuid) to authenticated;
