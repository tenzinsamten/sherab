-- 0029_deletion_requests.sql
--
-- Story 7-6: parent deletion request (CAP-8, AD-9 shared deletion queue).
--
-- * deletion_requests: one queue. Only the child's approved parent submits
--   (requester_role 'parent'; students cannot request, by decision 1). At
--   most one pending request per student. No withdrawal (decision 2) and no
--   DELETE: the row is the audit trail.
-- * BEFORE INSERT: stamps requested_by / requested_at / status /
--   requester_role and refuses (42501) anyone but is_parent_of(student_id).
-- * BEFORE UPDATE: only pending -> approved / rejected, stamped with
--   reviewed_by / reviewed_at. Every other change is refused, except the
--   ON DELETE SET NULL actions of the three profile foreign keys.
-- * RLS: parents insert for their own child; the admin decides, never for
--   their own child (AD-4 self-decision guard); the requester, the parent,
--   the student and the admin read. Teachers have no access.
-- * Erasure: an AFTER UPDATE trigger (security definer, owner postgres)
--   deletes the student's auth.users row on approval. The existing
--   cascades remove profiles and every student-keyed row; student_id turns
--   NULL through ON DELETE SET NULL (the de-identified placeholder). The
--   parent's profile and parents rows are never touched.

-- ---------------------------------------------------------------------------
-- deletion_requests
-- ---------------------------------------------------------------------------

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  requester_role text not null default 'parent'
    constraint deletion_requests_requester_role_valid
      check (requester_role = 'parent'),
  status text not null default 'pending'
    constraint deletion_requests_status_valid
      check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);

comment on table public.deletion_requests is
  'Story 7-6 (CAP-8, AD-9): the shared deletion queue. A parent requests erasure of a linked child; the admin approves (the child''s account and every student-keyed row are erased by trigger) or rejects. The row is kept; student_id NULL = the de-identified erased student. Never deleted.';

comment on column public.deletion_requests.student_id is
  'The student to erase. NULL after approval: the erasure itself nulls it (ON DELETE SET NULL), the de-identified placeholder.';

comment on column public.deletion_requests.requester_role is
  'AD-9 audit field. Only ''parent'' is allowed (Story 7-6 decision 1: students cannot request deletion).';

create unique index deletion_requests_one_pending_per_student
  on public.deletion_requests (student_id)
  where status = 'pending';

create index deletion_requests_status_idx on public.deletion_requests (status);
create index deletion_requests_requested_by_idx on public.deletion_requests (requested_by);

alter table public.deletion_requests enable row level security;

create policy "deletion_requests_insert_parent"
  on public.deletion_requests for insert
  to authenticated
  with check (public.is_parent_of(student_id));

create policy "deletion_requests_select"
  on public.deletion_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or public.is_parent_of(student_id)
    or student_id = auth.uid()
    or public.is_admin()
  );

create policy "deletion_requests_update_admin"
  on public.deletion_requests for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin() and not public.is_parent_of(student_id));

-- No DELETE policy: a request is never hard-deleted.
revoke all on public.deletion_requests from anon, authenticated;
grant select on public.deletion_requests to authenticated;
grant insert (student_id) on public.deletion_requests to authenticated;
grant update (status) on public.deletion_requests to authenticated;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: parents only, stamped
-- ---------------------------------------------------------------------------

create or replace function public.trg_deletion_request_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The same rule as the insert policy, checked first (a BEFORE trigger runs
  -- ahead of the RLS WITH CHECK and the unique index), so nobody else learns
  -- whether a request exists. The service role is not exempt.
  if not public.is_parent_of(new.student_id) then
    raise exception 'only the student''s parent can request deletion'
      using errcode = '42501';
  end if;

  -- Never the client's values.
  new.requested_by := auth.uid();
  new.requested_at := now();
  new.requester_role := 'parent';
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;

revoke all on function public.trg_deletion_request_before_insert() from public, anon, authenticated;

create trigger deletion_requests_before_insert
  before insert on public.deletion_requests
  for each row
  execute function public.trg_deletion_request_before_insert();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: pending -> approved / rejected only, stamped
-- ---------------------------------------------------------------------------

create or replace function public.trg_deletion_request_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status not in ('approved', 'rejected') then
      raise exception 'only a pending deletion request can be decided'
        using errcode = '42501';
    end if;
    if new.id is distinct from old.id
       or new.student_id is distinct from old.student_id
       or new.requested_by is distinct from old.requested_by
       or new.requester_role is distinct from old.requester_role
       or new.requested_at is distinct from old.requested_at then
      raise exception 'a deletion request can only change its status'
        using errcode = '42501';
    end if;
    -- A signed-in caller must be the admin, never for their own child (the
    -- policy's rule, repeated here since a BEFORE trigger runs first).
    if auth.uid() is not null and (
      not public.is_admin() or public.is_parent_of(old.student_id)
    ) then
      raise exception 'not allowed to decide this deletion request'
        using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    return new;
  end if;

  -- No status change: only the ON DELETE SET NULL actions of the profile
  -- foreign keys (the referenced profile no longer exists) are allowed.
  if new.id is distinct from old.id
     or new.requester_role is distinct from old.requester_role
     or new.requested_at is distinct from old.requested_at
     or new.reviewed_at is distinct from old.reviewed_at
     or (new.student_id is distinct from old.student_id and not (
       new.student_id is null
       and not exists (select 1 from public.profiles p where p.id = old.student_id)
     ))
     or (new.requested_by is distinct from old.requested_by and not (
       new.requested_by is null
       and not exists (select 1 from public.profiles p where p.id = old.requested_by)
     ))
     or (new.reviewed_by is distinct from old.reviewed_by and not (
       new.reviewed_by is null
       and not exists (select 1 from public.profiles p where p.id = old.reviewed_by)
     )) then
    raise exception 'a deletion request cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_deletion_request_before_update() from public, anon, authenticated;

create trigger deletion_requests_before_update
  before update on public.deletion_requests
  for each row
  execute function public.trg_deletion_request_before_update();

-- ---------------------------------------------------------------------------
-- AFTER UPDATE: erasure on approval
-- ---------------------------------------------------------------------------

create or replace function public.trg_deletion_request_erase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select p.role::text into v_role
  from public.profiles p
  where p.id = new.student_id;

  -- Only a student account is ever erased here: never a parent, teacher or
  -- admin login (belt and braces; is_parent_of already requires a student).
  if v_role is distinct from 'student' then
    raise exception 'deletion request does not reference a student'
      using errcode = '42501';
  end if;

  -- Cascades: profiles (0001) and from there every student-keyed table.
  -- deletion_requests.student_id becomes NULL (ON DELETE SET NULL).
  delete from auth.users u where u.id = new.student_id;
  return null;
end;
$$;

comment on function public.trg_deletion_request_erase() is
  'Story 7-6: on pending -> approved, deletes the student''s auth.users row. The FK cascades erase profiles and every student-keyed row, and de-identify the request (student_id NULL).';

revoke all on function public.trg_deletion_request_erase() from public, anon, authenticated;

create trigger deletion_requests_erase_on_approval
  after update of status on public.deletion_requests
  for each row
  when (old.status = 'pending' and new.status = 'approved')
  execute function public.trg_deletion_request_erase();
