-- 0057_remove_parent_link.sql
--
-- spec-second-parent, story 4: the admin removes a parent link (CAP-4,
-- AD-4, AD-10).
--
-- * remove_parent_link(student, parent): plpgsql, security definer,
--   search_path '', VOLATILE, EXECUTE for authenticated only.
--   - 42501 when the caller is not the admin, or there is no link between
--     the two (not found looks the same as not allowed).
--   - 42501 with hint own_child when the admin has an active link to the
--     student (AD-4: nobody decides about their own child).
--   - 22023 with hint link_removed when the link is already removed.
--   - 22023 with hint last_parent_link when it is the student's only active
--     link. The deferred keep-one trigger (0054) stays the backstop and
--     raises the same hint with 23514.
--   Sets removed_at / removed_by on that one link and nothing else.
-- * The existing triggers still apply: the BEFORE UPDATE guard (0054) stamps
--   removed_at := now(); the removal cancels the removed parent's pending
--   invites for the student (0056). A deletion request the removed parent
--   made stays for the admin to decide (AD-9).
--
-- Order: the admin check; then the locks (AD-10), the parent's parents row
-- (FOR SHARE) and the student's profiles row (FOR UPDATE); then the own-child
-- check under those locks; then the link row (FOR UPDATE) and its refusals.

create or replace function public.remove_parent_link(p_student_id uuid, p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_link public.student_parents%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed to remove this parent link'
      using errcode = '42501';
  end if;

  -- Lock order (AD-10): the parent's parents row, then the student's profile.
  perform 1
  from public.parents pa
  where pa.id = p_parent_id
  for share;

  perform 1
  from public.profiles p
  where p.id = p_student_id
  for update;

  -- Never for one's own child, the admin included (AD-4). Checked under the
  -- student's lock, so a link to the admin committed meanwhile is seen.
  if public.has_link_to(p_student_id) then
    raise exception 'not allowed to remove a link to your own child'
      using errcode = '42501', hint = 'own_child';
  end if;

  -- The active link if there is one, else the latest removed one.
  select * into v_link
  from public.student_parents sp
  where sp.student_id = p_student_id
    and sp.parent_id = p_parent_id
  order by (sp.removed_at is null) desc, sp.removed_at desc
  limit 1
  for update;

  if v_link.id is null then
    raise exception 'not allowed to remove this parent link'
      using errcode = '42501';
  end if;

  if v_link.removed_at is not null then
    raise exception 'this parent link is already removed'
      using errcode = '22023', hint = 'link_removed';
  end if;

  if not exists (
    select 1
    from public.student_parents sp
    where sp.student_id = p_student_id
      and sp.removed_at is null
      and sp.id <> v_link.id
  ) then
    raise exception 'a student keeps at least one parent link'
      using errcode = '22023', hint = 'last_parent_link';
  end if;

  update public.student_parents sp
  set removed_at = now(),
      removed_by = auth.uid()
  where sp.id = v_link.id;
end;
$$;

comment on function public.remove_parent_link(uuid, uuid) is
  'spec-second-parent (AD-4, AD-10): the admin removes one parent''s active link to a student. 42501 when not the admin or no such link; 42501 own_child when the admin is linked to the student; 22023 link_removed, last_parent_link. The keep-one trigger is the backstop (23514 last_parent_link).';

revoke all on function public.remove_parent_link(uuid, uuid) from public, anon, service_role;
grant execute on function public.remove_parent_link(uuid, uuid) to authenticated;
