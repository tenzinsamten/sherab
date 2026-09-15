# Epic 3 Context: Homework

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic gives teachers a way to assign homework (one-off or recurring) scoped to their own class, and gives students a simple self-report loop for completing it. It matters because homework Done-status is a direct input to streaks (Epic 4), and Reviewed-status feeds skill-status history (Epic 2) — without this epic, neither gamification nor skill continuity has real data to work from. The defining test is a full state lifecycle staying intact under both one-off and recurring assignments: Assigned to Done to Reviewed, with overdue items never silently disappearing.

## Stories

- Story 3-1: One-off homework assignment & review
- Story 3-2: Recurring homework assignments

## Requirements & Constraints

- A teacher creates homework scoped to their own class only: title/instructions, skill area (language/song/dance), target students (whole class or a subset), a due date (default "next Sunday", but must support longer windows), and optional reference link(s) opening externally with no embedded preview/player and no link validation (trust already established since only admin-verified teachers can create assignments).
- State machine is `Assigned` → `Done` → `Reviewed`. A student self-marks Done (a teacher may also mark Done on a student's behalf, e.g. for a young child who can't use the app). A teacher separately marks `Reviewed` after confirming in class. `Done` alone is sufficient for streak purposes; `Reviewed` does not gate the streak and instead feeds skill-status history — these two states must be independently readable, never conflated.
- Overdue, not-Done items never auto-expire: they stay visible and flagged overdue until a teacher explicitly archives them.
- A student sees only their own class's open homework (current period + next period only — see look-ahead window below), grouped by due date or skill; a teacher's assignment view shows per-assignment counts of Done/Reviewed and a list of who hasn't started, with a quick per-student review toggle.
- The homework look-ahead window (default: current + next week) must be a configurable value in the data model, not hardcoded, so it can widen later without a structural change.
- Recurring assignments (Story 3-2): a teacher sets a repeat cadence (weekly is the primary case); each period auto-generates a new instance without manual re-creation, continuing until paused/ended. Each instance carries fully independent per-student Done/Reviewed status — completing one instance never marks another done. Editing the series (title, links, due-date offset) or ending it affects only instances going forward; past instances must never be touched. Recurring assignments must be visually distinguishable from one-off ones on roster/assignment views (e.g. a repeat icon).
- No UI/UX design exists yet for either story — build functional-first screens (list, mark-done toggle, review toggle) and flag anywhere a real design decision is needed rather than guessing one.
- Must support German/English/Tibetan UI via Paraglide — no inline copy strings.
- WCAG 2.2 AA is the accessibility floor.

## Technical Decisions

