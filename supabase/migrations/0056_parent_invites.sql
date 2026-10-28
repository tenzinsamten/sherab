-- 0056_parent_invites.sql
--
-- spec-second-parent, story 3: invites (CAP-1, CAP-2, AD-16).
--
-- * parent_invites: one row per invite (student, invited email stored
--   lower(btrim()), inviter, created / expires, status pending / accepted /
--   cancelled / expired). A partial unique index allows one pending row per
--   student. RLS: SELECT only, for the student's active parents and the
--   admin. No client write policy, and no policy matches on email text.
-- * app_settings parent_invite_days ({"days": 30}): the invite lifetime,
--   read with a typed fallback of 30.
-- * parent_invite_is_live(invite): the one live-invite predicate (pending,
--   unexpired, inviter still actively linked). Create, cancel, list and
--   accept all use it (story 5's sign-up check will too).
-- * create_parent_invite / cancel_parent_invite / list_my_parent_invites /
--   accept_parent_invite: plpgsql, security definer, search_path '',
--   VOLATILE, EXECUTE for authenticated only. Not found and not allowed are
--   42501; business refusals are 22023 with a stable hint. No refusal
--   depends on whether an email has an account.
-- * Triggers: removing a link cancels that parent's pending invites for the
--   student; rejecting a student cancels the student's pending invites.
--   Deleting the student cascades them.
--
-- Lock order (AD-10): the parent's parents row, then the student's profiles
-- row, then the invite row (create and accept). cancel_parent_invite locks
-- only the invite row.

-- ---------------------------------------------------------------------------
-- parent_invites
-- ---------------------------------------------------------------------------

create table public.parent_invites (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  invited_email text not null,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending',
  constraint parent_invites_status_check
    check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  constraint parent_invites_email_normalised
    check (invited_email = lower(btrim(invited_email))),
  constraint parent_invites_email_shape
    check (invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+$' and length(invited_email) <= 320),
  constraint parent_invites_expires_after_created check (expires_at > created_at)
);

comment on table public.parent_invites is
  'spec-second-parent (AD-16): an invite from a linked parent for a second parent of the student. Written only by the invite functions and the cancel triggers; read by the student''s active parents and the admin. The invitee reads their invites only through list_my_parent_invites().';

comment on column public.parent_invites.invited_email is
  'Stored lower(btrim()). Compared with the invitee''s confirmed auth.users email inside the security-definer functions only; no policy matches it.';

create unique index parent_invites_one_pending
  on public.parent_invites (student_id)
  where status = 'pending';

create index parent_invites_email_pending_idx
  on public.parent_invites (invited_email)
  where status = 'pending';

create index parent_invites_invited_by_idx
  on public.parent_invites (invited_by)
  where invited_by is not null;

alter table public.parent_invites enable row level security;

create policy "parent_invites_select_parent_or_admin"
  on public.parent_invites for select
  to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_parent()) and public.has_link_to(student_id))
  );

revoke all on public.parent_invites from anon, authenticated;
grant select on public.parent_invites to authenticated;
grant all on public.parent_invites to service_role;

-- ---------------------------------------------------------------------------
-- Setting
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'parent_invite_days',
  '{"days": 30}'::jsonb,
  'Parent invite lifetime (spec-second-parent, AD-16): an invite for a second parent can be accepted for this many days after it was sent.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- parent_invite_is_live(invite): the one live-invite predicate.
-- ---------------------------------------------------------------------------

create or replace function public.parent_invite_is_live(p_invite public.parent_invites)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_invite.status = 'pending'
    and p_invite.expires_at > now()
    and p_invite.invited_by is not null
    and exists (
      select 1
      from public.student_parents sp
      where sp.student_id = p_invite.student_id
        and sp.parent_id = p_invite.invited_by
        and sp.removed_at is null
    );
$$;

comment on function public.parent_invite_is_live(public.parent_invites) is
  'spec-second-parent (AD-16): the one live-invite predicate: pending, not expired, and the inviter still has an active link to the student. Used by every invite function.';

revoke all on function public.parent_invite_is_live(public.parent_invites) from public, anon, authenticated;
grant execute on function public.parent_invite_is_live(public.parent_invites) to service_role;

-- ---------------------------------------------------------------------------
-- create_parent_invite(student, email)
-- ---------------------------------------------------------------------------

