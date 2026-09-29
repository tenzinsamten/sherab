-- 0032_parent_access_request.sql
--
-- B14a (#68): a signed-in teacher or admin asks for parent capability from
-- My account. Their own `parents` row is created 'pending' (AD-4) and the
-- admin decides it in the existing /requests parent queue, exactly like a
-- parent sign-up. Children link as before: a child registers at /join with
-- the staff member's email as guardian email (handle_new_user, 0024).
--
-- * request_parent_access(): teacher or admin only (else 42501). A row that
--   already exists is refused with 22023 and hint already_pending /
--   already_parent / rejected (no re-request after a rejection). Otherwise
--   inserts (auth.uid(), 'pending') and returns 'pending'.
--
-- * The admin's own request goes through the /requests queue and the admin
--   approves it (single-admin school, user decision 2026-09-29), so
--   reviewed_by = the admin's own id is expected there.
--
-- No existing table, column, policy, grant or function changes: clients
-- still have no INSERT / DELETE on parents.

create or replace function public.request_parent_access()
returns public.parent_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.parent_status;
begin
  if v_uid is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.role in ('teacher', 'admin')
  ) then
    raise exception 'only a teacher or the admin can request parent access'
      using errcode = '42501';
  end if;

  select pa.status into v_existing
  from public.parents pa
  where pa.id = v_uid
  for update;

  if found then
    raise exception 'parent access already requested'
      using errcode = '22023',
            hint = case v_existing
              when 'pending' then 'already_pending'
              when 'approved' then 'already_parent'
              else 'rejected'
            end;
  end if;

  insert into public.parents (id, status)
  values (v_uid, 'pending')
  on conflict (id) do nothing;

  if not found then
    -- A concurrent call inserted it first.
    raise exception 'parent access already requested'
      using errcode = '22023', hint = 'already_pending';
  end if;

  return 'pending'::public.parent_status;
end;
$$;

comment on function public.request_parent_access() is
  'B14a (#68): the calling teacher or admin (else 42501) creates their own pending parents row. An existing row: 22023 hint already_pending / already_parent / rejected. Returns ''pending''.';

revoke all on function public.request_parent_access() from public, anon;
grant execute on function public.request_parent_access() to authenticated;
