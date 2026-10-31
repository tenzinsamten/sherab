-- spec-parent-message-board story 7: post titles and author names.
--
-- 1. board_posts.title: a title of up to 120 characters. Nullable, so posts
--    written before this change keep working; the app requires it on every
--    new post and edit.
-- 2. board_author_names(uuid[]) also returns the author's role, and returns
--    a null display_name when the stored name is empty or is the email
--    address (accounts created without a name fall back to their email).
--    The app then shows "Sherab Admin", "Teacher" or "Former member". No
--    stored display_name is changed.

-- ---------------------------------------------------------------------------
-- board_posts.title
-- ---------------------------------------------------------------------------

alter table public.board_posts
  add column title text
    constraint board_posts_title_shape
      check (
        title is null
        or (title = btrim(title) and char_length(title) between 1 and 120)
      );

comment on column public.board_posts.title is
  'Story 7: the post''s heading, trimmed, 1 to 120 characters. Required by the app on every new post and edit; null only on posts written before titles existed.';

-- The column grants of 0061, with the title added.
revoke insert, update on public.board_posts from authenticated;
grant insert (author_id, title, content, content_language) on public.board_posts to authenticated;
grant update (title, content, content_language, updated_at) on public.board_posts to authenticated;

-- ---------------------------------------------------------------------------
-- board_author_names(ids), recreated with the role
-- ---------------------------------------------------------------------------

drop function public.board_author_names(uuid[]);

create function public.board_author_names(p_ids uuid[])
returns table (id uuid, display_name text, role public.user_role)
language sql
security definer
set search_path = ''
stable
as $$
  select
    p.id,
    case
      when p.display_name is null
        or btrim(p.display_name) = ''
        or lower(btrim(p.display_name)) = lower(btrim(p.email))
        then null
      else p.display_name
    end,
    p.role
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
  'spec-parent-message-board CAP-1 (story 7 adds the role): (id, display_name, role) of the given ids that have written at least one board post. display_name is null when the stored name is empty or equals the email (trimmed, case-insensitive). Empty for a caller who is not a board reader. Readers cannot select other people''s profiles rows, so the board names its authors through this.';

revoke all on function public.board_author_names(uuid[]) from public, anon;
grant execute on function public.board_author_names(uuid[]) to authenticated;
