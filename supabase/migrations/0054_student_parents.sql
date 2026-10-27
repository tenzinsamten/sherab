-- 0054_student_parents.sql
--
-- spec-second-parent, story 1: the link model (AD-10, with AD-4 and AD-11).
--
-- A student linked to one parent through profiles.parent_id, so a second
-- parent could not exist. Links now live in student_parents, which holds up
-- to two active parents per student. Existing families see no change: each
-- non-null parent_id becomes one slot-1 link.
--
-- * student_parents (student_id, parent_id, slot 1 or 2, invited_by,
--   linked_at, removed_by, removed_at). Partial unique (student_id, slot) and
--   (student_id, parent_id) over active rows (removed_at is null): a third
--   active link, or a duplicate, is impossible whatever the concurrency.
--   Removed rows are kept and never change again (removed_by / removed_at
--   are set once). RLS: SELECT for the student's active parents and the
--   admin. No client write policy or grant: links are written only by
--   handle_new_user() (the sign-up), later by the invite accept (story 3)
--   and the admin's removal (story 4), and by the service role.
-- * A deferred constraint trigger on UPDATE / DELETE locks the student's
--   profiles row, recounts the active links and refuses zero while the
--   student exists. Concurrent removals serialise on that lock; deleting the
--   student cascades the links and passes. Inserts are not checked, so
--   service-role fixtures may create a student without a link.
-- * profiles.parent_id is renamed registered_by_parent_id. Its FK to
--   parents becomes ON DELETE SET NULL. It is set once at sign-up, read
--   only by the one-student-per-parent-and-name rule (0042) and for
--   "registered by" display, and never for access.
-- * Rebuilt on the links: handle_new_user() (writes registered_by_parent_id
--   and the slot-1 link), guard_profile_link_columns(), is_parent_of(),
--   linked_children(), homework_push_targets() (0037) and
--   student_registration_state() (0042, on registered_by_parent_id).
-- * has_link_to(student_id): an active link from the caller, whatever the
--   parent's or student's approval status (AD-4). It replaces is_parent_of()
--   in the four self-decision guards (0028 sick-decision policy and trigger,
--   0029 deletion approval policy, 0031 decide_class_join) and is added to
--   the registration-review policy (0051).
-- * parents: a row with active links cannot be rejected (it cannot leave
--   approved) or deleted. The admin removes the links first (story 4).
-- * Lock order everywhere: the parent's parents row, then the student's
--   profiles row.
--
-- The migration stops before changing anything if an existing row would
-- break the new rules, and ends with a check that no database function
-- still reads the old column.

-- ---------------------------------------------------------------------------
-- Pre-check: stop if an existing link would break the new rules.
-- ---------------------------------------------------------------------------

do $$
declare
  v_not_approved integer;
  v_not_student integer;
begin
  -- A parents row with active links must stay approved.
  select count(*)
    into v_not_approved
  from public.profiles s
  join public.parents pa on pa.id = s.parent_id
  where pa.status <> 'approved';

  -- Links are student-only (profiles_student_fields_check already says so).
  select count(*)
    into v_not_student
  from public.profiles s
  where s.parent_id is not null
    and s.role <> 'student';

  if v_not_approved > 0 or v_not_student > 0 then
    raise exception
      '0054_student_parents: % student(s) linked to a parent that is not approved, % non-student row(s) with a parent. Nothing was changed.',
      v_not_approved, v_not_student
      using
        errcode = 'check_violation',
        hint = 'List them with: select s.id, s.role, s.parent_id, pa.status from public.profiles s left join public.parents pa on pa.id = s.parent_id where s.parent_id is not null and (s.role <> ''student'' or pa.status <> ''approved''); -- approve the parent or unlink the student by hand, then run the migration again.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- student_parents
-- ---------------------------------------------------------------------------

create table public.student_parents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid not null references public.profiles (id) on delete restrict,
  slot smallint not null,
  invited_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete set null,
  removed_at timestamptz,
  constraint student_parents_slot_check check (slot in (1, 2)),
  constraint student_parents_not_self check (student_id <> parent_id),
  constraint student_parents_removed_by_check check (removed_by is null or removed_at is not null)
);