- Direct-lane CRUD per the architecture spine: homework creation and Done/Reviewed toggles flow straight from client to Postgres, authorized entirely by RLS (never frontend-only gating) — same pattern as Epic 2's roster/attendance tables, not a custom API layer.
- Entities (names/relationships fixed by the architecture spine; column-level shape is this epic's to define): `homework_assignments` (scoped to a class, one row per assignment or per recurring series), `homework_instances` (one row per period an assignment is due — a one-off assignment has exactly one instance, a recurring one has many), `homework_status_history` (append-only, one row per student per instance per status transition).
- History-as-append (AD-5) applies here exactly as it did to Epic 2's `attendance_records`/`skill_status_history`: a Done or Reviewed transition inserts a new row into `homework_status_history`, never updates one in place; "current" status for a (student, instance) pair is the latest row by timestamp. This is also the concurrency-safety mechanism (a teacher and a student marking around the same time never clobber each other).
- Recurring-instance integrity (AD-8): `homework_instances` has a `UNIQUE(assignment_id, period_start)` constraint, enforced at the DB level to reject duplicate-period inserts. RLS restricts *direct client* inserts into `homework_instances` to assignments where `recurrence_rule IS NULL` (one-off case, inserted straight from the client at creation time); instances for a recurring assignment (`recurrence_rule IS NOT NULL`) can only be created by the scheduled generation function's trusted connection, never by a direct client insert.
- Recurring-instance generation is the one piece of this epic that is *not* a DB trigger: since there's no client write to react to (it's purely time-based), it runs as a scheduled Supabase Edge Function per AD-3. The exact scheduling mechanism (`pg_cron` vs. Edge Function cron) is an implementation detail left open by the architecture spine — pick one and document it in the migration/function, don't treat it as pre-decided.
- Derived-state consumers (Epic 4's streaks/badges) will later read Done/Reviewed via DB triggers reacting to `homework_status_history` writes, per AD-3 — this epic does not implement that trigger, but must ensure a distinct `(student_id, homework_instance_id)` pair reaching Done is unambiguous in the schema (a student's self-mark and a teacher's on-behalf-of mark for the same instance must resolve to one logical "Done," not double-count later).
- Class scoping resolves through the existing `is_admin()` / `is_teacher_of_class(class_id)` helper functions and `profiles.class_id`/`profiles.status = 'approved'` — established in Stories 1-1/1-2/2-1 — never a new per-feature check. Follow the exact pattern in `supabase/migrations/0003_roster_skill_tracking.sql`: denormalize `class_id` onto `homework_assignments` (and transitively onto instances/history via join or a denormalized copy, consistent with how `skill_status_history`/`attendance_records` each carry their own `class_id` rather than requiring a join through `profiles`), and require inserts to check `is_teacher_of_class(class_id)` plus an `exists()` check that the target student is `role = 'student' and status = 'approved'` in that same class.
- Relevant existing schema (from `supabase/migrations/0001_init.sql` and `0002_student_registration.sql`, do not assume beyond this): `profiles(id uuid pk, email, display_name, role user_role[admin|teacher|student], status registration_status[pending|approved|rejected] nullable, class_id uuid fk->classes nullable, team_id uuid fk->teams nullable, registration_name, guardian_consent_given_at, created_at)`; `classes(id uuid pk, name, code unique, created_by, created_at)`; `class_teachers(class_id, teacher_id, assigned_at)` many-to-many; helper functions `public.is_admin()` and `public.is_teacher_of_class(target_class_id uuid)` (both `SECURITY DEFINER`, safe to reuse inside new RLS policies); `app_settings(key text pk, value jsonb, description, updated_at)` — the look-ahead-window value belongs here, following the same pattern the architecture spine names for the streak grace period and badge milestone step.
- Conventions carried over unchanged: `snake_case` DB tables/columns, kebab-case routes, `PascalCase` Svelte components, UUID PKs, `timestamptz` UTC timestamps, ISO 8601 dates, all admin-tunable values in `app_settings` rather than hardcoded.

## UX & Interaction Patterns

- No screen design exists yet for homework creation, the student Done-list, or the teacher review view — the UX spine only covers Epic 1's account/registration flows. Build functional-first (list view, mark-done toggle, review toggle) and flag any real design decision needed rather than inventing one, per the story's own instructions.
- Extend the established visual system where it already gives applicable patterns: bold/editorial, zero border-radius, flat hairline-divided surfaces, one accent color (Signal Blue) per screen for the single primary action, huge all-caps display type for headings only, small tracked-uppercase captions for labels/status.
- The existing data-table/stacked-row pattern (desktop dark-header table vs. phone stacked hairline rows, same dataset) should extend naturally to both the teacher's per-assignment student-status list and the student's homework list.
- Status chip pattern (solid blue "approved"-style fill vs. muted gray) is a reasonable base to extend for Done/Reviewed/Overdue states, but confirm colors before building — amber is reserved for "waiting on a person" and red for field-validation only, so an "Overdue" flag should not default to either without a real design decision.
- Terse, instructive microcopy, no exclamation points or emoji; an empty homework list should describe the student's actual situation, not project-roadmap language.

## Cross-Story Dependencies

- Story 3-2 extends Story 3-1's data model directly — it must not special-case recurring instances in a way that breaks 3-1's Done/Reviewed reads, and editing or ending a recurring series must never touch past instances.
- Depends on Story 1-1/1-2 for `profiles`/`class_teachers`/`classes` and the approved-student gating pattern, and follows the RLS/append-only conventions Story 2-1 established for `attendance_records`/`skill_status_history` (same helper functions, same class-scoping shape).
- Homework Done data this epic records is a direct input to Story 4-1 (streaks require both attendance and homework Done per week) and Reviewed data feeds skill-status history — this epic must get the state model right since later epics read it, but does not itself implement streak/badge computation.