create or replace function public.create_parent_invite(p_student_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_days integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not allowed to invite a parent'
      using errcode = '42501';
  end if;

  -- Lock order (AD-10): the caller's parents row, then the student's profile.
  perform 1 from public.parents pa where pa.id = v_uid for share;
  perform 1 from public.profiles p where p.id = p_student_id for update;

  if not public.is_parent_of(p_student_id) then
    raise exception 'this is not your child'
      using errcode = '42501', hint = 'not_your_child';
  end if;

  -- An index predicate cannot use now(): stale pending rows (expired, or
  -- whose inviter is no longer linked) are retired here, under the lock.
  update public.parent_invites i
  set status = 'expired'
  where i.student_id = p_student_id
    and i.status = 'pending'
    and not public.parent_invite_is_live(i);

  if (
    select count(*)
    from public.student_parents sp
    where sp.student_id = p_student_id
      and sp.removed_at is null
  ) >= 2 then
    raise exception 'this child already has two parents'
      using errcode = '22023', hint = 'child_has_two_parents';
  end if;

  -- The caller's own email, or a linked parent's. Both are known to the
  -- caller, so this says nothing about whether an email has an account.
  if exists (
    select 1
    from auth.users u
    where (
        u.id = v_uid
        or u.id in (
          select sp.parent_id
          from public.student_parents sp
          where sp.student_id = p_student_id
            and sp.removed_at is null
        )
      )
      and lower(btrim(u.email)) = v_email
  ) then
    raise exception 'this email belongs to a parent of this child'
      using errcode = '22023', hint = 'own_or_linked_email';
  end if;

  if exists (
    select 1
    from public.parent_invites i
    where i.student_id = p_student_id
      and i.status = 'pending'
  ) then
    raise exception 'an invite is already pending for this child'
      using errcode = '22023', hint = 'invite_pending';
  end if;

  select case
           when jsonb_typeof(s.value -> 'days') = 'number'
             then floor((s.value ->> 'days')::numeric)::integer
         end
    into v_days
  from public.app_settings s
  where s.key = 'parent_invite_days';
  if v_days is null or v_days < 1 then
    v_days := 30;
  end if;

  insert into public.parent_invites (student_id, invited_email, invited_by, expires_at)
  values (p_student_id, v_email, v_uid, now() + make_interval(days => v_days))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_parent_invite(uuid, text) is
  'spec-second-parent (AD-16): a linked parent of the approved student invites an email (stored lower(btrim())). Refusals: 42501 not_your_child; 22023 child_has_two_parents, own_or_linked_email, invite_pending. None depends on whether the email has an account.';

revoke all on function public.create_parent_invite(uuid, text) from public, anon, service_role;
grant execute on function public.create_parent_invite(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_parent_invite(invite)
-- ---------------------------------------------------------------------------

create or replace function public.cancel_parent_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_invite public.parent_invites%rowtype;
begin
  select * into v_invite
  from public.parent_invites i
  where i.id = p_invite_id
  for update;

  -- Not found looks the same as not allowed.
  if v_invite.id is null or not public.is_parent_of(v_invite.student_id) then
    raise exception 'not allowed to cancel this invite'
      using errcode = '42501';
  end if;

  if not public.parent_invite_is_live(v_invite) then
    raise exception 'this invite is no longer pending'
      using errcode = '22023', hint = 'invite_not_live';
  end if;

  update public.parent_invites i
  set status = 'cancelled'
  where i.id = v_invite.id;
end;
$$;

comment on function public.cancel_parent_invite(uuid) is
  'spec-second-parent (AD-16): any active parent of the student cancels its live invite. 42501 when not found or not allowed; 22023 invite_not_live.';

revoke all on function public.cancel_parent_invite(uuid) from public, anon, service_role;
grant execute on function public.cancel_parent_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_my_parent_invites(): the invitee's live invites.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_parent_invites()
returns table (id uuid, child_name text, invited_by_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null or not exists (
    select 1 from public.parents pa where pa.id = v_uid and pa.status = 'approved'
  ) then
    return;
  end if;

  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid
    and u.email_confirmed_at is not null;
  if v_email is null then
    return;
  end if;

  return query
  select i.id, s.display_name, inviter.display_name, i.expires_at
  from public.parent_invites i
  join public.profiles s on s.id = i.student_id
  left join public.profiles inviter on inviter.id = i.invited_by
  where i.invited_email = v_email
    and public.parent_invite_is_live(i)
    and s.role = 'student'
    and s.status = 'approved'
  order by i.created_at, i.id;
end;
$$;

comment on function public.list_my_parent_invites() is
  'spec-second-parent (AD-16): for an approved parent, the live invites whose invited_email equals the caller''s confirmed auth.users email: invite id, child name, inviter name, expiry. Empty for anyone else.';

revoke all on function public.list_my_parent_invites() from public, anon, service_role;
grant execute on function public.list_my_parent_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- accept_parent_invite(invite): the slot-2 link.
-- ---------------------------------------------------------------------------

create or replace function public.accept_parent_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite public.parent_invites%rowtype;
  v_student public.profiles%rowtype;
  v_name text;
  v_slot smallint;
begin
  -- Lock order (AD-10): the caller's parents row first.
  perform 1
  from public.parents pa
  where pa.id = v_uid
    and pa.status = 'approved'
  for update;
  if v_uid is null or not found then
    raise exception 'not allowed to accept this invite'
      using errcode = '42501';
  end if;

  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid
    and u.email_confirmed_at is not null;

  select * into v_invite from public.parent_invites i where i.id = p_invite_id;

  -- Not found, or not for this caller: the same refusal.
  if v_invite.id is null or v_email is null or v_invite.invited_email <> v_email then
    raise exception 'not allowed to accept this invite'
      using errcode = '42501';
  end if;

  -- Then the student's profile, then the invite again, under the locks.
  select * into v_student
  from public.profiles p
  where p.id = v_invite.student_id
  for update;

  select * into v_invite
  from public.parent_invites i
  where i.id = p_invite_id
  for update;

  if v_student.id is null
     or v_student.role <> 'student'
     or v_student.status <> 'approved'
     or not public.parent_invite_is_live(v_invite) then
    raise exception 'this invite can no longer be accepted'
      using errcode = '22023', hint = 'invite_not_live';
  end if;

  if (
    select count(*)
    from public.student_parents sp
    where sp.student_id = v_student.id
      and sp.removed_at is null
  ) >= 2 then
    raise exception 'this child already has two parents'
      using errcode = '22023', hint = 'child_has_two_parents';
  end if;

  -- A re-invite cannot undo the admin's removal.
  if exists (
    select 1
    from public.student_parents sp
    where sp.student_id = v_student.id
      and sp.parent_id = v_uid
      and sp.removed_at is not null
  ) then
    raise exception 'your link to this child was removed'
      using errcode = '22023', hint = 'removed_parent';
  end if;

  -- Already linked (no other path links a second parent): not acceptable.
  if exists (
    select 1
    from public.student_parents sp
    where sp.student_id = v_student.id
      and sp.parent_id = v_uid
      and sp.removed_at is null
  ) then
    raise exception 'this invite can no longer be accepted'
      using errcode = '22023', hint = 'invite_not_live';
  end if;

  -- One child per parent and name (0042): an active link or a registered
  -- child with the same trimmed, case-insensitive registration_name.
  v_name := lower(btrim(v_student.registration_name));
  if v_name is not null and v_name <> '' and exists (
    select 1
    from public.profiles c
    where c.id <> v_student.id
      and c.role = 'student'
      and lower(btrim(c.registration_name)) = v_name
      and (
        c.registered_by_parent_id = v_uid
        or exists (
          select 1
          from public.student_parents sp
          where sp.student_id = c.id
            and sp.parent_id = v_uid
            and sp.removed_at is null
        )
      )
  ) then
    raise exception 'you already have a child with this name'
      using errcode = '22023', hint = 'duplicate_child_name';
  end if;

  select min(s.slot) into v_slot
  from (values (1::smallint), (2::smallint)) as s (slot)
  where not exists (
    select 1
    from public.student_parents sp
    where sp.student_id = v_student.id
      and sp.slot = s.slot
      and sp.removed_at is null
  );

  insert into public.student_parents (student_id, parent_id, slot, invited_by)
  values (v_student.id, v_uid, v_slot, v_invite.invited_by);

  update public.parent_invites i
  set status = 'accepted'
  where i.id = v_invite.id;

  return v_student.id;
end;
$$;

comment on function public.accept_parent_invite(uuid) is
  'spec-second-parent (AD-16): the invitee (approved parent, confirmed auth email = invited_email) accepts a live invite; inserts the link into the free slot with invited_by and marks the invite accepted. Returns the student id. 42501 when not found or not theirs; 22023 invite_not_live, child_has_two_parents, removed_parent, duplicate_child_name.';

revoke all on function public.accept_parent_invite(uuid) from public, anon, service_role;
grant execute on function public.accept_parent_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Removing a link cancels that parent's pending invites for the student.
-- ---------------------------------------------------------------------------

create or replace function public.parent_invites_cancel_on_link_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parent_invites i
  set status = 'cancelled'
  where i.student_id = new.student_id
    and i.invited_by = new.parent_id
    and i.status = 'pending';
  return null;
end;
$$;

revoke all on function public.parent_invites_cancel_on_link_removal() from public, anon, authenticated;

create trigger student_parents_cancel_invites_on_removal
  after update of removed_at on public.student_parents
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function public.parent_invites_cancel_on_link_removal();

-- ---------------------------------------------------------------------------
-- Rejecting a student cancels the student's pending invites.
-- ---------------------------------------------------------------------------

create or replace function public.parent_invites_cancel_on_student_reject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parent_invites i
  set status = 'cancelled'
  where i.student_id = new.id
    and i.status = 'pending';
  return null;
end;
$$;

revoke all on function public.parent_invites_cancel_on_student_reject() from public, anon, authenticated;

create trigger profiles_cancel_parent_invites_on_reject
  after update of status on public.profiles
  for each row
  when (
    new.role = 'student'
    and new.status = 'rejected'
    and old.status is distinct from 'rejected'
  )
  execute function public.parent_invites_cancel_on_student_reject();