comment on table public.student_parents is
  'spec-second-parent (AD-10): a student''s parents, at most two active (removed_at is null) and, once linked, at least one while the student exists. Written only by trusted paths (sign-up, invite accept, admin removal, service role). Removed rows are kept and never change again. Every parent check reads the active rows through is_parent_of(), linked_children() and has_link_to().';

comment on column public.student_parents.slot is
  '1 or 2. Unique per student over active rows, so a third active link is impossible.';
comment on column public.student_parents.invited_by is
  'The parent who invited this one (AD-16). NULL for the sign-up link (slot 1) and for links migrated from profiles.parent_id.';
comment on column public.student_parents.removed_at is
  'NULL = active. Set once, with removed_by, when the admin removes the link (story 4); the row never changes again.';

create unique index student_parents_active_slot_unique
  on public.student_parents (student_id, slot)
  where removed_at is null;

create unique index student_parents_active_parent_unique
  on public.student_parents (student_id, parent_id)
  where removed_at is null;

create index student_parents_parent_active_idx
  on public.student_parents (parent_id)
  where removed_at is null;

create index student_parents_invited_by_idx
  on public.student_parents (invited_by)
  where invited_by is not null;

create index student_parents_removed_by_idx
  on public.student_parents (removed_by)
  where removed_by is not null;

-- ---------------------------------------------------------------------------
-- has_link_to(student_id): an active link from the caller, any status.
-- ---------------------------------------------------------------------------

create or replace function public.has_link_to(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.student_parents sp
    where sp.student_id = p_student_id
      and sp.parent_id = (select auth.uid())
      and sp.removed_at is null
  );
$$;

comment on function public.has_link_to(uuid) is
  'spec-second-parent (AD-4): true when the caller has an active student_parents link to the student, whatever the parent''s or the student''s approval status. Used by self-decision guards: nobody decides about their own child.';

revoke all on function public.has_link_to(uuid) from public, anon;
grant execute on function public.has_link_to(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: the student's active parents read the active links; the admin reads
-- all, removed ones too. No client writes.
-- ---------------------------------------------------------------------------

alter table public.student_parents enable row level security;

create policy "student_parents_select_parent_or_admin"
  on public.student_parents for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      removed_at is null
      and (select public.is_parent())
      and public.has_link_to(student_id)
    )
  );

revoke all on public.student_parents from anon, authenticated;
grant select on public.student_parents to authenticated;
grant all on public.student_parents to service_role;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: a link joins a student to a parent account.
-- ---------------------------------------------------------------------------

create or replace function public.student_parents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock order (AD-10): the parent's parents row first, so a link insert
  -- and a rejection of that parent (guard_parent_with_links) serialise.
  perform 1
  from public.parents pa
  where pa.id = new.parent_id
  for share;
  if not found then
    raise exception 'a parent link needs a parent account'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.profiles s
    where s.id = new.student_id and s.role = 'student'
  ) then
    raise exception 'a parent link needs a student'
      using errcode = 'check_violation';
  end if;
  -- A link starts active.
  if new.removed_at is not null or new.removed_by is not null then
    raise exception 'a new parent link cannot be removed already'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.student_parents_before_insert() from public, anon, authenticated;

create trigger student_parents_before_insert
  before insert on public.student_parents
  for each row execute function public.student_parents_before_insert();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: removal (with removed_by) is the only change, made once.
-- invited_by and removed_by may still go to NULL: that is ON DELETE SET NULL
-- when the inviting or removing account is deleted.
-- ---------------------------------------------------------------------------

