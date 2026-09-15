---
title: 'One-off Homework Assignment & Review'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '4648b812814ad7ddb67ec2d0425bfa1699b73669'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Teachers have no way to assign homework or track whether students did it — progress on skills learned in class has no continuation at home, and neither streaks (Epic 4) nor skill-status history (Epic 2) has real Done/Reviewed data to build on.

**Approach:** A teacher creates a one-off homework assignment (title, skill area, target students — whole class or a subset, due date, optional reference link) scoped to their class. A targeted student self-marks Done (a teacher may also mark it on a student's behalf); a teacher separately marks Reviewed after confirming in class. Overdue items never auto-expire — they stay visible until a teacher explicitly archives them.

## Boundaries & Constraints

**Always:** Authorization enforced entirely in RLS reusing `is_admin()`/`is_teacher_of_class(class_id)` and the approved-student `exists()` pattern from Story 2-1 — never a new per-feature check. Every Done/Reviewed transition is an append-only insert into `homework_status_history`, never an update — matching AD-5 and Story 2-1's precedent exactly. `Done` and `Reviewed` are independently readable statuses, never conflated: `Done` alone feeds streaks (Epic 4), `Reviewed` alone feeds skill-status history (Epic 2). Every write records who performed it (`recorded_by`, distinct from the student the row is about) — matching the `recorded_by` convention already established on `attendance_records`/`skill_status_history`. A student can only self-mark Done if a prior `assigned` row already targets them for that instance — untargeted students cannot self-mark. Overdue items are computed at read time (`due_date < today AND not done`), never a stored/auto-set flag.

**Never:** Do not build recurring assignments (Story 3-2) — `homework_assignments.recurrence_rule` exists as a nullable column reserved for that story, but this story only ever inserts `NULL`. Do not build the streak/badge computation that reads this data (Epic 4). Do not validate the reference link's URL format — epic context explicitly settles this: teachers are already admin-verified, so no link validation is required. Do not design new visual patterns beyond extending the existing data-table/status-chip system — flag any real UX decision needed instead of inventing one.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teacher creates assignment | Title, skill area, due date, target = whole class | One `homework_instances` row + one `assigned` `homework_status_history` row per approved student in the class | N/A |
| Teacher creates assignment for a subset | Same, target = specific student ids | `assigned` rows only for the selected students | N/A |
| Student marks Done | Student targeted (has an `assigned` row), not yet Done | New `done` row inserted; prior rows remain as history | N/A |
| Untargeted student attempts Done | Student has no `assigned` row for that instance | RLS rejects the insert | N/A |
| Teacher marks Done on a student's behalf | Teacher assigned to the class | Same as student self-mark; `recorded_by` shows the teacher, not the student | N/A |
| Teacher marks Reviewed | Student already Done | New `reviewed` row inserted; does not affect Done's own history | N/A |
| Overdue, unarchived item | Past due date, student still only `assigned` | Stays visible, flagged overdue, never auto-hidden | N/A |
| Non-assigned teacher attempts any write | Direct API call, not assigned to that class | RLS returns/affects zero rows regardless of frontend state | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0004_homework.sql` (new) -- `homework_assignments(id, class_id, title, skill_area, reference_link text nullable, recurrence_rule jsonb nullable [always NULL this story], created_by, created_at)`; `homework_instances(id, assignment_id, class_id, period_start date, due_date date, archived_at, archived_by)` with `UNIQUE(assignment_id, period_start)` per AD-8; `homework_status_history(id, instance_id, student_id, class_id, status text check in ('assigned','done','reviewed'), recorded_by, recorded_at)`. RLS: SELECT/INSERT on all three reusing `is_admin()`/`is_teacher_of_class(class_id)`; `homework_status_history` INSERT additionally requires an `assigned` row already exists for `(instance_id, student_id)` before a `done`/`reviewed` row is allowed (except the `assigned` row itself, inserted at creation time by the teacher); no UPDATE/DELETE policy on `homework_status_history` (append-only by absence, matching Story 2-1).
- `src/routes/teacher/classes/[id]/+page.server.ts:34-66` -- load pattern to mirror (RLS-gated fetch, 404-on-empty, approved-student scoping).
- `src/routes/teacher/classes/[id]/+page.server.ts:174-211` (`markAttendance`) -- per-row-insert-not-batch idiom to reuse for creating N `assigned` rows per targeted student, so one bad row doesn't block the rest.
- `src/routes/teacher/classes/[id]/homework/+page.server.ts`, `+page.svelte` (new) -- assignment creation form + per-assignment student-status list (Done/Reviewed counts, quick review toggle per student), extending the existing data-table pattern.
- `src/routes/student/+page.server.ts`, `+page.svelte` (new) -- student's own open-homework list (current + next look-ahead period only), mark-done action. No student-facing route exists yet; `src/routes/+page.svelte`'s role-switch currently has only a generic fallback for `role='student'`.
- `src/lib/server/rls.spec.ts` -- new "Story 3-1" describe block following the established fixture shape (`createSignedInUser`, `createStudent`, `anonClient()`); add a `createHomeworkAssignment`/`createHomeworkInstance` local helper analogous to `createStudent`. Cover every I/O matrix row plus append-only/no-UPDATE-DELETE on `homework_status_history`.
- `messages/{en,de,bo}.json` -- new keys following the `<route>_<element>_<purpose>` convention.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0004_homework.sql` -- schema + RLS per Code Map
- [x] `src/routes/teacher/classes/[id]/homework/**` -- create assignment + per-assignment student-status view
- [x] `src/routes/student/**` -- open-homework list + mark-done action
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- cover every I/O matrix row plus append-only assertion

**Acceptance Criteria:**
- Given a whole-class assignment, when the teacher views its status list, then every approved student in the class shows at least an `assigned` state, and Done/Reviewed counts reflect only students who have progressed further.
- Given a student marks Done and a teacher later marks Reviewed, then both statuses remain independently queryable — reading "is this Done" never depends on whether it's also Reviewed, and vice versa.
- Given an overdue, not-yet-Done assignment, when a teacher views their class's homework, then it remains visible and flagged overdue until they explicitly archive it — never silently disappearing.

## Implementation Notes

_(Forward note for Story 3-2, not this story's concern: recurring-instance generation must create fresh `assigned` rows from the *then-current* class roster for each new instance — a student added mid-series must not retroactively receive `assigned` rows for instances generated before they joined, and existing instances must never be touched.)_

## Spec Change Log

None yet.

## Review Triage Log

Reviewed via `bmad-build` step-04 (blind-hunter, edge-case-hunter, verification-gap layers) against a real git diff (`git diff 4648b812814ad7ddb67ec2d0425bfa1699b73669` plus untracked new files).

| # | Verdict | Route | Finding & evidence |
|---|---------|-------|---------------------|
| 1 | high | patch | `homework_status_history`'s INSERT policy never checks that the submitted `class_id` actually matches the referenced `instance_id`'s real class — a teacher can submit their own (legitimately-taught) `class_id` alongside an `instance_id`/`student_id` from a *different* class and the insert succeeds, letting them write Done/Reviewed history for a class they don't teach. Independently confirmed and fully demonstrated by all three review layers (blind-hunter, verification-gap with exact repro steps, edge-case-hunter). The two teacher route actions (`markDone`/`markReviewed`) compound this by trusting `params.id` as `class_id` instead of re-deriving it from the instance, unlike the student-side `markDone` which already does this correctly. |
| 2 | medium | patch | The `homework_status_history` INSERT policy allows a `reviewed` row with only a prior `assigned` row — no requirement that a `done` row exists first. The Intent's own described workflow ("student self-marks Done... teacher separately marks Reviewed after confirming [it] in class") implies Reviewed always follows Done; the DB doesn't enforce that ordering. Confirmed by direct migration read. |
| 3 | medium | patch | `createAssignment` has no rollback on partial failure: if the `homework_instances` insert fails after `homework_assignments` succeeded, or every per-student `assigned` insert fails, the orphaned row(s) persist and render as a broken entry in the teacher's list. Confirmed independently by blind-hunter and edge-case-hunter. |
| 4 | medium | patch | `homework_created_partial`'s message only reports a failure *count*, never which students failed, despite its own copy promising "try again for them" — there's no way to actually identify or retry the failed students. Confirmed by blind-hunter; edge-case-hunter separately flagged the same underlying gap against Acceptance Criterion 1 ("every approved student... shows at least an assigned state"). |
| 5 | medium | patch | The two new `SECURITY DEFINER` helper functions (`is_targeted_for_homework_instance`, `is_targeted_for_homework_assignment`) — the student-visibility mechanism for `homework_assignments`/`homework_instances` — have no test where a signed-in student selects directly from those tables and gets the correct targeted/untargeted result. Confirmed by blind-hunter. |
| 6 | low | patch | A malformed `targetMode` (neither `'all'` nor `'subset'`) silently falls through to whole-class targeting instead of being rejected. Confirmed by edge-case-hunter. |
| 7 | low | patch | The "Create assignment" form has no submit-guard — a double-click or retried request can create duplicate assignments/instances/status rows. Confirmed by blind-hunter. |
| 8 | low | patch | Per-student "Mark done"/"Mark reviewed" buttons have no accessible name distinguishing which student they act on — a screen-reader user tabbing through repeated controls can't tell them apart. Confirmed by blind-hunter. |
| 9 | low | patch | `homework_lookahead_days`'s actual filtering behavior (an item beyond the window is excluded, one within it isn't) has no end-to-end test, despite the epic context explicitly calling out this value as one that "must be configurable... not hardcoded." Confirmed by blind-hunter. |
| 10 | medium | defer | `homework_instances_update_admin_or_assigned_teacher` grants an unrestricted UPDATE (any column, not just `archived_at`/`archived_by`) to any admin/assigned teacher — the migration's own comment claims the app only ever writes archive columns "through this policy," but nothing enforces that at the DB level; a direct call could rewrite `due_date`/`period_start`, undermining AD-8's uniqueness guarantee. Not tied to a demonstrated regression in this story's own scope (archiving itself works and is tested), but flagged by the verification-gap layer as worth tightening before Story 3-2 builds recurring-instance editing on top of this same table. |
| — | false | reject | `messages/bo.json`'s new keys are English placeholders, not real Tibetan — matches the exact, already-documented project convention; not a new or undocumented gap. |
| — | low | reject | Due dates render as raw ISO `YYYY-MM-DD` with no locale-aware formatting — consistent with this codebase's existing (unaddressed elsewhere too) convention, and within this story's own explicit "keep the first pass functional rather than polished" scope allowance. |
| — | false | reject | `isValidDate` allows a due date already in the past — not a bug: mirrors Story 2-1's own precedent of allowing a backdated `session_date` for legitimate catch-up scenarios ("here's homework from last week, do it now" is a valid use, and it would correctly show as immediately overdue). |
| — | low | reject | A `done`/`reviewed` row can still be inserted after an instance's `archived_at` is set — genuinely ambiguous whether archiving is meant to freeze activity or only stop overdue-flagging/visibility; neither reading is specified by the spec, and the practical impact (someone still marking progress on an assignment a teacher chose to archive) is low. |

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including new live-Supabase RLS cases (requires `npm run supabase:start` first)
