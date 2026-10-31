-- 0061_message_board.sql
--
-- spec-parent-message-board, story 1 (CAP-1 to CAP-4, database side).
--
-- One school-wide board. Admins, teachers and admin-chosen parents post;
-- every approved member of the school reads.
--
-- * parents.can_post_board: the posting grant. Off by default. Only the
--   admin changes it, through the existing parents_update_admin policy; the
--   column grant is widened from (status) to (status, can_post_board).
--   Turning it off keeps the parent's earlier posts.
-- * is_board_reader(): an admin, a teacher, an approved student or an
--   approved parent (is_parent()). Nobody else reads posts, files or
--   objects: not anon, not a pending or rejected student, not a pending
--   parent.
-- * is_board_poster(): an admin, a teacher, or an approved parent with
--   can_post_board. Never a student.
-- * board_posts: insert by a poster as themselves; update by the author
--   while still a poster, and only content, content_language and updated_at
--   (column grant); delete by the author (even after the grant is revoked),
--   an admin or a teacher. Admins and teachers never edit someone else's
--   post. author_id is set null when the account goes, so the post stays.
-- * board_post_files: PDF files on a post, at most 2 (trigger, SQLSTATE
--   'BF001'). Added by the post's author while a poster; read by readers;
--   removed by the author, an admin or a teacher. Never updated.
-- * Bucket `board-files`: private, 5 MB per file, application/pdf only.
--   Objects are `<post_id>/<random uuid>.pdf`. Same groups as the table; at
--   most 2 objects per post folder.
-- * board_author_names(ids): readers can't select other people's profiles,
--   so this returns the display names of the given ids that have written at
--   least one post, and nothing for a non-reader.
--
-- Stored objects cannot be deleted from SQL (storage.protect_delete), so
-- deleting a post cascades to its file rows only. The app removes the
-- objects through the Storage API before it deletes a post or a file.
-- Objects whose row is gone (expected: 0 rows):
--
--   select o.name
--   from storage.objects o
--   where o.bucket_id = 'board-files'
--     and not exists (
--       select 1 from public.board_post_files f
--       where f.object_path = o.name
--     );

-- ---------------------------------------------------------------------------
-- The posting grant.
-- ---------------------------------------------------------------------------

alter table public.parents
  add column can_post_board boolean not null default false;

comment on column public.parents.can_post_board is
  'spec-parent-message-board CAP-4: the admin lets this parent post on the school board. Off by default; only the admin changes it (parents_update_admin). Works only while the parent is approved (is_board_poster() requires is_parent()). Turning it off keeps earlier posts.';

-- Widens 0023's `grant update (status)` to (status, can_post_board).
grant update (status, can_post_board) on public.parents to authenticated;

-- ---------------------------------------------------------------------------
-- is_board_reader() / is_board_poster()
-- ---------------------------------------------------------------------------

create function public.is_board_reader()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role in ('admin'::public.user_role, 'teacher'::public.user_role)
          or (
            p.role = 'student'::public.user_role
            and p.status = 'approved'::public.registration_status
          )
        )
    )
    or public.is_parent();
$$;

comment on function public.is_board_reader() is
  'spec-parent-message-board CAP-1: true for an admin, a teacher, an approved student or an approved parent (is_parent()). Gates reading board posts, their files and their objects.';

revoke all on function public.is_board_reader() from public, anon;
grant execute on function public.is_board_reader() to authenticated;

create function public.is_board_poster()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin'::public.user_role, 'teacher'::public.user_role)
    )
    or (
      public.is_parent()
      and exists (
        select 1
        from public.parents pa
        where pa.id = auth.uid()
          and pa.can_post_board
      )
    );
$$;

comment on function public.is_board_poster() is
  'spec-parent-message-board CAP-2/CAP-4: true for an admin, a teacher, or an approved parent with parents.can_post_board. Never a student. Gates creating and editing board posts and adding their files.';

revoke all on function public.is_board_poster() from public, anon;
grant execute on function public.is_board_poster() to authenticated;

-- ---------------------------------------------------------------------------
-- board_posts
-- ---------------------------------------------------------------------------

