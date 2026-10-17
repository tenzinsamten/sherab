-- 0051_rls_initplan_helpers.sql
--
-- Navigation latency CAP-6 (story 5): RLS helpers evaluated once per query.
--
-- * Policies on the hot tables (class_sessions, class_days, classes,
--   class_enrollments, session_leave_history, parents, profiles,
--   class_teachers) called auth.uid() and public.is_admin() bare, so Postgres
--   evaluated them once per row checked. is_admin() is a SECURITY DEFINER
--   primary-key lookup on profiles, so a non-admin paid one extra lookup per
--   row on every read and write.
-- * Each such policy is dropped and recreated with the same name, command,
--   roles, USING and WITH CHECK; only the zero-argument calls are wrapped as
--   (select auth.uid()) and (select public.is_admin()), which Postgres runs
--   once per query as an InitPlan.
-- * The recreated text also spells enum casts explicitly
--   ('student'::public.user_role etc.) and qualifies
--   session_leave_history.class_session_id. That is spelling only: Postgres
--   stores the same expression, and the meaning is unchanged.
-- * Per-row cost that remains: the row-argument SECURITY DEFINER helpers
--   (is_teacher_of_class, is_teacher_of_student, is_parent_of,
--   is_parent_in_class, is_enrolled_in_class) still run per row because they
--   depend on the row; only an auth.uid() argument is wrapped.
-- * Hot-table policies with no zero-argument call are left as they are:
--   class_days_select_signed_in, classes_select_parent_in_class,
--   profiles_select_parent_of_child, session_leave_history_insert_parent.
-- * Policies on other tables keep the bare form: the scope was limited to
--   the hot tables (user decision, 2026-10-17).
--
-- Production: each drop/create takes a brief ACCESS EXCLUSIVE lock on its
-- table until commit, so apply this at a quiet time. Rolling back means a
-- new migration that restores the bare forms, not a code revert.
--
-- Who each policy admits does not change; no helper body changes.

-- ---------------------------------------------------------------------------
-- class_days
-- ---------------------------------------------------------------------------

drop policy "class_days_insert_admin" on public.class_days;
create policy "class_days_insert_admin"
  on public.class_days for insert
  with check ((select public.is_admin()));

drop policy "class_days_update_admin" on public.class_days;
create policy "class_days_update_admin"
  on public.class_days for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- class_enrollments
-- ---------------------------------------------------------------------------

drop policy "class_enrollments_select" on public.class_enrollments;
create policy "class_enrollments_select"
  on public.class_enrollments for select
  using (
    (select public.is_admin())
    or public.is_teacher_of_class(class_id)
    or student_id = (select auth.uid())
    or public.is_parent_of(student_id)
  );

-- ---------------------------------------------------------------------------
-- class_sessions
-- ---------------------------------------------------------------------------

drop policy "class_sessions_select" on public.class_sessions;
create policy "class_sessions_select"
  on public.class_sessions for select
  using (
    (select public.is_admin())
    or public.is_teacher_of_class(class_id)
    or public.is_enrolled_in_class((select auth.uid()), class_id)
    or public.is_parent_in_class(class_id)
  );

drop policy "class_sessions_update_admin_or_teacher" on public.class_sessions;
create policy "class_sessions_update_admin_or_teacher"
  on public.class_sessions for update
  using ((select public.is_admin()) or public.is_teacher_of_class(class_id))
  with check ((select public.is_admin()) or public.is_teacher_of_class(class_id));

-- ---------------------------------------------------------------------------
-- class_teachers
-- ---------------------------------------------------------------------------

drop policy "class_teachers_delete_admin" on public.class_teachers;
create policy "class_teachers_delete_admin"
  on public.class_teachers for delete
  using ((select public.is_admin()));

drop policy "class_teachers_insert_admin" on public.class_teachers;
create policy "class_teachers_insert_admin"
  on public.class_teachers for insert
  with check ((select public.is_admin()));

drop policy "class_teachers_select_admin_or_own" on public.class_teachers;
create policy "class_teachers_select_admin_or_own"
  on public.class_teachers for select
  using ((select public.is_admin()) or teacher_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------

drop policy "classes_delete_admin" on public.classes;
create policy "classes_delete_admin"
  on public.classes for delete
  using ((select public.is_admin()));

drop policy "classes_insert_admin" on public.classes;
create policy "classes_insert_admin"
  on public.classes for insert
  with check ((select public.is_admin()));

drop policy "classes_select_admin_or_assigned_teacher" on public.classes;
create policy "classes_select_admin_or_assigned_teacher"
  on public.classes for select
  using ((select public.is_admin()) or public.is_teacher_of_class(id));

drop policy "classes_select_own_student" on public.classes;
create policy "classes_select_own_student"
  on public.classes for select
  using (public.is_enrolled_in_class((select auth.uid()), id));

drop policy "classes_update_admin" on public.classes;
create policy "classes_update_admin"
  on public.classes for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- classes_select_parent_in_class calls only is_parent_in_class(id): unchanged.

-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------

drop policy "parents_select_own_or_admin" on public.parents;
create policy "parents_select_own_or_admin"
  on public.parents for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy "parents_update_admin" on public.parents;
create policy "parents_update_admin"
  on public.parents for update
  to authenticated
  using ((select public.is_admin()))
  with check (
    (select public.is_admin())
    and (
      status <> 'approved'::public.parent_status
      or exists (
        select 1
        from public.profiles p
        where p.id = parents.id
          and p.email_confirmed_at is not null
      )
    )
  );

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
  on public.profiles for select
  using ((select public.is_admin()));

drop policy "profiles_select_admin_or_teacher_of_student_class" on public.profiles;
create policy "profiles_select_admin_or_teacher_of_student_class"
  on public.profiles for select
  using (
    role = 'student'::public.user_role
    and (
      (
        class_id is not null
        and ((select public.is_admin()) or public.is_teacher_of_class(class_id))
      )
      or public.is_teacher_of_student(id)
    )
  );

drop policy "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = (select auth.uid()));

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
  );

-- profiles_select_parent_of_child calls only is_parent_of(id): unchanged.

-- ---------------------------------------------------------------------------
-- session_leave_history
-- ---------------------------------------------------------------------------

drop policy "session_leave_history_select" on public.session_leave_history;
create policy "session_leave_history_select"
  on public.session_leave_history for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or public.is_parent_of(student_id)
    or (select public.is_admin())
    or exists (
      select 1
      from public.class_sessions s
      where s.id = session_leave_history.class_session_id
        and public.is_teacher_of_class(s.class_id)
    )
  );

-- session_leave_history_insert_parent calls only is_parent_of(student_id):
-- unchanged.
