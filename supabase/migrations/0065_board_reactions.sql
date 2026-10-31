-- 0065_board_reactions.sql
--
-- spec-parent-message-board story 9: thumbs up and down on board posts.
--
-- * board_post_reactions: one reaction per reader per post, 1 (up) or -1
--   (down). Removed with the post or the account (cascade).
-- * RLS: a caller selects only their own rows, so who reacted is never
--   readable. Insert as yourself while a board reader; update your own row's
--   value only (column grant) while still a reader; delete your own row.
--   Nothing for anon.
-- * board_reaction_counts(ids): the up and down counts of the given posts,
--   for readers only (empty for anyone else). Security definer, because the
--   table's select policy shows each caller only their own rows.
-- * No push or notification is sent for a reaction.

create table public.board_post_reactions (
  post_id uuid not null
    references public.board_posts (id) on delete cascade,
  user_id uuid not null
    references public.profiles (id) on delete cascade,
  value smallint not null
    constraint board_post_reactions_value_check check (value in (1, -1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

comment on table public.board_post_reactions is
  'spec-parent-message-board story 9: a reader''s thumbs up (1) or down (-1) on a board post, at most one per reader and post. Each caller reads only their own rows; counts come from board_reaction_counts().';
comment on column public.board_post_reactions.value is
  '1 is a thumbs up, -1 a thumbs down.';

create index board_post_reactions_user_idx on public.board_post_reactions (user_id);

alter table public.board_post_reactions enable row level security;

create policy "board_post_reactions_select_own"
  on public.board_post_reactions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "board_post_reactions_insert_reader"
  on public.board_post_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_board_reader())
  );

create policy "board_post_reactions_update_own_reader"
  on public.board_post_reactions for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_board_reader())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_board_reader())
  );

create policy "board_post_reactions_delete_own"
  on public.board_post_reactions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- The post and the user are set on insert only; a switch changes the value
-- (and updated_at).
revoke all on public.board_post_reactions from anon;
revoke insert, update on public.board_post_reactions from authenticated;
grant insert (post_id, user_id, value) on public.board_post_reactions to authenticated;
grant update (value) on public.board_post_reactions to authenticated;

-- updated_at follows each change of value (the column grant leaves it out).
create function public.board_post_reactions_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.board_post_reactions_touch() is
  'Trigger: sets board_post_reactions.updated_at on each update.';

revoke all on function public.board_post_reactions_touch() from public, anon, authenticated;

create trigger board_post_reactions_touch
  before update on public.board_post_reactions
  for each row execute function public.board_post_reactions_touch();

-- ---------------------------------------------------------------------------
-- board_reaction_counts(ids)
-- ---------------------------------------------------------------------------

create function public.board_reaction_counts(p_ids uuid[])
returns table (post_id uuid, up_count integer, down_count integer)
language sql
security definer
set search_path = ''
stable
as $$
  select r.post_id,
         (count(*) filter (where r.value = 1))::integer as up_count,
         (count(*) filter (where r.value = -1))::integer as down_count
  from public.board_post_reactions r
  where public.is_board_reader()
    and r.post_id = any (p_ids)
  group by r.post_id;
$$;

comment on function public.board_reaction_counts(uuid[]) is
  'spec-parent-message-board story 9: (post_id, up_count, down_count) for the given board posts that have reactions. Empty for a caller who is not a board reader. Never says who reacted.';

revoke all on function public.board_reaction_counts(uuid[]) from public, anon;
grant execute on function public.board_reaction_counts(uuid[]) to authenticated;