create or replace function public.student_parents_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.student_id is distinct from old.student_id
    or new.parent_id is distinct from old.parent_id
    or new.slot is distinct from old.slot
    or new.linked_at is distinct from old.linked_at
    or (new.invited_by is distinct from old.invited_by and new.invited_by is not null)
  then
    raise exception 'a parent link cannot be changed, only removed'
      using errcode = '42501';
  end if;

  if old.removed_at is not null then
    -- A removed row is never changed again.
    if new.removed_at is distinct from old.removed_at
      or (new.removed_by is distinct from old.removed_by and new.removed_by is not null)
    then
      raise exception 'a removed parent link cannot be changed'
        using errcode = '42501';
    end if;
  elsif new.removed_at is not null then
    -- The removal itself: who removed it is required (the audit); the time
    -- is the database's. removed_by may go to NULL later (ON DELETE SET NULL).
    if new.removed_by is null then
      raise exception 'removing a parent link needs removed_by'
        using errcode = 'check_violation';
    end if;
    new.removed_at := now();
  elsif new.removed_by is not null then
    raise exception 'removed_by is set only with removed_at'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.student_parents_before_update() from public, anon, authenticated;

create trigger student_parents_before_update
  before update on public.student_parents
  for each row execute function public.student_parents_before_update();

-- ---------------------------------------------------------------------------
-- Deferred: a student who exists keeps at least one active link.
-- ---------------------------------------------------------------------------

create or replace function public.student_parents_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialises concurrent removals for one student: the second waits here
  -- and then counts what the first committed.
  perform 1
  from public.profiles p
  where p.id = old.student_id
  for update;

  if not found then
    return null; -- the student was deleted: the links go with them
  end if;

  if not exists (
    select 1
    from public.student_parents sp
    where sp.student_id = old.student_id
      and sp.removed_at is null
  ) then
    raise exception 'a student keeps at least one parent link'
      using errcode = 'check_violation', hint = 'last_parent_link';
  end if;

  return null;
end;
$$;

revoke all on function public.student_parents_keep_one() from public, anon, authenticated;

create constraint trigger student_parents_keep_one
  after update of removed_at or delete on public.student_parents
  deferrable initially deferred
  for each row execute function public.student_parents_keep_one();

-- ---------------------------------------------------------------------------
-- Backfill: one slot-1 link per non-null parent_id.
-- ---------------------------------------------------------------------------

insert into public.student_parents (student_id, parent_id, slot, invited_by, linked_at)
select s.id, s.parent_id, 1, null, s.created_at
from public.profiles s
where s.parent_id is not null;

-- ---------------------------------------------------------------------------
-- profiles.parent_id -> registered_by_parent_id, FK ON DELETE SET NULL.
-- The check constraint and the 0042 unique index follow the rename.
-- ---------------------------------------------------------------------------

alter table public.profiles rename column parent_id to registered_by_parent_id;

alter table public.profiles drop constraint profiles_parent_id_fkey;
alter table public.profiles
  add constraint profiles_registered_by_parent_id_fkey
  foreign key (registered_by_parent_id) references public.parents (id) on delete set null;

alter index public.profiles_parent_id_idx rename to profiles_registered_by_parent_id_idx;

comment on column public.profiles.registered_by_parent_id is
  'spec-second-parent (AD-10): the parent who registered the student (parents.id), set once by handle_new_user() at sign-up. Used only by the one-student-per-parent-and-name rule (0042) and for "registered by" display; never read for access (student_parents is the link). Until story 2, /calendar and the admin parents page still read it. Changed only by trusted paths (guard trigger profiles_guard_link_columns).';

comment on column public.profiles.guardian_email is
  'Display copy of the guardian email given at registration (Story 7-2). Never used for authorization; student_parents holds the links.';

-- ---------------------------------------------------------------------------
-- handle_new_user(): 0024 with registered_by_parent_id and the slot-1 link.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u auth.users%rowtype;
  meta_role public.user_role;
  app_role text;
  client_role text;
  meta_registration_name text;
  meta_class_id uuid;
  meta_consent_at timestamptz;
  meta_guardian_email text;
  student_parent_id uuid;
  parent_matches integer;
