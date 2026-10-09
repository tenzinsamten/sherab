-- 0039_syllabus_section_files.sql
--
-- A syllabus section (0038) held text and links only. A teacher can now
-- attach PDF files of their own to it (lyrics sheet, worksheet, notes). This
-- is the app's first file storage.
--
-- * Bucket `syllabus-files`: private, 1 MB per file, application/pdf only.
--   Objects are stored as `<class_id>/<section_id>/<random uuid>.pdf`, so the
--   storage policies can check the class from the path. The original file
--   name is kept in the table, never in the path.
-- * class_syllabus_section_files: one row per stored file. Access follows the
--   section's class, as 0038: the admin and the class's teachers read and
--   change, enrolled students read, nobody else (parents included) sees a row.
-- * storage.objects policies for the bucket: the same three groups, keyed on
--   the class id in the path. There is no update policy: an object is never
--   overwritten or moved (a replaced file gets a new object).
-- * At most 5 files per section, checked by a trigger (SQLSTATE 'SF001').
--
-- Stored objects cannot be deleted from SQL (storage.protect_delete), so
-- `on delete cascade` removes the rows only. The app removes the objects
-- through the Storage API before it deletes a file, a section, a syllabus or
-- a class (src/lib/server/syllabus-files.ts). Deleting those rows any other
-- way (SQL editor, service role) leaves the objects in the bucket.
--
-- On the hosted project nothing else is needed after `db push`: the bucket
-- and its limits are created here. Objects whose row is gone (expected:
-- 0 rows):
--
--   select o.name
--   from storage.objects o
--   where o.bucket_id = 'syllabus-files'
--     and not exists (
--       select 1 from public.class_syllabus_section_files f
--       where f.object_path = o.name
--     );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('syllabus-files', 'syllabus-files', false, 1048576, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- class_syllabus_section_files
-- ---------------------------------------------------------------------------

create table public.class_syllabus_section_files (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null
    references public.class_syllabus_sections (id) on delete cascade,
  object_path text not null
    constraint class_syllabus_section_files_object_path_key unique
    constraint class_syllabus_section_files_object_path_shape
      check (
        object_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$'
      ),
  file_name text not null
    constraint class_syllabus_section_files_file_name_length
      check (file_name = btrim(file_name) and char_length(file_name) between 1 and 255),
  size_bytes integer not null
    constraint class_syllabus_section_files_size_range
      check (size_bytes between 1 and 1048576),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.class_syllabus_section_files is
  'PDF files attached to a syllabus section (class_syllabus_sections), at most 5 per section, shown in created_at order. The file itself is the object `object_path` in the private storage bucket `syllabus-files`. Uploaded, replaced and removed by the class''s teachers or the admin; readable by the class''s enrolled students.';
comment on column public.class_syllabus_section_files.object_path is
  'Object name in the bucket: <class_id>/<section_id>/<random uuid>.pdf. Replacing a file stores a new object and changes this path.';
comment on column public.class_syllabus_section_files.file_name is
  'The file''s original name, shown in the app and used when it is downloaded. Never part of the storage path.';

create index class_syllabus_section_files_section_idx
  on public.class_syllabus_section_files (section_id, created_at);

alter table public.class_syllabus_section_files enable row level security;

create policy "class_syllabus_section_files_select"
  on public.class_syllabus_section_files for select
  using (
    exists (
      select 1
      from public.class_syllabus_sections c
      join public.class_syllabi s on s.id = c.syllabus_id
      where c.id = class_syllabus_section_files.section_id
        and (
          public.is_admin()
          or public.is_teacher_of_class(s.class_id)
          or public.is_enrolled_in_class(auth.uid(), s.class_id)
        )
    )
  );

-- The path must be inside the section's own folder of its own class, so a
-- row can never point at another class's object.
create policy "class_syllabus_section_files_insert_admin_or_teacher"
  on public.class_syllabus_section_files for insert
  with check (
    exists (
      select 1
      from public.class_syllabus_sections c
      join public.class_syllabi s on s.id = c.syllabus_id
      where c.id = class_syllabus_section_files.section_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
        and starts_with(
          class_syllabus_section_files.object_path,
          s.class_id::text || '/' || c.id::text || '/'
        )
    )
  );

create policy "class_syllabus_section_files_update_admin_or_teacher"
  on public.class_syllabus_section_files for update
  using (
    exists (
      select 1
      from public.class_syllabus_sections c
      join public.class_syllabi s on s.id = c.syllabus_id
      where c.id = class_syllabus_section_files.section_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
    )
  )
  with check (
    exists (
      select 1
      from public.class_syllabus_sections c
      join public.class_syllabi s on s.id = c.syllabus_id
      where c.id = class_syllabus_section_files.section_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
        and starts_with(
          class_syllabus_section_files.object_path,
          s.class_id::text || '/' || c.id::text || '/'
        )
    )
  );

create policy "class_syllabus_section_files_delete_admin_or_teacher"
  on public.class_syllabus_section_files for delete
  using (
    exists (
      select 1
      from public.class_syllabus_sections c
      join public.class_syllabi s on s.id = c.syllabus_id
      where c.id = class_syllabus_section_files.section_id
        and (public.is_admin() or public.is_teacher_of_class(s.class_id))
    )
  );

-- A file can't be moved to another section after it's created.
revoke update on public.class_syllabus_section_files from authenticated;
grant update (object_path, file_name, size_bytes, updated_at)
  on public.class_syllabus_section_files to authenticated;
revoke all on public.class_syllabus_section_files from anon;

-- ---------------------------------------------------------------------------
-- At most 5 files per section
-- ---------------------------------------------------------------------------

create function public.class_syllabus_section_files_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Locks the section: a second upload to it waits for this one, so two at
  -- once cannot both be the fifth. Security definer, so the count never
  -- depends on which rows the caller may see.
  perform 1
  from public.class_syllabus_sections c
  where c.id = new.section_id
  for no key update;

  select count(*) into v_count
  from public.class_syllabus_section_files f
  where f.section_id = new.section_id;

  if v_count >= 5 then
    raise exception 'A syllabus section can have at most 5 files.'
      using errcode = 'SF001';
  end if;
  return new;
end;
$$;

comment on function public.class_syllabus_section_files_limit() is
  'Trigger: refuses a sixth file on a syllabus section with SQLSTATE SF001 (the app shows its "at most 5 files" message for it).';

revoke all on function public.class_syllabus_section_files_limit() from public, anon, authenticated;

create trigger class_syllabus_section_files_limit
  before insert on public.class_syllabus_section_files
  for each row execute function public.class_syllabus_section_files_limit();

-- ---------------------------------------------------------------------------
-- Storage policies for the bucket
-- ---------------------------------------------------------------------------

create function public.syllabus_file_path_id(p_name text, p_part integer)
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

comment on function public.syllabus_file_path_id(text, integer) is
  'The uuid in folder `p_part` of a syllabus-files object name (1 = class id, 2 = section id), or null when that part is not a uuid. Used by the bucket''s storage policies.';

revoke all on function public.syllabus_file_path_id(text, integer) from public, anon;
grant execute on function public.syllabus_file_path_id(text, integer)
  to authenticated, service_role;

create policy "syllabus_files_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'syllabus-files'
    and (
      public.is_admin()
      or public.is_teacher_of_class(public.syllabus_file_path_id(name, 1))
      or public.is_enrolled_in_class(auth.uid(), public.syllabus_file_path_id(name, 1))
    )
  );

-- Only into a section's folder of the class it belongs to, and only under a
-- name the app makes (never the uploaded file's own name).
create policy "syllabus_files_insert_admin_or_teacher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'syllabus-files'
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$'
    and (
      public.is_admin()
      or public.is_teacher_of_class(public.syllabus_file_path_id(name, 1))
    )
    and exists (
      select 1
      from public.class_syllabus_sections c
      join public.class_syllabi s on s.id = c.syllabus_id
      where c.id = public.syllabus_file_path_id(name, 2)
        and s.class_id = public.syllabus_file_path_id(name, 1)
    )
  );

create policy "syllabus_files_delete_admin_or_teacher"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'syllabus-files'
    and (
      public.is_admin()
      or public.is_teacher_of_class(public.syllabus_file_path_id(name, 1))
    )
  );