create table public.board_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles (id) on delete set null,
  content jsonb not null
    constraint board_posts_content_shape
      check (
        jsonb_typeof(content) = 'object'
        -- Backstop only, as homework_assignments.content (0034): the app
        -- refuses documents over MAX_CONTENT_BYTES first.
        and octet_length(content::text) <= 2000000
      ),
  content_language text not null default 'en'
    constraint board_posts_content_language_known
      check (content_language in ('bo', 'en', 'de')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.board_posts is
  'spec-parent-message-board: posts on the one school-wide board, newest first. Read by is_board_reader(); written by is_board_poster() as themselves; edited by the author only; deleted by the author, an admin or a teacher.';
comment on column public.board_posts.author_id is
  'Who wrote the post. Null once that account is deleted; the post stays (shown as an unnamed member).';
comment on column public.board_posts.content is
  'Rich-text post body as an editor document (JSON), as homework_assignments.content. Checked by the app on save; never rendered as HTML.';
comment on column public.board_posts.content_language is
  'Language the body is written in (bo, en, de). Selects the font it is shown in.';

create index board_posts_created_at_idx on public.board_posts (created_at desc);
create index board_posts_author_idx on public.board_posts (author_id);

alter table public.board_posts enable row level security;

create policy "board_posts_select_reader"
  on public.board_posts for select
  to authenticated
  using ((select public.is_board_reader()));

create policy "board_posts_insert_poster"
  on public.board_posts for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and (select public.is_board_poster())
  );

-- The author only, while still a poster. Admins and teachers never edit
-- another person's post.
create policy "board_posts_update_author"
  on public.board_posts for update
  to authenticated
  using (
    author_id = (select auth.uid())
    and (select public.is_board_poster())
  )
  with check (
    author_id = (select auth.uid())
    and (select public.is_board_poster())
  );

-- The author (also after the grant is revoked), an admin or a teacher.
create policy "board_posts_delete_author_admin_or_teacher"
  on public.board_posts for delete
  to authenticated
  using (
    author_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin'::public.user_role, 'teacher'::public.user_role)
    )
  );

-- A post's author and times are set on insert only; an edit changes the
-- body, its language and updated_at.
revoke all on public.board_posts from anon;
revoke insert, update on public.board_posts from authenticated;
grant insert (author_id, content, content_language) on public.board_posts to authenticated;
grant update (content, content_language, updated_at) on public.board_posts to authenticated;

-- ---------------------------------------------------------------------------
-- board_post_files
-- ---------------------------------------------------------------------------