begin
  -- Deferred: NEW is the row as inserted; read its state at commit instead.
  select * into u from auth.users where id = new.id;
  if not found then
    return null; -- deleted again within the same transaction
  end if;

  app_role := nullif(u.raw_app_meta_data ->> 'role', '');
  client_role := u.raw_user_meta_data ->> 'role';

  if app_role is not null then
    if app_role not in (select unnest(enum_range(null::public.user_role))::text) then
      raise exception 'handle_new_user: unknown app_metadata role "%" (issue #50)', app_role
        using errcode = 'check_violation';
    end if;
    meta_role := app_role::public.user_role;
  elsif client_role in ('student', 'parent') then
    meta_role := client_role::public.user_role;
  else
    raise exception 'handle_new_user: sign-up refused, role "%" may not be chosen by the client (issue #50, AD-4)',
      coalesce(client_role, '<none>')
      using errcode = 'insufficient_privilege';
  end if;

  -- A crafted public signUp() skips /register's checks: a parent login may
  -- not take a student login address or an over-long name.
  if meta_role = 'parent' then
    if lower(u.email) like '%@students.internal.invalid' then
      raise exception 'handle_new_user: a parent may not use a student login address'
        using errcode = 'check_violation';
    end if;
    -- The name the profile gets below (registration_name wins, as in 0020).
    if length(coalesce(
      u.raw_user_meta_data ->> 'registration_name',
      u.raw_user_meta_data ->> 'display_name'
    )) > 80 then
      raise exception 'handle_new_user: parent display_name longer than 80 characters'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Story 7-2: the parent who registers the student.
  if meta_role = 'student' then
    meta_guardian_email := nullif(btrim(u.raw_user_meta_data ->> 'guardian_email'), '');

    if meta_guardian_email is not null then
      select count(*), min(pa.id::text)::uuid
        into parent_matches, student_parent_id
      from public.parents pa
      join public.profiles pp on pp.id = pa.id
      where pa.status = 'approved'
        and lower(btrim(pp.email)) = lower(meta_guardian_email);

      if parent_matches > 1 then
        raise exception 'handle_new_user: guardian_email matches more than one approved parent'
          using errcode = 'check_violation';
      end if;

      -- Lock order (AD-10): the parent's parents row first, then the
      -- student's profile (inserted below). Re-check it is still approved.
      if student_parent_id is not null then
        perform 1
        from public.parents pa
        where pa.id = student_parent_id
          and pa.status = 'approved'
        for update;
        if not found then
          student_parent_id := null;
        end if;
      end if;
    end if;

    if app_role is null then
      -- user_metadata student (the /join server action, or a crafted public
      -- signUp()): only the synthetic registration address, and only with
      -- an approved parent. Otherwise the whole sign-up rolls back.
      if lower(u.email) !~ '^pending-[0-9a-f-]+@students\.internal\.invalid$' then
        raise exception 'handle_new_user: a student sign-up must use a pending-<uuid>@students.internal.invalid address'
          using errcode = 'check_violation';
      end if;
      if student_parent_id is null then
        raise exception 'handle_new_user: no approved parent account for this guardian email'
          using errcode = 'check_violation';
      end if;
    end if;
    -- app_metadata student (service role only): trusted, may have no parent.
  end if;

  meta_registration_name := u.raw_user_meta_data ->> 'registration_name';
  meta_class_id := nullif(u.raw_user_meta_data ->> 'class_id', '')::uuid;
  meta_consent_at := nullif(u.raw_user_meta_data ->> 'guardian_consent_given_at', '')::timestamptz;

  insert into public.profiles (
    id, email, display_name, role,
    status, class_id, registration_name, guardian_consent_given_at,
    guardian_email, email_confirmed_at, registered_by_parent_id
  )
  values (
    u.id,
    u.email,
    coalesce(
      meta_registration_name,
      u.raw_user_meta_data ->> 'display_name',
      u.email
    ),
    meta_role,
    case when meta_role = 'student' then 'pending'::public.registration_status else null end,
    case when meta_role = 'student' then meta_class_id else null end,
    case when meta_role = 'student' then meta_registration_name else null end,
    case when meta_role = 'student' then meta_consent_at else null end,
    case when meta_role = 'student' then meta_guardian_email else null end,
    u.email_confirmed_at,
    case when meta_role = 'student' then student_parent_id else null end
  )
  on conflict (id) do nothing;

  -- The slot-1 link, in the same transaction as the profile.
  if found and meta_role = 'student' and student_parent_id is not null then
    insert into public.student_parents (student_id, parent_id, slot, invited_by)
    values (u.id, student_parent_id, 1, null);
  end if;

  if meta_role = 'parent' then
    insert into public.parents (id, status)
    values (u.id, 'pending')
    on conflict (id) do nothing;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guard trigger: 0024 on registered_by_parent_id.
