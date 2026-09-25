-- 0013_homework_details_and_late_joiners.sql
--
-- Teacher walkthrough fixes, decided 2026-09-25:
--   #26 a plain-text description on homework (max 2000 chars).
--   #27 several reference links per homework (max 10, each {url, label}).
--   #25 whole-class homework can be created on an empty class, and a student
--       approved later is given the class's open whole-class homework.
--
-- reference_link (0004) is kept but no longer written by the app, so the
-- deployed code keeps working between `db push` and the new deploy. Drop it
-- in a later cleanup migration.

alter table public.homework_assignments
  add column description text
    constraint homework_assignments_description_length
      check (char_length(description) <= 2000),
  add column reference_links jsonb not null default '[]'::jsonb
    constraint homework_assignments_reference_links_shape
      check (jsonb_typeof(reference_links) = 'array' and jsonb_array_length(reference_links) <= 10),
  -- True when the assignment targets the whole class rather than a chosen
  -- subset. Only whole-class assignments are handed to late joiners.
  add column whole_class boolean not null default false;

update public.homework_assignments
set reference_links = jsonb_build_array(jsonb_build_object('url', reference_link, 'label', null))
where reference_link is not null and btrim(reference_link) <> '';

-- A series is always whole-class (0005: the generator targets the whole
-- approved roster). Existing one-offs stay false: whether they targeted the
-- whole class or a subset was never recorded.
update public.homework_assignments
set whole_class = true
where recurrence_rule is not null;

comment on column public.homework_assignments.reference_link is
  'Deprecated by 0013 (reference_links). Kept only until the next cleanup migration; the app no longer writes it.';

-- Same column-level restriction as 0005: only the columns the edit action
-- writes are client-updatable. whole_class is set at creation only.
grant update (description, reference_links) on public.homework_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Late joiners
--
-- A one-off assignment gets its 'assigned' rows when it is created, and the
-- generator (0005) only targets the roster of the period it creates. So a
-- student approved later would never see homework that is already open.
-- On approval, give them every open (not archived, not past due) instance of
-- their class's whole-class assignments, series included.
-- ---------------------------------------------------------------------------

create or replace function public.assign_open_homework_to_new_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.homework_status_history (
    instance_id, student_id, class_id, status, recorded_by
  )
  select i.id, new.id, i.class_id, 'assigned', null
  from public.homework_instances i
  join public.homework_assignments a on a.id = i.assignment_id
  where i.class_id = new.class_id
    and a.whole_class
    and i.archived_at is null
    and i.due_date >= current_date
    -- history is append-only with no unique key, so guard against a
    -- re-approval adding a second 'assigned' row.
    and not exists (
      select 1
      from public.homework_status_history h
      where h.instance_id = i.id
        and h.student_id = new.id
        and h.status = 'assigned'
    );

  return null;
end;
$$;

create trigger profiles_assign_open_homework
  after update of status on public.profiles
  for each row
  when (
    new.role = 'student'
    and new.status = 'approved'
    and old.status is distinct from 'approved'
    and new.class_id is not null
  )
  execute function public.assign_open_homework_to_new_student();
