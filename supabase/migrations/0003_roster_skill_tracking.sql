-- 0003_roster_skill_tracking.sql
-- Story 2-1: Roster & Skill-Status Tracking
--
-- Extends the Story 1-1/1-2 identity model (profiles + class_teachers +
-- is_admin()/is_teacher_of_class()) -- no new per-feature authorization
-- check is introduced (Boundaries: "Authorization enforced entirely in RLS
-- reusing is_admin()/is_teacher_of_class(class_id) -- never a new
-- per-feature check"). class_id is denormalized directly onto both new
-- tables so RLS never needs a subquery through profiles (Code Map).
--
-- History-as-append (ARCHITECTURE-SPINE.md AD-5): both tables are
-- insert-only -- no UPDATE/DELETE policy exists on either, matching the
-- pattern already established for `profiles` in 0001/0002. "Current" is
-- always the latest row by timestamp for a given (student, subject) pair,
-- computed at read time (see src/routes/teacher/classes/[id]/+page.server.ts)
-- -- never stored as a separate mutable column, which is also what makes
-- concurrent two-teacher edits safe (no shared row to clobber).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.skill_area as enum ('language', 'song', 'dance');
create type public.skill_level as enum ('not_started', 'learning', 'confident');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.skill_status_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  skill_area public.skill_area not null,
  level public.skill_level not null,
  notes text,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);

comment on table public.skill_status_history is
  'Append-only (AD-5): one row per skill-status change, never updated in place. "Current" = the latest row per (student_id, skill_area) by recorded_at, computed at read time -- every prior row remains queryable as history (e.g. for a substitute teacher newly assigned to the class).';

create index skill_status_history_student_area_recorded_idx
  on public.skill_status_history (student_id, skill_area, recorded_at desc);

-- Every SELECT policy on this table filters via is_teacher_of_class(class_id)
-- (below) -- this index is what that filter actually uses.
create index skill_status_history_class_id_idx
  on public.skill_status_history (class_id);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  present boolean not null,
  notes text,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  session_date date not null default current_date
);

comment on table public.attendance_records is
  'Append-only (AD-5): one row per attendance mark. session_date is the teacher-chosen Sunday session date the mark applies to (deliberately independent of recorded_at, so a late catch-up entry lands on the right Sunday); recorded_at is simply when the row was inserted.';

create index attendance_records_student_recorded_idx
  on public.attendance_records (student_id, recorded_at desc);

-- Every SELECT policy on this table filters via is_teacher_of_class(class_id)
-- (below) -- this index is what that filter actually uses.
create index attendance_records_class_id_idx
  on public.attendance_records (class_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Reuses is_admin()/is_teacher_of_class(class_id) exclusively (Boundaries:
-- "never a new per-feature check") -- select policies, and the "may this
-- caller write into this class" half of each insert policy, ask nothing
-- beyond those two functions. No UPDATE/DELETE policy on either table --
-- append-only by absence, matching profiles' pattern (0001/0002).
--
-- The insert policies additionally require, inline (not a new named
-- function), that student_id actually names an approved student of that
-- same class -- the frozen Boundaries line "Roster reads and writes are
-- scoped to profiles.role='student' AND status='approved' within the
-- teacher's assigned class" is an Always for writes too, not just the
-- query-layer status='approved' filter the roster read already applies.
-- Without this, an assigned teacher could otherwise insert a row against a
-- Pending/Rejected student's id, or a student belonging to a different
-- class, despite the class-membership check passing. is_admin() stays an
-- unconditional bypass of this exists() check, matching how admin bypasses
-- every other role-scoped check in this codebase.
--
-- Both insert policies also require recorded_by = auth.uid() unconditionally
-- (including for the is_admin() branch) -- without it, a direct API call
-- (bypassing the app, which always sets recorded_by to the caller's own id)
-- could attribute a row to a different user than the one actually making the
-- request.
-- ---------------------------------------------------------------------------

alter table public.skill_status_history enable row level security;
alter table public.attendance_records enable row level security;

create policy "skill_status_history_select_admin_or_assigned_teacher"
  on public.skill_status_history for select
  using (public.is_admin() or public.is_teacher_of_class(class_id));

create policy "skill_status_history_insert_admin_or_assigned_teacher"
  on public.skill_status_history for insert
  with check (
    recorded_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.is_teacher_of_class(class_id)
        and exists (
          select 1
          from public.profiles p
          where p.id = student_id
            and p.class_id = skill_status_history.class_id
            and p.role = 'student'
            and p.status = 'approved'
        )
      )
    )
  );

create policy "attendance_records_select_admin_or_assigned_teacher"
  on public.attendance_records for select
  using (public.is_admin() or public.is_teacher_of_class(class_id));

create policy "attendance_records_insert_admin_or_assigned_teacher"
  on public.attendance_records for insert
  with check (
    recorded_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.is_teacher_of_class(class_id)
        and exists (
          select 1
          from public.profiles p
          where p.id = student_id
            and p.class_id = attendance_records.class_id
            and p.role = 'student'
            and p.status = 'approved'
        )
      )
    )
  );
