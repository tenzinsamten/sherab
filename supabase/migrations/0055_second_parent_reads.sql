-- 0055_second_parent_reads.sql
--
-- spec-second-parent, story 2: the second parent sees everything (CAP-3,
-- AD-9, AD-12).
--
-- * deletion_requests_select loses its `requested_by = auth.uid()` clause
--   (AD-9). Both active parents read a pending request through
--   is_parent_of(); a parent whose link the admin removed no longer does,
--   even for a request they made. The request itself stays for the admin.
--   Likewise, once the admin approves, the requesting parent no longer reads
--   their de-identified row (student_id is null, so is_parent_of fails).
-- * actor_display_name(student_id, actor_id) (AD-12) is the one way to name
--   the parent behind a leave answer (session_leave_history.answered_by) or a
--   deletion request (deletion_requests.requested_by). It answers only a
--   caller who may read that student (the student, a linked parent, a
--   teacher of the student, the admin), and only for an actor who has, or
--   had, a student_parents link to that student. Anything else is null, so
--   it cannot be used to look up arbitrary names. No new profiles policy
--   exposes co-parents.
-- * The registered_by_parent_id column comment no longer says /calendar and
--   the admin parents page read it: from this story they read the links.

-- ---------------------------------------------------------------------------
-- deletion_requests SELECT: the student, a linked parent, the admin.
-- ---------------------------------------------------------------------------

drop policy "deletion_requests_select" on public.deletion_requests;
create policy "deletion_requests_select"
  on public.deletion_requests for select
  to authenticated
  using (
    public.is_parent_of(student_id)
    or student_id = (select auth.uid())
    or (select public.is_admin())
  );

-- ---------------------------------------------------------------------------
-- actor_display_name(student_id, actor_id)
-- ---------------------------------------------------------------------------

create or replace function public.actor_display_name(p_student_id uuid, p_actor_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select a.display_name
  from public.profiles a
  where a.id = p_actor_id
    -- The actor is, or was, one of the student's parents.
    and exists (
      select 1
      from public.student_parents sp
      where sp.student_id = p_student_id
        and sp.parent_id = p_actor_id
    )
    -- The caller may read the student (the same people the student's
    -- profiles policies admit: self, linked parent, teacher, admin).
    and (
      p_student_id = (select auth.uid())
      or public.is_parent_of(p_student_id)
      or public.is_admin()
      or public.is_teacher_of_student(p_student_id)
      or exists (
        select 1
        from public.profiles s
        where s.id = p_student_id
          and s.role = 'student'::public.user_role
          and s.class_id is not null
          and public.is_teacher_of_class(s.class_id)
      )
    );
$$;

comment on function public.actor_display_name(uuid, uuid) is
  'spec-second-parent (AD-12): the display name of the parent behind a leave answer or deletion request for that student. Returns null unless the caller may read the student (the student, is_parent_of, a teacher of the student, the admin) and the actor has a student_parents row for the student, removed rows included.';

revoke all on function public.actor_display_name(uuid, uuid) from public, anon, service_role;
grant execute on function public.actor_display_name(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- registered_by_parent_id: no access readers left.
-- ---------------------------------------------------------------------------

comment on column public.profiles.registered_by_parent_id is
  'spec-second-parent (AD-10): the parent who registered the student (parents.id), set once by handle_new_user() at sign-up. Used only by the one-student-per-parent-and-name rule (0042) and for "registered by" display; never read for access (student_parents is the link, and every parent-scoped query reads it). Changed only by trusted paths (guard trigger profiles_guard_link_columns).';
