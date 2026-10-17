---
title: 'Calendar student and parent queries in one batch'
type: 'refactor'
created: '2026-10-17'
status: 'done'
baseline_commit: 'ca73ef4745bd8f123bde831ccf0451c9544a111e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/latency-findings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After its first batch (days, sessions, classes), the calendar load waits on more queries in a row. A student waits on one more (the leave answers, which need the session ids). A parent waits on three more (`linked_children`, then `class_enrollments`, then `session_leave_history`), about 250–450 ms (SPEC CAP-4, #104h).

**Approach:** Start every query the student or parent view needs in the same concurrent batch as days and sessions. Filter them by what is known up front (the caller's id and the month) instead of by ids from an earlier read, then join the results in code. A student or parent then makes no more serial round trips than an admin or teacher, and sees identical data.

## Boundaries & Constraints

**Always:**
- Identical returned data for every role and every `?child=` value: `children`, `selectedChild`, the session rows shown, `childAnswers`, `leaveAnswers`, and the `loadError` semantics.
- Only approved children count, as today: `linked_children()` filters `status`. Pending children's classes never show.
- A teacher-parent or admin-parent with Parent active sees only their own children's data, even where RLS would return more rows. Filter in code by the children in view.
- The leave answer is still the newest row per (session, student): `answered_at desc, id desc`.
- Reads stay bounded by the month, so no row-cap risk is added.

**Never:**
- No migration, RPC or view change.
- No change to the admin and teacher path, or to the calendar actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student | student with answers this month | Same `leaveAnswers`; one batch after Auth | A failed answers read sets `loadError`, as today |
| Parent, all children | parent with 2 approved children | Same `children`, rows and `childAnswers`; one batch after Auth | Any failed read sets `loadError`, as today |
| Parent, `?child=` | names one approved child | Only that child's classes and answers | N/A |
| Parent, pending child only | only a pending child | No sessions, `children` empty, as today | N/A |
| Teacher-parent, Parent active | also teaches other students' classes | Only own children's sessions and answers | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/calendar/+page.server.ts:77-99` -- the first batch. Add the student and parent reads here, gated by `role`.
- `:110-117`, `loadParentView :192-274` -- the parent branch: `rpc('linked_children')` → `class_enrollments .in('student_id', inView)` → `session_leave_history .in(student_id).in(class_session_id)`. Keep the shaping logic (`childrenByClass`, `current`, `childAnswers`) and feed it from the batch.
- `:119-137` -- the student branch: `session_leave_history .eq('student_id', user.id).in('class_session_id', monthSessionIds)`.
- `linked_children()` (migration 0024:293) is `profiles where parent_id = auth.uid() and role = 'student' and status in (pending, approved)`, guarded by `is_parent()`.
- RLS: `profiles_select_parent_of_child` (0025:139) lets a parent read their children's profiles, so an embedded `profiles!inner(parent_id)` filter works for a parent. `session_leave_history` FKs: `class_session_id → class_sessions`, `student_id` and `answered_by → profiles` (two paths, so name the FK). `class_enrollments.student_id → profiles` (also `enrolled_by`, so name the FK). `class_sessions.class_day_id → class_days`.
- `src/routes/calendar/page.server.spec.ts` -- existing mocks: `safeGetSession`, `parent`, and `supabase.from` / `rpc`. Extend them for the matrix and for the round count.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/calendar/+page.server.ts` -- Move the student and parent reads into the first batch with up-front filters; keep the shaping. -- Saves one serial round for students, three for parents.
- [x] `src/routes/calendar/page.server.spec.ts` -- Tests for the five matrix rows, plus a round-count test showing parent and student reads start in the first batch. -- Locks in the data and the parallelism.

**Acceptance Criteria:**
- Given a parent or a student, when the calendar loads, then every query starts before any of them resolves (after `safeGetSession` and `parent()`).
- Given the full suite after `supabase db reset`, when `npm run test` runs, then the existing calendar tests pass, including the RLS calendar specs.

## Design Notes

A filter that needs no earlier ids, for example:

- Parent enrollments: `class_enrollments.select('class_id, student_id, student:profiles!class_enrollments_student_id_fkey!inner(parent_id)').eq('student.parent_id', user.id)`
- Leave answers by month: embed `class_sessions!inner(class_days!inner(day))` and filter `class_sessions.class_days.day` between `first` and `last`. Students also filter by `student_id`, parents by the embedded `parent_id`.

Then intersect in code with the approved children in view from `linked_children`. Check the FK names against the migrations. If an embedded filter cannot express this, stop and report rather than adding a migration.

## Implementation Notes

- The design-note filters worked as written; no migration was needed. The FK names (`class_enrollments_student_id_fkey`, `session_leave_history_student_id_fkey`) match `database.types.ts`, and `npm run check` accepts the dotted embedded filters.
- `loadParentView` is split into `readParentView` (three reads, started inside the first `Promise.all`) and `shapeParentView` (the old shaping logic, unchanged, run on the results). In code, answers are also limited to the children in view and to the sessions shown.
- `loadError` works as it did when the reads ran one after another: a failed enrollments read counts only when a child is in view, and a failed answers read only when a session is shown. The same goes for the student answers read when the month has no sessions.
- Checked on the real local DB with a throwaway test, since removed: an approved parent with two children in two classes, plus one pending child, and a signed-in student. Both loads ran with no `loadError`, and the newest answer won. `?child=` narrowed the result to one session.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | The embedded-filter reads (nested `class_sessions.class_days.day`, FK-hinted `profiles!…!inner(parent_id)`) are tested only against a fake that ignores filters; the real-DB check was a deleted throwaway (blind + verification-gap) | medium | Verification-gap, pre-verified: no spec or e2e runs these shapes. A wrong path, FK hint or RLS-hidden embed would drop answers with every test green | patch |
| 2 | Parent error rules are untested: a failed enrollments read with only a pending child, a failed answers read with no shown sessions, a failed `linked_children` (blind + verification-gap) | medium | Verification-gap, pre-verified: existing parent failure tests cover only the "is an error" side | patch |
| 3 | No test locks that admin and teacher loads still start only the original three reads | low | Real gap for the "no change to the admin and teacher path" rule; a cheap test | patch |
| 4 | Comments describe the old serial code ("as when the read followed the sessions") | low | Real; a direct wording correction | patch |
| 5 | The answers history read is bounded by month and children, not by shown sessions, so `max_rows` truncation is closer (edge) | low | Real but far off: a few rows per session per child, so a parent with 3 children is ~100 rows a month. Fix adds a count check | reject |
| 6 | `?child=` still reads all the caller's children's rows | low | Rows stay small (see #5); narrowing adds a branch. The code checks approval anyway | reject |
| 7 | Tests never assert the select strings, so a dropped `!inner` goes unseen | low | That only widens rows (data stays correct through the code filters); #1's real-DB test checks the paths and hints | reject |
| 8 | The fixture always signs in with `profile.role: 'teacher'` | false | The load reads `activeRole ?? profile.role`, and every case sets `activeRole`, so the profile role never decides the view | reject |
| 9 | Reads now run that can't affect the result (no child, no sessions) | low | A deliberate trade-off: they run concurrently, so they add no latency | reject |
| 10 | The fake records RPC and table starts at different points | low | Test-infra nuance; the round tests still hold every reply until the gate opens | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm run test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0

**Manual checks:**
- After deploy, a parent's `/calendar/__data.json` server wait is about the same as an admin's.
