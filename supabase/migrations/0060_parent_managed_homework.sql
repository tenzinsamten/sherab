-- 0060_parent_managed_homework.sql
--
-- spec-parent-managed-homework, story 1 (CAP-1, CAP-2 database side;
-- amends AD-12).
--
-- * profiles.parent_managed: off by default. Either linked parent turns it
--   on or off, only through set_parent_managed() (security definer, checks
--   is_parent_of). No profiles update policy or grant is added.
-- * guard_profile_link_columns() (0054) is created again with
--   parent_managed added, so no other authenticated/anon write can change
--   the flag -- including the teacher/admin registration review policy
--   (profiles_update_registration_review). It stays SECURITY INVOKER so the
--   trusted definer paths (set_parent_managed among them) pass.
-- * is_parent_managing(student_id) (security definer): the caller is a
--   linked parent (is_parent_of) and the child is parent-managed.
-- * homework_status_history_insert_admin_teacher_or_self_done: 0016's body
--   verbatim plus one branch -- a parent of a parent-managed child may
--   insert 'done', under the same recorded_by, instance/class and prior
--   'assigned' checks as the student's self-mark. Never 'reviewed'; no
--   update or delete.

-- ---------------------------------------------------------------------------
-- The flag.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column parent_managed boolean not null default false;

comment on column public.profiles.parent_managed is
  'spec-parent-managed-homework CAP-1 (AD-12): a linked parent completes this student''s homework from the parent area. Off by default. Written only through set_parent_managed(); guard_profile_link_columns() blocks every other client write.';

-- ---------------------------------------------------------------------------
-- Guard trigger: 0054 plus parent_managed.
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
      or new.parent_managed is distinct from old.parent_managed
    )
  then
    raise exception 'registered_by_parent_id, guardian_email, role and parent_managed cannot be changed here'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_parent_managed(student_id, on)
-- ---------------------------------------------------------------------------

create or replace function public.set_parent_managed(p_student_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_parent_of(p_student_id), false) then
    raise exception 'only a linked parent can change parent-managed'
      using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'p_on must not be null'
      using errcode = '22004';
  end if;

  update public.profiles
  set parent_managed = p_on
  where id = p_student_id;
end;
$$;

comment on function public.set_parent_managed(uuid, boolean) is
  'spec-parent-managed-homework CAP-1 (AD-12): the only way to change profiles.parent_managed. Raises 42501 unless is_parent_of(p_student_id) holds, so both linked parents have the same right and teachers, the admin and the student have none.';

revoke all on function public.set_parent_managed(uuid, boolean) from public, anon;
grant execute on function public.set_parent_managed(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- is_parent_managing(student_id)
-- ---------------------------------------------------------------------------

create or replace function public.is_parent_managing(p_student_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.is_parent_of(p_student_id)
    and exists (
      select 1
      from public.profiles p
      where p.id = p_student_id
        and p.parent_managed
    );
$$;

comment on function public.is_parent_managing(uuid) is
  'spec-parent-managed-homework CAP-2 (AD-12): true when the caller is a linked parent of the student (is_parent_of) and the student is parent-managed. Used by the homework_status_history insert policy.';

revoke all on function public.is_parent_managing(uuid) from public, anon;
grant execute on function public.is_parent_managing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Homework insert policy: 0016 plus the parent 'done' branch.
-- ---------------------------------------------------------------------------

drop policy "homework_status_history_insert_admin_teacher_or_self_done" on public.homework_status_history;
create policy "homework_status_history_insert_admin_teacher_or_self_done"
  on public.homework_status_history for insert
  with check (
    recorded_by = auth.uid()
    -- The submitted class_id must be the REAL class_id of the referenced
    -- instance -- without this, a teacher legitimately assigned to class A
    -- could submit class_id=A (passing is_teacher_of_class(A) below)
    -- alongside an instance_id/student_id that actually belong to class B,
    -- and write history for a class they don't teach. This subquery is
    -- itself gated by homework_instances' own SELECT policy: it only ever
    -- returns a row (and so only ever matches) when the caller can
    -- legitimately see that instance (admin, its real assigned teacher, a
    -- targeted student, or a linked parent of a targeted child through
    -- is_parent_targeted_for_homework_instance, 0025), so a
    -- mismatched/foreign instance_id resolves to no visible row and the
    -- check fails closed. The parent 'done' branch below depends on that
    -- parent read: tightening it would silently refuse parent marks.
    and exists (
      select 1
      from public.homework_instances hi
      where hi.id = homework_status_history.instance_id
        and hi.class_id = homework_status_history.class_id
    )
    and (
      -- The initial 'assigned' row: inserted only by the teacher/admin at
      -- assignment-creation time, and only against an approved student of
      -- this same class (Boundaries: reuse of the exact 0003 exists()
      -- pattern) -- an untargeted student therefore has no assigned row to
      -- ever self-mark against (I/O matrix: "Untargeted student attempts
      -- Done -> RLS rejects the insert").
      (
        status = 'assigned'
        and (
          public.is_admin()
          or (
            public.is_teacher_of_class(class_id)
            and public.is_enrolled_in_class(student_id, homework_status_history.class_id)
          )
        )
      )
      or (
        status in ('done', 'reviewed')
        -- Requires a prior 'assigned' row for this exact (instance_id,
        -- student_id) pair to already exist (Code Map) -- this is what
        -- stops an untargeted student's self-mark attempt even though they
        -- might otherwise satisfy every other clause below.
        and exists (
          select 1
          from public.homework_status_history existing
          where existing.instance_id = homework_status_history.instance_id
            and existing.student_id = homework_status_history.student_id
            and existing.status = 'assigned'
        )
        -- 'reviewed' additionally requires a prior 'done' row -- Intent's
        -- workflow ("a teacher separately marks Reviewed after confirming
        -- in class") only makes sense once the student has actually been
        -- marked Done; 'done' itself has no such extra requirement beyond
        -- the 'assigned' check above.
        and (
          status <> 'reviewed'
          or exists (
            select 1
            from public.homework_status_history existing_done
            where existing_done.instance_id = homework_status_history.instance_id
              and existing_done.student_id = homework_status_history.student_id
              and existing_done.status = 'done'
          )
        )
        and (
          public.is_admin()
          or public.is_teacher_of_class(class_id)
          -- A student may only self-mark their own row, and only to
          -- 'done' -- 'reviewed' is exclusively a teacher/admin action
          -- (Intent: "a teacher separately marks Reviewed after confirming
          -- in class").
          or (status = 'done' and student_id = auth.uid())
          -- spec-parent-managed-homework CAP-2 (AD-12): a linked parent of
          -- a parent-managed child may mark 'done' too, never 'reviewed'.
          -- recorded_by = auth.uid() above makes the parent the recorder.
          or (status = 'done' and public.is_parent_managing(student_id))
        )
      )
    )
  );