-- SECURITY INVOKER on purpose (see 0024): trusted paths pass.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_link_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and (
      new.registered_by_parent_id is distinct from old.registered_by_parent_id
      or new.guardian_email is distinct from old.guardian_email
      or new.role is distinct from old.role
    )
  then
    raise exception 'registered_by_parent_id, guardian_email and role cannot be changed here'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- is_parent_of(student_id): on the active links.
-- ---------------------------------------------------------------------------

create or replace function public.is_parent_of(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.is_parent()
    and exists (
      select 1
      from public.student_parents sp
      join public.profiles p on p.id = sp.student_id
      where sp.student_id = p_student_id
        and sp.parent_id = auth.uid()
        and sp.removed_at is null
        and p.role = 'student'
        and p.status = 'approved'
    );
$$;

comment on function public.is_parent_of(uuid) is
  'spec-second-parent (AD-4, AD-10): true when the caller is an approved parent with an active student_parents link to the student and the student is approved.';

-- ---------------------------------------------------------------------------
-- linked_children(): on the active links.
-- ---------------------------------------------------------------------------

create or replace function public.linked_children()
returns table (id uuid, name text, status public.registration_status)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.display_name, p.status
  from public.student_parents sp
  join public.profiles p on p.id = sp.student_id
  where public.is_parent()
    and sp.parent_id = auth.uid()
    and sp.removed_at is null
    and p.role = 'student'
    and p.status in ('pending', 'approved')
  order by lower(p.display_name), p.id;
$$;

comment on function public.linked_children() is
  'spec-second-parent (AD-4): the calling approved parent''s actively linked pending and approved children (id, name, status). Rejected children are never returned.';

-- ---------------------------------------------------------------------------
-- homework_push_targets(kind, instance): 0037 with every linked parent.
-- ---------------------------------------------------------------------------

create or replace function public.homework_push_targets(
  p_kind text,
  p_instance_id uuid default null
)
returns table (
  recipient_id uuid,
  student_id uuid,
  student_name text,
  instance_id uuid,
  title text,
  class_name text,
  class_name_bo text,
  class_name_de text,
  due_date date
)
language sql
security definer
set search_path = ''
stable
as $$
  with today as (
    select (now() at time zone 'Europe/Berlin')::date as d
  ),
  progress as (
    select h.instance_id,
           h.student_id,
           bool_or(h.status = 'assigned') as assigned,
           bool_or(h.status in ('done', 'reviewed')) as finished
    from public.homework_status_history h
    where p_instance_id is null or h.instance_id = p_instance_id
    group by h.instance_id, h.student_id
  ),
  -- Open, as in homework_counts() (0025): assigned, not Done or Reviewed,
  -- not archived, student still enrolled. Then the window of the kind.
  open_items as (
    select p.instance_id, p.student_id, hi.assignment_id, hi.class_id, hi.due_date
    from progress p
    join public.homework_instances hi on hi.id = p.instance_id
    cross join today t
    where p.assigned
      and not p.finished
      and hi.archived_at is null
      and exists (
        select 1
        from public.class_enrollments e
        where e.student_id = p.student_id
          and e.class_id = hi.class_id
      )
      and case p_kind
            when 'added' then p_instance_id is not null
            when 'due_soon' then hi.due_date between t.d and t.d + 6
            when 'overdue' then hi.due_date between t.d - 7 and t.d - 1
            else false
          end
  ),
  recipients as (
    -- The student, except for Overdue (parents only).
    select o.instance_id, o.student_id, o.assignment_id, o.class_id, o.due_date,
           s.id as recipient_id, s.display_name as student_name
    from open_items o
    join public.profiles s on s.id = o.student_id
    where p_kind <> 'overdue'
      and s.role = 'student'
      and s.status = 'approved'
    union all
    -- Each actively linked, approved parent of the student.
    select o.instance_id, o.student_id, o.assignment_id, o.class_id, o.due_date,
           pa.id as recipient_id, s.display_name as student_name
    from open_items o
    join public.profiles s on s.id = o.student_id
    join public.student_parents sp on sp.student_id = s.id and sp.removed_at is null
    join public.parents pa on pa.id = sp.parent_id and pa.status = 'approved'
    where s.role = 'student'
      and s.status = 'approved'
  )
  select r.recipient_id,
         r.student_id,
         r.student_name,
         r.instance_id,
         a.title,
         c.name,
         c.name_bo,
         c.name_de,
         r.due_date
  from recipients r
  join public.homework_assignments a on a.id = r.assignment_id
  join public.classes c on c.id = r.class_id
  where exists (
      select 1
      from public.push_subscriptions ps
      where ps.profile_id = r.recipient_id
    )
    and not exists (
      select 1
      from public.push_notification_log l
      where l.kind = p_kind
        and l.instance_id = r.instance_id
        and l.student_id = r.student_id
        and l.recipient_id = r.recipient_id
    )
  order by r.recipient_id, r.due_date, a.title, r.student_id;
$$;

comment on function public.homework_push_targets(text, uuid) is
  '#92, spec-second-parent: the homework notices still owed, one row per recipient, student and instance. added = the given instance (students and each actively linked approved parent); due_soon = open homework due from today to today + 6 (students and parents); overdue = open homework due in the last 7 days (parents only). Today is Europe/Berlin. Leaves out recipients without a push subscription and notices already in push_notification_log. service_role only.';

-- ---------------------------------------------------------------------------
-- student_registration_state(guardian_email, registration_name): 0042 on
-- registered_by_parent_id, search_path pinned.
-- ---------------------------------------------------------------------------

create or replace function public.student_registration_state(
  p_guardian_email text,
  p_registration_name text
)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (
      select s.status::text
      from public.parents pa
      join public.profiles pp on pp.id = pa.id
      join public.profiles s on s.registered_by_parent_id = pa.id
      where pa.status = 'approved'
        and lower(btrim(pp.email)) = lower(btrim(p_guardian_email))
        and s.role = 'student'
        and lower(btrim(s.registration_name)) = lower(btrim(p_registration_name))
      -- At most one row per parent (the 0042 index). More than one approved
      -- parent with this email is refused by handle_new_user() anyway.
      order by s.status, s.id
      limit 1
    ),
    'available'
  );
