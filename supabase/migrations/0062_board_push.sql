-- 0062_board_push.sql
--
-- spec-parent-message-board, story 6 (CAP-5): a push notification when a
-- board post is created.
--
-- Reuses the homework push pipeline of 0037: the push_subscriptions table,
-- the app's /api/push/run endpoint and trigger_homework_push(), which the
-- app calls with p_kind = 'board' and p_instance_id = the post's id. That
-- function is not changed here.
--
-- * board_push_log: one row per (post, recipient) that was sent. It is what
--   makes every board notice go out once. service_role only.
-- * board_push_targets(post): who is still owed the notice for that post --
--   every profile with a push subscription that would be a board reader
--   (0061's is_board_reader() rules, checked for that profile rather than
--   auth.uid()), except the post's author and anyone already in
--   board_push_log for it. service_role only.
--
-- No push on edit or delete: only the app's `post` action asks for one.

-- ---------------------------------------------------------------------------
-- board_push_log
-- ---------------------------------------------------------------------------

create table public.board_push_log (
  post_id uuid not null references public.board_posts (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (post_id, recipient_id)
);

comment on table public.board_push_log is
  'spec-parent-message-board CAP-5: a board post notice that was handed to the push service, per post and recipient. board_push_targets() leaves out what is logged here, so a notice is sent once however often the app is asked. service_role only.';

create index board_push_log_recipient_id_idx on public.board_push_log (recipient_id);

alter table public.board_push_log enable row level security;

revoke all on public.board_push_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- board_push_targets(post)
-- ---------------------------------------------------------------------------

create function public.board_push_targets(p_post_id uuid)
returns table (recipient_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id as recipient_id
  from public.board_posts bp
  join public.profiles p
    on p.id is distinct from bp.author_id
  where bp.id = p_post_id
    -- A board reader, as is_board_reader() (0061) for this profile: an
    -- admin, a teacher, an approved student, or an approved parents row.
    and (
      p.role in ('admin'::public.user_role, 'teacher'::public.user_role)
      or (
        p.role = 'student'::public.user_role
        and p.status = 'approved'::public.registration_status
      )
      or exists (
        select 1
        from public.parents pa
        where pa.id = p.id
          and pa.status = 'approved'
      )
    )
    and exists (
      select 1
      from public.push_subscriptions ps
      where ps.profile_id = p.id
    )
    and not exists (
      select 1
      from public.board_push_log l
      where l.post_id = bp.id
        and l.recipient_id = p.id
    )
  order by p.id;
$$;

comment on function public.board_push_targets(uuid) is
  'spec-parent-message-board CAP-5: the recipients still owed the notice for one board post. Every profile with a push subscription that is a board reader (admin, teacher, approved student, or approved parent: is_board_reader() of 0061 applied to that profile), except the post''s author and recipients already in board_push_log. Ordered by recipient_id. service_role only.';

revoke all on function public.board_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.board_push_targets(uuid) to service_role;
