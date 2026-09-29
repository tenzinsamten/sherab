-- 0033_promote_parent_to_teacher.sql
--
-- B14b (#68, arch review H-8): the admin creates a teacher whose email
-- already belongs to a parent-only login. Auth refuses the duplicate, so
-- /admin/teachers promotes that login instead: profiles.role 'parent' ->
-- 'teacher'. Everything else stays (the parents row, linked children,
-- the password). Parent capability keeps coming from the approved parents
-- row (AD-4), so the B13 switcher then offers Teacher and Parent.
--
-- * promote_parent_to_teacher(p_user_id): admin only (else 42501). Locks
--   the profile row. Refuses any current role other than 'parent'
--   (22023, hint not_parent_only) and a parents row that is not approved
--   (22023, hint parent_not_approved; read `for share` so a concurrent
--   reject waits). Returns p_user_id.
--
-- * demote_teacher_to_parent(p_user_id): admin only (else 42501). The
--   reverse, used by Remove on /admin/teachers for a teacher who also holds
--   an approved parents row (promoted here or approved through B14a):
--   instead of deleting the login (which would lose the parent account, or
--   fail on the parent_id RESTRICT FK with linked children), their
--   class_teachers rows are removed and profiles.role goes back to
--   'parent'. Refuses any current role other than 'teacher' (22023, hint
--   not_teacher -- so admins are never demoted) and a parents row that is
--   not approved (22023, hint parent_not_approved). Returns p_user_id.
--
-- * Security definer: runs as the owner, so guard_profile_link_columns
--   (0024) lets the role change through -- clients still cannot change
--   role themselves. No existing table, policy, trigger or function changes.

create or replace function public.promote_parent_to_teacher(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_status public.parent_status;
begin
  if not public.is_admin() then
    raise exception 'only the admin can promote a parent to teacher'
      using errcode = '42501';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found or v_role is distinct from 'parent' then
    raise exception 'only a parent-only login can be promoted'
      using errcode = '22023', hint = 'not_parent_only';
  end if;

  select pa.status into v_status
  from public.parents pa
  where pa.id = p_user_id
  for share;

  if v_status is distinct from 'approved' then
    raise exception 'the parent sign-up is not approved'
      using errcode = '22023', hint = 'parent_not_approved';
  end if;

  update public.profiles
  set role = 'teacher'
  where id = p_user_id;

  return p_user_id;
end;
$$;

comment on function public.promote_parent_to_teacher(uuid) is
  'B14b (#68): the admin (else 42501) promotes an approved parent-only login to teacher. Other roles: 22023 hint not_parent_only; unapproved parents row: 22023 hint parent_not_approved. Returns the id.';

revoke all on function public.promote_parent_to_teacher(uuid) from public, anon;
grant execute on function public.promote_parent_to_teacher(uuid) to authenticated;

create or replace function public.demote_teacher_to_parent(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_status public.parent_status;
begin
  if not public.is_admin() then
    raise exception 'only the admin can make a teacher parent-only'
      using errcode = '42501';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found or v_role is distinct from 'teacher' then
    raise exception 'only a teacher can be made parent-only'
      using errcode = '22023', hint = 'not_teacher';
  end if;

  select pa.status into v_status
  from public.parents pa
  where pa.id = p_user_id
  for share;

  if v_status is distinct from 'approved' then
    raise exception 'the teacher has no approved parent account'
      using errcode = '22023', hint = 'parent_not_approved';
  end if;

  delete from public.class_teachers
  where teacher_id = p_user_id;

  update public.profiles
  set role = 'parent'
  where id = p_user_id;

  return p_user_id;
end;
$$;

comment on function public.demote_teacher_to_parent(uuid) is
  'B14b (#68): the admin (else 42501) removes a teacher who is also an approved parent as teacher only: class_teachers rows deleted, role back to parent; login, parents row and children stay. Other roles: 22023 hint not_teacher; unapproved parents row: 22023 hint parent_not_approved. Returns the id.';

revoke all on function public.demote_teacher_to_parent(uuid) from public, anon;
grant execute on function public.demote_teacher_to_parent(uuid) to authenticated;