$$;

-- ---------------------------------------------------------------------------
-- Self-decision guards: has_link_to() instead of is_parent_of() (AD-4).
-- A parent who is pending, or whose child is pending, still has a link.
-- ---------------------------------------------------------------------------

-- 0028: the sick-decision insert policy.
drop policy "sick_leave_decisions_insert_teacher_or_admin" on public.sick_leave_decisions;
create policy "sick_leave_decisions_insert_teacher_or_admin"
  on public.sick_leave_decisions for insert
  to authenticated
  with check (
    (
      public.is_admin()
      or exists (
        select 1
        from public.class_sessions s
        where s.id = class_session_id
          and public.is_teacher_of_class(s.class_id)
      )
    )
    and not public.has_link_to(student_id)
  );

-- 0028: the sick-decision BEFORE INSERT trigger.
create or replace function public.trg_sick_leave_decision_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_answer text;
begin
  select s.class_id into v_class_id
  from public.class_sessions s
  where s.id = new.class_session_id;

  if v_class_id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  -- A signed-in caller must pass the insert policy's rule. Checked first
  -- (a BEFORE trigger runs ahead of the RLS WITH CHECK), so nobody else
  -- learns whether the student is Sick. auth.uid() is NULL only for the
  -- trusted paths (the auto-approval job, the service role).
  if auth.uid() is not null and not (
    (public.is_admin() or public.is_teacher_of_class(v_class_id))
    and not public.has_link_to(new.student_id)
  ) then
    raise exception 'not allowed to decide this sick leave'
      using errcode = '42501';
  end if;

  perform public.lock_session_student_leave(new.class_session_id, new.student_id);

  -- Never the client's values.
  new.decided_by := auth.uid();
  new.decided_at := now();

  select h.answer into v_answer
  from public.session_leave_history h
  where h.class_session_id = new.class_session_id
    and h.student_id = new.student_id
  order by h.answered_at desc, h.id desc
  limit 1;

  if v_answer is distinct from 'sick' then
    raise exception 'only a current Sick answer can be decided'
      using errcode = '22023', hint = 'leave_not_sick';
  end if;

  return new;
