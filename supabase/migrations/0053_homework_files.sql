-- 0053_homework_files.sql
--
-- #110: a teacher can attach PDF files to a homework (worksheet, lyrics
-- sheet, reading), as #95 (0039) did for syllabus sections.
--
-- * Bucket `homework-files`: private, 5 MB per file, application/pdf only.
--   Objects are stored as `<class_id>/<assignment_id>/<random uuid>.pdf`, so
--   the storage policies can check the class and the homework from the path.
--   The original file name is kept in the table, never in the path.
-- * homework_assignment_files: one row per stored file. The files belong to
--   the assignment, not to one copy (homework_instances), so every copy of a
--   weekly homework shows the same files, as it does its content and links.
--   Access follows homework_assignments' select policy (0025): the admin and
--   the class's teachers read and change; students the homework is set for
--   and their approved parents read; nobody else sees a row.
-- * storage.objects policies for the bucket: the same groups, keyed on the
--   class id and the assignment id in the path. There is no update policy:
--   an object is never overwritten or moved (a replaced file gets a new one).
-- * At most 2 files per homework, checked by a trigger (SQLSTATE 'HF001').
--
-- Stored objects cannot be deleted from SQL (storage.protect_delete), so
-- `on delete cascade` removes the rows only. The app removes the objects
-- through the Storage API before it deletes a file or a class
-- (src/lib/server/homework-files.ts). Deleting those rows any other way (SQL
-- editor, service role, the rollback of a failed homework create, which
-- runs before any file is attached) leaves the objects in the bucket.
-- Archiving a copy changes homework_instances only, so the files stay.
--
-- On the hosted project nothing else is needed after `db push`: the bucket
-- and its limits are created here. Objects whose row is gone (expected:
-- 0 rows):
--
--   select o.name
--   from storage.objects o
--   where o.bucket_id = 'homework-files'
--     and not exists (
--       select 1 from public.homework_assignment_files f
--       where f.object_path = o.name
--     );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homework-files', 'homework-files', false, 5242880, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- homework_assignment_files
-- ---------------------------------------------------------------------------