create table public.board_post_files (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null
    references public.board_posts (id) on delete cascade,
  object_path text not null
    constraint board_post_files_object_path_key unique
    constraint board_post_files_object_path_shape
      check (
        object_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$'
      ),
  file_name text not null
    constraint board_post_files_file_name_length
      check (file_name = btrim(file_name) and char_length(file_name) between 1 and 255),
  size_bytes integer not null
    constraint board_post_files_size_range
      check (size_bytes between 1 and 5242880),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.board_post_files is
  'spec-parent-message-board CAP-2: PDF files attached to a board post, at most 2 per post, shown in created_at order. The file itself is the object `object_path` in the private storage bucket `board-files`. Added by the post''s author while a poster; read by every board reader; removed by the author, an admin or a teacher.';
comment on column public.board_post_files.object_path is
  'Object name in the bucket: <post_id>/<random uuid>.pdf.';
comment on column public.board_post_files.file_name is
  'The file''s original name, shown in the app and used when it is downloaded. Never part of the storage path.';

create index board_post_files_post_idx
  on public.board_post_files (post_id, created_at);

alter table public.board_post_files enable row level security;

create policy "board_post_files_select_reader"
  on public.board_post_files for select
  to authenticated
  using ((select public.is_board_reader()));

-- The post's author, while a poster, and only inside the post's own folder.
create policy "board_post_files_insert_author"
  on public.board_post_files for insert
  to authenticated
  with check (
    (select public.is_board_poster())
    and created_by = (select auth.uid())
    and starts_with(board_post_files.object_path, board_post_files.post_id::text || '/')
    and exists (
      select 1
      from public.board_posts b
      where b.id = board_post_files.post_id
        and b.author_id = (select auth.uid())
    )
  );

create policy "board_post_files_delete_author_admin_or_teacher"
  on public.board_post_files for delete
  to authenticated
  using (
    exists (
      select 1
      from public.board_posts b
      where b.id = board_post_files.post_id
        and b.author_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin'::public.user_role, 'teacher'::public.user_role)
    )
  );

-- A file row is never changed: a replaced file is a new row. Its id and
-- times are set by the database.
revoke all on public.board_post_files from anon;
revoke insert, update on public.board_post_files from authenticated;
grant insert (post_id, object_path, file_name, size_bytes, created_by)
  on public.board_post_files to authenticated;

-- ---------------------------------------------------------------------------
-- At most 2 files per post
-- ---------------------------------------------------------------------------

create function public.board_post_files_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Locks the post: a second upload to it waits for this one, so two at
  -- once cannot both be the second. Security definer, so the count never
  -- depends on which rows the caller may see.
  perform 1
  from public.board_posts b
  where b.id = new.post_id
  for no key update;

  select count(*) into v_count
  from public.board_post_files f
  where f.post_id = new.post_id;

  if v_count >= 2 then
    raise exception 'A board post can have at most 2 files.'
      using errcode = 'BF001';
  end if;
  return new;
end;
$$;

comment on function public.board_post_files_limit() is
  'Trigger: refuses a third file on a board post with SQLSTATE BF001 (the app shows its "at most 2 files" message for it).';

revoke all on function public.board_post_files_limit() from public, anon, authenticated;

create trigger board_post_files_limit
  before insert on public.board_post_files
  for each row execute function public.board_post_files_limit();

-- ---------------------------------------------------------------------------
-- board_author_names(ids)
-- ---------------------------------------------------------------------------

create function public.board_author_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.display_name
  from public.profiles p
  where public.is_board_reader()
    and p.id = any (p_ids)
    and exists (
      select 1
      from public.board_posts b
      where b.author_id = p.id
    );
$$;

comment on function public.board_author_names(uuid[]) is
  'spec-parent-message-board CAP-1: (id, display_name) of the given ids that have written at least one board post. Empty for a caller who is not a board reader. Readers cannot select other people''s profiles rows, so the board names its authors through this.';

revoke all on function public.board_author_names(uuid[]) from public, anon;
grant execute on function public.board_author_names(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Bucket and its storage policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-files', 'board-files', false, 5242880, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.board_file_post_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1)
      ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

comment on function public.board_file_post_id(text) is
  'The post id (first folder) of a board-files object name, or null when it is not a uuid. Used by the bucket''s storage policies.';

revoke all on function public.board_file_post_id(text) from public, anon;
grant execute on function public.board_file_post_id(text) to authenticated, service_role;

-- Counts the objects already stored for a post. Security definer, because a
-- storage.objects policy cannot read storage.objects itself (recursion) and
-- the count must not depend on what the caller may see.
create function public.board_file_object_count(p_post_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::integer
  from storage.objects o
  where o.bucket_id = 'board-files'
    and public.board_file_post_id(o.name) = p_post_id;
$$;

comment on function public.board_file_object_count(uuid) is
  'Number of board-files objects stored under the post''s folder. Used by board_files_insert_author to refuse a third object.';

revoke all on function public.board_file_object_count(uuid) from public, anon;
grant execute on function public.board_file_object_count(uuid) to authenticated, service_role;

create policy "board_files_select_reader"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'board-files'
    and (select public.is_board_reader())
  );

-- Only into the folder of a post the caller wrote, while still a poster, and
-- only under a name the app makes (never the uploaded file's own name).
create policy "board_files_insert_author"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'board-files'
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$'
    and (select public.is_board_poster())
    and exists (
      select 1
      from public.board_posts b
      where b.id = public.board_file_post_id(name)
        and b.author_id = (select auth.uid())
    )
    -- At most 2 objects per post, as the table's BF001 trigger for rows.
    and public.board_file_object_count(public.board_file_post_id(name)) < 2
  );

create policy "board_files_delete_author_admin_or_teacher"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'board-files'
    and (
      exists (
        select 1
        from public.board_posts b
        where b.id = public.board_file_post_id(name)
          and b.author_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role in ('admin'::public.user_role, 'teacher'::public.user_role)
      )
    )
  );
