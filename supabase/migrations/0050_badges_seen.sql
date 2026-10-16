-- 0050_badges_seen.sql
--
-- Badge detail CAP-9 (story 5): the one-time "New badge!" celebration.
--
-- * badges_earned.seen_at: when the student dismissed the celebration that
--   showed this badge; NULL while it is still new. New rows (written by the
--   recompute triggers, AD-3) start NULL.
-- * Rows that exist when this migration runs count as seen (seen_at =
--   earned_at), so nothing is celebrated retroactively.
-- * mark_badges_seen(p_ids): sets seen_at on the caller's own unseen rows
--   among p_ids; another student's ids change nothing. SECURITY DEFINER
--   because badges_earned has no client update policy (AD-3) and keeps none;
--   it touches only seen_at, only of rows where student_id = auth.uid().
--   Mirrors mark_tour_seen (0044).
--
-- No row is deleted; how badges are awarded does not change.

alter table public.badges_earned
  add column seen_at timestamptz;

comment on column public.badges_earned.seen_at is
  'Badge detail CAP-9: when the student dismissed the "New badge!" celebration for this badge; NULL while unseen. Written only by mark_badges_seen().';

update public.badges_earned
set seen_at = earned_at
where seen_at is null;

-- ---------------------------------------------------------------------------
-- mark_badges_seen(p_ids)
-- ---------------------------------------------------------------------------

create or replace function public.mark_badges_seen(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  update public.badges_earned
  set seen_at = now()
  where id = any (p_ids)
    and student_id = auth.uid()
    and seen_at is null;
end;
$$;

comment on function public.mark_badges_seen(uuid[]) is
  'Badge detail CAP-9: records that the caller has seen the celebration for these badges. Sets seen_at on the caller''s own unseen badges_earned rows among p_ids; nothing else changes.';

revoke all on function public.mark_badges_seen(uuid[]) from public, anon;
grant execute on function public.mark_badges_seen(uuid[]) to authenticated, service_role;