create table public.homework_assignment_files (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null
    references public.homework_assignments (id) on delete cascade,
  object_path text not null
    constraint homework_assignment_files_object_path_key unique
    constraint homework_assignment_files_object_path_shape
      check (
        object_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$'
      ),
  file_name text not null
    constraint homework_assignment_files_file_name_length
      check (file_name = btrim(file_name) and char_length(file_name) between 1 and 255),
  size_bytes integer not null
    constraint homework_assignment_files_size_range
      check (size_bytes between 1 and 5242880),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.homework_assignment_files is
  '#110: PDF files attached to a homework (homework_assignments), at most 2 per homework, shown in created_at order. Every copy (homework_instances) of the homework shows them. The file itself is the object `object_path` in the private storage bucket `homework-files`. Uploaded, replaced and removed by the class''s teachers or the admin; readable by the students the homework is set for and their approved parents.';
comment on column public.homework_assignment_files.object_path is
  'Object name in the bucket: <class_id>/<assignment_id>/<random uuid>.pdf. Replacing a file stores a new object and changes this path.';
comment on column public.homework_assignment_files.file_name is
  'The file''s original name, shown in the app and used when it is downloaded. Never part of the storage path.';

create index homework_assignment_files_assignment_idx
  on public.homework_assignment_files (assignment_id, created_at);

alter table public.homework_assignment_files enable row level security;

-- The same groups as homework_assignments' own select policy (0025).
create policy "homework_assignment_files_select"
  on public.homework_assignment_files for select
  using (
    exists (
      select 1
      from public.homework_assignments a
      where a.id = homework_assignment_files.assignment_id
        and (
          public.is_admin()
          or public.is_teacher_of_class(a.class_id)
          or public.is_targeted_for_homework_assignment(a.id)
          or public.is_parent_targeted_for_homework_assignment(a.id)
        )
    )
  );

-- The path must be inside the homework's own folder of its own class, so a
-- row can never point at another class's or homework's object.
create policy "homework_assignment_files_insert_admin_or_teacher"
  on public.homework_assignment_files for insert
  with check (
    exists (
      select 1
      from public.homework_assignments a
      where a.id = homework_assignment_files.assignment_id
        and (public.is_admin() or public.is_teacher_of_class(a.class_id))
        and starts_with(
          homework_assignment_files.object_path,
          a.class_id::text || '/' || a.id::text || '/'
        )
    )
  );

create policy "homework_assignment_files_update_admin_or_teacher"
  on public.homework_assignment_files for update
  using (
    exists (
      select 1
      from public.homework_assignments a
      where a.id = homework_assignment_files.assignment_id
        and (public.is_admin() or public.is_teacher_of_class(a.class_id))
    )
  )
  with check (
    exists (
      select 1
      from public.homework_assignments a
      where a.id = homework_assignment_files.assignment_id
        and (public.is_admin() or public.is_teacher_of_class(a.class_id))
        and starts_with(
          homework_assignment_files.object_path,
          a.class_id::text || '/' || a.id::text || '/'
        )
    )
  );

create policy "homework_assignment_files_delete_admin_or_teacher"
  on public.homework_assignment_files for delete
  using (
    exists (
      select 1
      from public.homework_assignments a
      where a.id = homework_assignment_files.assignment_id
        and (public.is_admin() or public.is_teacher_of_class(a.class_id))
    )
  );

-- A file can't be moved to another homework after it's created.
revoke update on public.homework_assignment_files from authenticated;
grant update (object_path, file_name, size_bytes, updated_at)
  on public.homework_assignment_files to authenticated;
revoke all on public.homework_assignment_files from anon;

-- ---------------------------------------------------------------------------
-- At most 2 files per homework
-- ---------------------------------------------------------------------------

create function public.homework_assignment_files_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Locks the homework: a second upload to it waits for this one, so two at
  -- once cannot both be the second. Security definer, so the count never
  -- depends on which rows the caller may see.
  perform 1
  from public.homework_assignments a
  where a.id = new.assignment_id
  for no key update;

  select count(*) into v_count
  from public.homework_assignment_files f
  where f.assignment_id = new.assignment_id;

  if v_count >= 2 then
    raise exception 'A homework can have at most 2 files.'
      using errcode = 'HF001';
  end if;
  return new;
end;
$$;

comment on function public.homework_assignment_files_limit() is
  'Trigger: refuses a third file on a homework with SQLSTATE HF001 (the app shows its "at most 2 files" message for it).';

revoke all on function public.homework_assignment_files_limit() from public, anon, authenticated;

create trigger homework_assignment_files_limit
  before insert on public.homework_assignment_files
  for each row execute function public.homework_assignment_files_limit();

-- ---------------------------------------------------------------------------
-- Storage policies for the bucket
-- ---------------------------------------------------------------------------

create function public.homework_file_path_id(p_name text, p_part integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_part)
      ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then split_part(p_name, '/', p_part)::uuid
  end;
$$;

comment on function public.homework_file_path_id(text, integer) is
  'The uuid in folder `p_part` of a homework-files object name (1 = class id, 2 = assignment id), or null when that part is not a uuid. Used by the bucket''s storage policies.';

revoke all on function public.homework_file_path_id(text, integer) from public, anon;
grant execute on function public.homework_file_path_id(text, integer)
  to authenticated, service_role;

-- Objects are only ever made inside a homework's folder of its own class
-- (insert policy below), so the class id and the homework id in a path
-- belong together.
create policy "homework_files_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'homework-files'
    and (
      public.is_admin()
      or public.is_teacher_of_class(public.homework_file_path_id(name, 1))
      or public.is_targeted_for_homework_assignment(public.homework_file_path_id(name, 2))
      or public.is_parent_targeted_for_homework_assignment(public.homework_file_path_id(name, 2))
    )
  );

-- Only into a homework's folder of the class it belongs to, and only under a
-- name the app makes (never the uploaded file's own name).
create policy "homework_files_insert_admin_or_teacher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'homework-files'
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$'
    and (
      public.is_admin()
      or public.is_teacher_of_class(public.homework_file_path_id(name, 1))
    )
    and exists (
      select 1
      from public.homework_assignments a
      where a.id = public.homework_file_path_id(name, 2)
        and a.class_id = public.homework_file_path_id(name, 1)
    )
  );

create policy "homework_files_delete_admin_or_teacher"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'homework-files'
    and (
      public.is_admin()
      or public.is_teacher_of_class(public.homework_file_path_id(name, 1))
    )
  );
