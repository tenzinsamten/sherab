-- 0011_class_delete_guard.sql
--
-- A class may only be deleted while no approved or pending student belongs
-- to it (decided 2026-09-23). Rejected registrations don't block: the admin
-- delete action clears them first, the same way the requests page's
-- "clear rejected" does. The app checks this before deleting too; this
-- trigger is the database-level guarantee (AD-2), since classes_delete_admin
-- (0001_init.sql) alone would let an admin delete any class, and
-- profiles.class_id's `on delete set null` would silently orphan students.

create or replace function public.prevent_delete_class_with_students()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where class_id = old.id
      and role = 'student'
      and status in ('approved', 'pending')
  ) then
    raise exception 'class % still has approved or pending students', old.id
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger classes_prevent_delete_with_students
  before delete on public.classes
  for each row execute function public.prevent_delete_class_with_students();
