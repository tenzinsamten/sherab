-- 0004_homework.sql
-- Story 3-1: One-off Homework Assignment & Review
--
-- Extends the Story 1-1/1-2/2-1 identity + authorization model (profiles +
-- class_teachers + is_admin()/is_teacher_of_class(), the approved-student
-- exists() pattern 0003 established for writes) -- no new per-feature
-- authorization primitive is introduced (Boundaries: "Authorization
-- enforced entirely in RLS reusing is_admin()/is_teacher_of_class(class_id)
-- and the approved-student exists() pattern from Story 2-1 -- never a new
-- per-feature check").
--
-- Three tables (ARCHITECTURE-SPINE.md Structural Seed):
--   homework_assignments    -- one row per assignment (or, from Story 3-2
--                              on, per recurring series). recurrence_rule
--                              is reserved for that story -- this story's
--                              client code only ever inserts NULL.
--   homework_instances       -- one row per period an assignment is due;
--                              exactly one per one-off assignment this
--                              story. UNIQUE(assignment_id, period_start)
--                              per AD-8.
--   homework_status_history  -- append-only (AD-5), one row per
--                              Assigned/Done/Reviewed transition per
--                              (instance, student). Done and Reviewed are
--                              independently readable (Intent/Boundaries):
--                              unlike skill_status_history's single-axis
--                              "latest row wins" read, a consumer here
--                              scans the full history per status -- see
--                              src/lib/server/homework-status.ts.
--
-- Overdue (due_date < today AND not done) is computed at read time, never
-- a stored/auto-set flag (Boundaries) -- no column/trigger for it here.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.homework_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  title text not null,
  skill_area public.skill_area not null,
  reference_link text,
  recurrence_rule jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.homework_assignments is
  'One row per assignment (or, from Story 3-2 on, per recurring series). recurrence_rule is reserved for Story 3-2 -- this story''s client code only ever inserts NULL (one-off case). No reference-link URL validation (epic context: teachers are already admin-verified, so that trust is already established).';

create index homework_assignments_class_id_idx on public.homework_assignments (class_id);

create table public.homework_instances (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.homework_assignments (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  period_start date not null,
  due_date date not null,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (assignment_id, period_start)
);

comment on table public.homework_instances is
  'One row per period an assignment is due -- a one-off assignment (this story) has exactly one instance, with period_start set equal to due_date (there is no real recurrence period yet to distinguish it from; Story 3-2 gives period_start its real meaning). AD-8: the UNIQUE(assignment_id, period_start) constraint rejects duplicate-period inserts at the DB level; RLS additionally restricts direct client inserts to assignments where recurrence_rule IS NULL (below) -- a recurring assignment''s instances (Story 3-2) can only be created by the scheduled generation function''s trusted connection, never a direct client insert. archived_at/archived_by record a teacher''s explicit action, never auto-set -- an overdue instance stays visible until this is set (Intent: "Overdue items never auto-expire... until a teacher explicitly archives them").';

create index homework_instances_class_id_idx on public.homework_instances (class_id);
create index homework_instances_assignment_id_idx on public.homework_instances (assignment_id);

create table public.homework_status_history (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.homework_instances (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  status text not null check (status in ('assigned', 'done', 'reviewed')),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);

comment on table public.homework_status_history is
  'Append-only (AD-5): a Done or Reviewed transition inserts a new row, never updates one in place. Every row for a given (instance_id, student_id) remains queryable as history -- Done and Reviewed are independently readable (Intent): whether a student is Done never depends on whether they are also Reviewed, and vice versa (see src/lib/server/homework-status.ts, which scans the full history per status rather than picking one collapsed "current" row the way skill_status_history''s reader does). The first row for a (instance_id, student_id) pair is always status=''assigned'', inserted only by the teacher/admin at assignment-creation time; a student can self-mark ''done'' only once that row exists (RLS below) -- an untargeted student has no assigned row for that instance and so cannot self-mark at all.';

create index homework_status_history_instance_student_idx
  on public.homework_status_history (instance_id, student_id);

-- Every SELECT policy on this table filters via is_teacher_of_class(class_id)
-- (below) -- this index is what that filter actually uses, matching 0003's
-- precedent.
create index homework_status_history_class_id_idx
  on public.homework_status_history (class_id);

-- ---------------------------------------------------------------------------
-- app_settings seed: homework look-ahead window (Epic 3 context: "must be a
-- configurable value in the data model, not hardcoded, so it can widen
-- later without a structural change" -- same pattern the architecture spine
-- names for the streak grace period and badge milestone step). Read by
-- src/routes/student/+page.server.ts to bound the student's open-homework
-- list to "current + next period"; `on conflict do nothing` keeps this
-- idempotent across a local `supabase db reset`.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'homework_lookahead_days',
  '{"days": 14}'::jsonb,
  'How many days beyond today a student''s open-homework list looks ahead (current + next period; default two weeks). Overdue items are always included regardless of this window -- Boundaries: overdue items never auto-hide.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Helper functions (student-side visibility only)
--
-- is_admin()/is_teacher_of_class() (0001) already cover the teacher/admin
-- side. A student's own visibility into homework_assignments/
-- homework_instances ("am I targeted by this?") could in principle be
-- expressed as a plain exists() subquery joining across these tables the
-- way 0003's writes reuse the approved-student exists() shape -- but
-- homework_assignments and homework_instances each need to read the
-- *other* table's rows to answer that (an assignment is visible if any of
-- its instances targets me; an instance's own INSERT policy separately
-- needs to read homework_assignments to enforce AD-8). A raw subquery in
-- each direction creates a real two-table RLS reference cycle -- Postgres's
-- policy rewriter detects it and raises "infinite recursion detected in
-- policy for relation" the moment a single statement touches both sides
-- (confirmed empirically while writing this migration's own RLS test
-- suite). SECURITY DEFINER functions are the same fix 0001 already uses for
-- is_admin()/is_teacher_of_class() (which exist specifically to let a
-- policy consult profiles/class_teachers without recursively re-triggering
-- RLS): the function body runs as its owner (bypassing RLS on the tables it
-- queries internally) as an opaque call, so calling it from a policy never
-- gets inlined/re-expanded by the rewriter the way a raw subquery would.
-- ---------------------------------------------------------------------------

create or replace function public.is_targeted_for_homework_instance(target_instance_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.homework_status_history h
    where h.instance_id = target_instance_id
      and h.student_id = auth.uid()
  );
$$;

comment on function public.is_targeted_for_homework_instance(uuid) is
  'True if the calling JWT has any homework_status_history row (assigned/done/reviewed) for this instance -- i.e. the student was targeted by it. SECURITY DEFINER to avoid a homework_instances <-> homework_status_history RLS reference cycle.';

create or replace function public.is_targeted_for_homework_assignment(target_assignment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.homework_instances hi
    join public.homework_status_history h on h.instance_id = hi.id
    where hi.assignment_id = target_assignment_id
      and h.student_id = auth.uid()
  );
$$;

comment on function public.is_targeted_for_homework_assignment(uuid) is
  'True if the calling JWT is targeted by any instance of this assignment. SECURITY DEFINER to avoid a homework_assignments <-> homework_instances RLS reference cycle (homework_instances'' own INSERT policy separately reads homework_assignments for AD-8).';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Reuses is_admin()/is_teacher_of_class(class_id) exclusively for the
-- teacher/admin side, plus the same inline approved-student exists() shape
-- 0003 established for writes (Boundaries: "never a new per-feature
-- check"). Student-side SELECT access is a plain auth.uid() comparison on
-- homework_status_history (matching e.g. class_teachers_select_admin_or_
-- own's `teacher_id = auth.uid()` precedent in 0001), or -- for
-- homework_assignments/homework_instances, where that would otherwise
-- require a cross-table subquery -- the two SECURITY DEFINER functions
-- above. No UPDATE/DELETE policy on homework_status_history -- append-only
-- by absence, matching 0003.
-- ---------------------------------------------------------------------------

alter table public.homework_assignments enable row level security;
alter table public.homework_instances enable row level security;
alter table public.homework_status_history enable row level security;

-- homework_assignments -------------------------------------------------

create policy "homework_assignments_select_admin_teacher_or_targeted_student"
  on public.homework_assignments for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_targeted_for_homework_assignment(id)
  );

create policy "homework_assignments_insert_admin_or_assigned_teacher"
  on public.homework_assignments for insert
  with check (
    created_by = auth.uid()
    and (public.is_admin() or public.is_teacher_of_class(class_id))
  );

-- No UPDATE/DELETE policy on homework_assignments: editing/deleting a
-- mis-created assignment is out of this story's Tasks & Acceptance --
-- archiving (below) operates on the instance, not the assignment.

-- homework_instances -----------------------------------------------------

create policy "homework_instances_select_admin_teacher_or_targeted_student"
  on public.homework_instances for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or public.is_targeted_for_homework_instance(id)
  );

-- AD-8: direct client inserts are restricted to a one-off assignment
-- (recurrence_rule IS NULL) -- this story never creates a recurring
-- assignment, but the check is real DB enforcement, not just an app-level
-- convention (matching e.g. classes.code's unique-constraint precedent in
-- Story 1-1's own RLS test suite).
create policy "homework_instances_insert_admin_or_assigned_teacher"
  on public.homework_instances for insert
  with check (
    (public.is_admin() or public.is_teacher_of_class(class_id))
    and exists (
      select 1
      from public.homework_assignments a
      where a.id = homework_instances.assignment_id
        and a.class_id = homework_instances.class_id
        and a.recurrence_rule is null
    )
  );

-- Archiving (Intent: "Overdue items never auto-expire... until a teacher
-- explicitly archives them") is the one update this story performs on this
-- table -- authorized at the same trust level as creating the instance in
-- the first place (admin or the assigned teacher). The app layer only ever
-- sets archived_at/archived_by through this policy, the same "column
-- exists, but this story's client code only ever writes it this one way"
-- shape already used for recurrence_rule above.
create policy "homework_instances_update_admin_or_assigned_teacher"
  on public.homework_instances for update
  using (public.is_admin() or public.is_teacher_of_class(class_id))
  with check (public.is_admin() or public.is_teacher_of_class(class_id));

-- No DELETE policy on homework_instances: archiving, not deletion, is the
-- explicit action Intent calls for.

-- homework_status_history --------------------------------------------------

create policy "homework_status_history_select_admin_teacher_or_own"
  on public.homework_status_history for select
  using (
    public.is_admin()
    or public.is_teacher_of_class(class_id)
    or student_id = auth.uid()
  );

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
    -- legitimately see that instance (admin, its real assigned teacher, or
    -- a targeted student), so a mismatched/foreign instance_id resolves to
    -- no visible row and the check fails closed.
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
            and exists (
              select 1
              from public.profiles p
              where p.id = student_id
                and p.class_id = homework_status_history.class_id
                and p.role = 'student'
                and p.status = 'approved'
            )
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
        )
      )
    )
  );

-- No UPDATE/DELETE policy: append-only by absence (AD-5), matching 0003.
