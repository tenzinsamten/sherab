-- 0014_class_syllabus.sql
--
-- #32 (decided 2026-09-25): a class has a syllabus, plain text plus up to 10
-- labelled links (same shape as homework's reference_links, 0013). The
-- class's teacher and the admin can edit it; the class's approved students
-- can read it.

alter table public.classes
  add column syllabus text
    constraint classes_syllabus_length check (char_length(syllabus) <= 5000),
  add column syllabus_links jsonb not null default '[]'::jsonb
    constraint classes_syllabus_links_shape
      check (jsonb_typeof(syllabus_links) = 'array' and jsonb_array_length(syllabus_links) <= 10);

-- Teachers edit through this function rather than an UPDATE policy: an
-- update policy on classes would let a teacher change the name or the join
-- code too (there are no column grants on classes). The function only ever
-- writes the two syllabus columns.
create or replace function public.set_class_syllabus(
  p_class_id uuid,
  p_syllabus text,
  p_links jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_teacher_of_class(p_class_id)) then
    raise exception 'not allowed to edit this class''s syllabus'
      using errcode = '42501';
  end if;

  update public.classes
  set syllabus = nullif(btrim(p_syllabus), ''),
      syllabus_links = coalesce(p_links, '[]'::jsonb)
  where id = p_class_id;

  if not found then
    raise exception 'class not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_class_syllabus(uuid, text, jsonb) from public, anon;
grant execute on function public.set_class_syllabus(uuid, text, jsonb) to authenticated;

-- Students could not read classes at all until now. They need their own
-- class's row to see its syllabus on /student.
create policy "classes_select_own_student"
  on public.classes for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
        and p.status = 'approved'
        and p.class_id = classes.id
    )
  );