end;
$$;

-- 0029: the deletion approval policy.
drop policy "deletion_requests_update_admin" on public.deletion_requests;
create policy "deletion_requests_update_admin"
  on public.deletion_requests for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin() and not public.has_link_to(student_id));

-- 0031: decide_class_join().
create or replace function public.decide_class_join(p_request_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.class_join_requests%rowtype;
begin
  select * into v_request
  from public.class_join_requests r
  where r.id = p_request_id
  for update;

  -- Not found looks the same as not allowed. Never for one's own child,
  -- the admin included (AD-4: any active link, whatever its status).
  if v_request.id is null
     or not (
       (public.is_admin() or public.is_teacher_of_class(v_request.class_id))
       and not public.has_link_to(v_request.student_id)
     ) then
    raise exception 'not allowed to decide this class join request'
      using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'this class join request is no longer pending'
      using errcode = '22023', hint = 'join_not_pending';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'the decision must be approved or rejected'
      using errcode = '22023', hint = 'join_decision_invalid';
  end if;

  if p_decision = 'approved' then
    -- The body of enroll_student() (0016): an approved student only, and
    -- idempotent (already enrolled another way: just marked approved). The
    -- insert fires the late-joiner homework trigger.
    if not exists (
      select 1 from public.profiles p
      where p.id = v_request.student_id and p.role = 'student' and p.status = 'approved'
    ) then
      raise exception 'student % is not an approved student', v_request.student_id
        using errcode = '22023', hint = 'join_student_not_approved';
    end if;

    insert into public.class_enrollments (student_id, class_id, enrolled_by)
    values (v_request.student_id, v_request.class_id, auth.uid())
    on conflict do nothing;
  end if;

  update public.class_join_requests r
  set status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where r.id = v_request.id;
end;
$$;

-- 0036: the decision lists flag one's own child with the same rule as the
-- guards, so a pending teacher-parent sees no decide buttons for it.
create or replace function public.sick_leave_queue()
returns table (
  class_session_id uuid,
  student_id uuid,
  student_name text,
  class_id uuid,
  class_name text,
  day date,
  start_time time,
  answered_at timestamptz,
  decision text,
  decided_at timestamptz,
  decided_by_system boolean,
  own_child boolean,
  class_name_bo text,
  class_name_de text
)
language sql
security definer
set search_path = ''
stable
as $$
  select l.class_session_id,
         l.student_id,
         coalesce(p.display_name, p.registration_name, ''),
         s.class_id,
         c.name,
         d.day,
         coalesce(s.start_time_override, c.default_start_time),
         l.answered_at,
         sd.decision,
         sd.decided_at,
         (sd.id is not null and sd.decided_by is null),
         public.has_link_to(l.student_id),
         c.name_bo,
         c.name_de
  from (
    select distinct on (h.class_session_id, h.student_id)
           h.class_session_id, h.student_id, h.answer, h.answered_at
    from public.session_leave_history h
    order by h.class_session_id, h.student_id, h.answered_at desc, h.id desc
  ) l
  join public.class_sessions s on s.id = l.class_session_id
  join public.class_days d on d.id = s.class_day_id
  join public.classes c on c.id = s.class_id
  join public.profiles p on p.id = l.student_id
  left join public.sick_leave_decisions sd
    on sd.class_session_id = l.class_session_id
   and sd.student_id = l.student_id
  where l.answer = 'sick'
    and not (s.cancelled or d.cancelled)
    and (public.is_admin() or public.is_teacher_of_class(s.class_id))
  order by d.day, coalesce(s.start_time_override, c.default_start_time) nulls first, lower(coalesce(p.display_name, ''));
$$;


create or replace function public.list_class_join_requests()
returns table (
  request_id uuid,
  student_id uuid,
  student_name text,
  current_classes text,
  class_id uuid,
  class_name text,
  requested_at timestamptz,
  own_child boolean,
  current_classes_bo text,
  current_classes_de text,
  class_name_bo text,
  class_name_de text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'teacher')
  ) then
    raise exception 'not allowed to list class join requests'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.student_id,
    coalesce(s.display_name, s.registration_name),
    coalesce(ec.names, ''),
    r.class_id,
    c.name,
    r.requested_at,
    public.has_link_to(r.student_id),
    coalesce(ec.names_bo, ''),
    coalesce(ec.names_de, ''),
    c.name_bo,
    c.name_de
  from public.class_join_requests r
  join public.profiles s on s.id = r.student_id
  join public.classes c on c.id = r.class_id
  left join lateral (
    select
      string_agg(k.name, ', ' order by k.name) as names,
      string_agg(coalesce(k.name_bo, k.name), ', ' order by coalesce(k.name_bo, k.name)) as names_bo,
      string_agg(coalesce(k.name_de, k.name), ', ' order by coalesce(k.name_de, k.name)) as names_de
    from public.class_enrollments e
    join public.classes k on k.id = e.class_id
    where e.student_id = r.student_id
  ) ec on true
  where r.status = 'pending'
    and s.role = 'student'
    and s.status = 'approved'
    and not public.is_enrolled_in_class(r.student_id, r.class_id)
    and (public.is_admin() or public.is_teacher_of_class(r.class_id))
  order by r.requested_at, r.id;
