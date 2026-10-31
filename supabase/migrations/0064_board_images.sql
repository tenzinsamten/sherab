-- spec-parent-message-board story 8: one image per post instead of up to
-- 2 PDFs.
--
-- 1. Bucket `board-files`: JPEG, PNG and WebP only, 5 MB each.
-- 2. board_post_files.object_path: new and updated rows must be
--    <post_id>/<uuid>.(jpg|png|webp). The check is NOT VALID, so .pdf rows
--    made before this change stay as they are.
-- 3. The storage insert policy accepts only image names and allows an
--    upload only while the post's folder holds no object.
-- 4. The file-row limit trigger refuses a second file with BF001.
--
-- Every other rule of 0061 (reading, the author check, deleting) is
-- unchanged.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'board-files';

-- ---------------------------------------------------------------------------
-- board_post_files.object_path
-- ---------------------------------------------------------------------------

alter table public.board_post_files
  drop constraint board_post_files_object_path_shape;

alter table public.board_post_files
  add constraint board_post_files_object_path_shape
    check (
      object_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$'
    ) not valid;

comment on table public.board_post_files is
  'spec-parent-message-board CAP-2 (story 8): the image attached to a board post, at most 1 per post. The file itself is the object `object_path` in the private storage bucket `board-files`. Rows from before story 8 may be PDFs. Added by the post''s author while a poster; read by every board reader; removed by the author, an admin or a teacher.';
comment on column public.board_post_files.object_path is
  'Object name in the bucket: <post_id>/<random uuid>.(jpg|png|webp). Rows from before story 8 may end in .pdf (the check is NOT VALID, so they are kept).';

-- ---------------------------------------------------------------------------
-- At most 1 file per post
-- ---------------------------------------------------------------------------

create or replace function public.board_post_files_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Locks the post: a second upload to it waits for this one, so two at
  -- once cannot both be the first. Security definer, so the count never
  -- depends on which rows the caller may see.
  perform 1
  from public.board_posts b
  where b.id = new.post_id
  for no key update;

  select count(*) into v_count
  from public.board_post_files f
  where f.post_id = new.post_id;

  if v_count >= 1 then
    raise exception 'A board post can have at most 1 image.'
      using errcode = 'BF001';
  end if;
  return new;
end;
$$;

comment on function public.board_post_files_limit() is
  'Trigger: refuses a second file on a board post with SQLSTATE BF001 (story 8: one image per post).';

revoke all on function public.board_post_files_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage insert policy
-- ---------------------------------------------------------------------------

comment on function public.board_file_object_count(uuid) is
  'Number of board-files objects stored under the post''s folder. Used by board_files_insert_author to refuse a second object.';

drop policy "board_files_insert_author" on storage.objects;

-- Only into the folder of a post the caller wrote, while still a poster,
-- only under an image name the app makes, and only while the folder is empty.
create policy "board_files_insert_author"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'board-files'
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and (select public.is_board_poster())
    and exists (
      select 1
      from public.board_posts b
      where b.id = public.board_file_post_id(name)
        and b.author_id = (select auth.uid())
    )
    -- At most 1 object per post, as the table's BF001 trigger for rows.
    and public.board_file_object_count(public.board_file_post_id(name)) = 0
  );