end;
$$;


-- 0051: the registration review, never for one's own child.
drop policy "profiles_update_registration_review" on public.profiles;
create policy "profiles_update_registration_review"
  on public.profiles for update
  using (
    role = 'student'::public.user_role
    and status = 'pending'::public.registration_status
    and class_id is not null
    and ((select public.is_admin()) or public.is_teacher_of_class(class_id))
  )
  with check (
    role = 'student'::public.user_role
    and class_id is not null
    and ((select public.is_admin()) or public.is_teacher_of_class(class_id))
    and status in (
      'approved'::public.registration_status,
      'rejected'::public.registration_status
    )
    and not public.has_link_to(id)
  );

-- ---------------------------------------------------------------------------
-- parents: a row with active links cannot be rejected or deleted (AD-4,
-- AD-10). The admin removes the links first.
-- ---------------------------------------------------------------------------

create or replace function public.guard_parent_with_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.student_parents sp
      where sp.parent_id = old.id and sp.removed_at is null
    ) then
      raise exception 'a parent with linked children cannot be removed; remove the links first'
        using errcode = '23503', hint = 'parent_has_links';
    end if;
    return old;
  end if;

  if new.status is distinct from old.status
    and new.status <> 'approved'
    and exists (
      select 1 from public.student_parents sp
      where sp.parent_id = new.id and sp.removed_at is null
    )
  then
    raise exception 'a parent with linked children cannot be rejected; remove the links first'
      using errcode = '23503', hint = 'parent_has_links';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_parent_with_links() from public, anon, authenticated;

create trigger parents_guard_links
  before update of status or delete on public.parents
  for each row execute function public.guard_parent_with_links();

-- ---------------------------------------------------------------------------
-- Closing check: no function outside the link readers names parent_id.
-- (student_parents.parent_id is itself named parent_id, hence the list.)
-- ---------------------------------------------------------------------------

do $$
declare
  v_names text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into v_names
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ '\mparent_id\M'
    and p.proname not in (
      'handle_new_user',
      'has_link_to',
      'is_parent_of',
      'linked_children',
      'homework_push_targets',
      'student_parents_before_insert',
      'student_parents_before_update',
      'guard_parent_with_links'
    );

  if v_names is not null then
    raise exception
      '0054_student_parents: these functions still name parent_id: %', v_names
      using errcode = 'check_violation',
        hint = 'Rebuild them on student_parents (or registered_by_parent_id) in this migration.';
  end if;
end;
$$;
