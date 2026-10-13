---
title: '#102 Attendance: saved marks are shown and a correction counts'
type: 'bugfix'
created: '2026-10-13'
status: 'done'
route: 'dispatch'
baseline_commit: 'aa5e513bfc593f80b73dc77aa1544b2ed1bff67a'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the teacher's class page the attendance form is always blank, even for a session that is already marked, and the picker does not show which sessions are marked. Saving an old session again adds an "absent" row for every unticked student. A correction also does not count: streaks and badges use any "present" row ever saved, and a re-marked session shows twice for the teacher and the parent. Reported by the user on 2026-10-13: "we need to fix that".

**Approach:** The form shows every student's current mark for the picked session and the picker shows which sessions are marked. The latest mark per student and session is the one that counts everywhere: streaks, badges, the teacher's history and the parent's list (AD-5).

## Boundaries & Constraints

**Always:** Marks stay append-only (AD-5): a correction is a new row, no row is updated or deleted. "Latest" has one definition, used by every reader. The latest mark wins for marks saved before this change too (decided by the user, 2026-10-13). The insert policy and the session checks in `markAttendance` stay as they are. A save writes only what the teacher changed (decided by the user after review, 2026-10-13): when no roster student has a mark for the session, a row for every roster student; otherwise a row only for each student whose tick differs from what the form showed when it opened, where a student without a mark counts as unticked. Earned badges are never removed. New texts exist in en, de and bo.

**Never:** No change to leave answers, sick decisions, the picker's range (60 sessions, today or earlier), or the attendance redesign deferred from epic 6 (buttons instead of checkboxes). No push to the hosted database by the assistant. `database.types.ts` is edited by hand, never regenerated.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unmarked session | Session with no marks is picked | Every checkbox unticked; no "marked" note in the picker | N/A |
| Marked session | A present, B absent | A ticked, B unticked; picker shows the session as marked | N/A |
| Corrected to absent | A marked present, later absent | A unticked; that day no longer counts for A's streak or badge count; history and parent list show one line, Absent | N/A |
| Corrected to present | A marked absent, later present | A ticked; the day counts; one line, Present | N/A |
| Badge already earned | A's count falls below an earned milestone | The badge stays | N/A |
| Partly marked | C enrolled after the session was marked | C unticked; session still shown as marked; a save that leaves C unticked writes no row for C | N/A |
| Unchanged re-save | Marked session saved with no tick changed | No row is written; the usual success toast | N/A |
| Stale form | The form was opened before another teacher corrected A; this teacher changes only B and saves | Only B's row is written; A's correction stands | N/A |
| Switch session | Teacher ticks, then picks another session | Checkboxes show the picked session's marks; unsaved ticks are dropped | N/A |
| After save | Save succeeds | Same session stays picked and shows what was saved | Partial failure keeps today's toast |
| Marks can't be read | The read of current marks fails | Today's load-error notice; the form is blank and the Save button is disabled (decided by the user after review, 2026-10-13) | Existing `loadError` path; the action is not reachable from the page |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/classes/[id]/+page.server.ts` -- `load`: `markableSessions` (l.85), `leaveAnswers` keyed `${sessionId}:${studentId}` and paged by `LEAVE_PAGE_SIZE` (l.97–126), reuse both; attendance read from `attendance_records` without `class_session_id` (l.153). `markAttendance` (l.284) is not changed.
- `src/routes/teacher/classes/[id]/+page.svelte` -- `selectedSessionId`, `sessionSelectKey`, `leaveFor()` (l.56–81); form l.262–312; `ix-checkbox` l.292 has no `checked`; `sessionLabel()`; history list l.439–451.
- `src/routes/admin/teachers/+page.svelte` l.175 -- the `checked={… || undefined}` idiom; `ix-checkbox` has no form reset, so a changed state needs a remount (`{#key}`).
- `supabase/migrations/0003_roster_skill_tracking.sql` -- `attendance_records` (uuid `id`, `recorded_at`), select policy for admin and the class's teachers.
- `supabase/migrations/0021_attendance_per_session.sql` l.618 -- current `recompute_student_badges`; `recompute_streaks_for_sessions` (reuse for the one-time recompute).
- `supabase/migrations/0028_sick_leave_decisions.sql` l.420 -- current `compute_student_streak`; only `attendance_weeks` reads `present`. The `exists (… attendance_records …)` tests for "session has a mark" stay.
- `supabase/migrations/0036_localized_names.sql` l.213 -- current `child_attendance`.
- `src/lib/supabase/database.types.ts` -- hand-maintained; `Views` l.1236.
- Tests: `src/routes/teacher/classes/[id]/page.server.spec.ts` (fake client), `src/lib/server/rls.spec.ts` (l.1533 attendance, l.9537 `child_attendance`, helper `sessionFor`), `e2e/teacher.e2e.ts` l.261.
- `messages/{en,de,bo}.json` -- `roster_attendance_*` (en l.222).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0045_attendance_current.sql` -- view `attendance_current` (latest row per `class_session_id`, `student_id`; `security_invoker`); redefine `compute_student_streak`, `recompute_student_badges` and `child_attendance` to read it; recompute the streak of every student who has a session with more than one mark -- one place for the rule, and old corrections take effect.
- [x] `src/lib/supabase/database.types.ts` -- add the view by hand.
- [x] `src/routes/teacher/classes/[id]/+page.server.ts` -- read `attendance_current` for the class, paged; return the history from it and `currentMarks` keyed `${sessionId}:${studentId}`; a failed read sets the load error.
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- tick each checkbox from `currentMarks`, remount the list when the session or the data changes, add a "marked" note to the picker label.
- [x] `messages/en.json`, `messages/de.json`, `messages/bo.json` -- the "marked" note.
- [x] `src/routes/teacher/classes/[id]/page.server.spec.ts` -- load tests for the form rows of the matrix.
- [x] `src/lib/server/rls.spec.ts` -- the view under RLS (other teacher and student read nothing), latest wins, streak and badge count after both corrections, earned badge stays, `child_attendance` one row per session.
- [x] `e2e/teacher.e2e.ts` -- a marked session opens ticked; re-saving it unchanged changes no current mark; a correction shows one history line.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the two entries this closes (6-2 blank picker, 7-3 `child_attendance`).

**Execution, after review pass 1:**
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- post each student's loaded mark with the form; disable Save when the marks could not be read.
- [x] `src/routes/teacher/classes/[id]/+page.server.ts` -- `markAttendance` writes only changed marks (rule in Boundaries); nothing to write is a success; the load says whether the marks were read; skip a mark `id` already seen across pages.
- [x] `supabase/migrations/0045_attendance_current.sql` -- the final proof tolerates marks saved while it runs (a lock is not possible, see Implementation Notes); after the recompute, abort if a recomputed student's stored streak differs from `compute_student_streak`.
- [x] `src/routes/teacher/classes/[id]/page.server.spec.ts` -- action tests for the three new matrix rows; a load where page two fails; the three `order` calls of the read.
- [x] `src/lib/server/rls.spec.ts` -- a correction to absent in a week with planned leave makes the week protected.
- [x] `e2e/teacher.e2e.ts` -- unsaved ticks survive a skill save; the picker shows "marked" after an in-page save of an unmarked session; a stale form does not undo another correction.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- entries for `recorded_at` stamping (AD-5), an index for the view, and a migration test on existing data.

**Acceptance Criteria:**
- Given a session marked last week, when the teacher picks it, then the checkboxes match the saved marks and the picker shows it as marked.
- Given a marked session, when the teacher unticks one student and saves, then that student's current mark is absent and every other student's is unchanged.
- Given a student present only on one day of a week, when that mark is corrected to absent, then the week no longer qualifies for the streak.
- Given the migration on a database with re-marked sessions, when it finishes, then no `attendance_records` row is changed.

## Implementation Notes

- Built by a subagent from this spec on 2026-10-13; the diff was read and the checks re-run by the orchestrating session.
- `attendance_current` is `distinct on (class_id, class_session_id, student_id)`: `class_id` is in the key only so a class filter reaches the table before rows are reduced. A session has one class (composite foreign key), so the result is per session and student.
- The load also returns `markedSessionIds`. The read is not filtered by roster, so a session marked only for students who have left still shows as marked; only roster students go into `currentMarks` and the history.
- Checkboxes are set through `ixValue(…, 'checked')` instead of the `checked={… || undefined}` idiom in the Code Map: the attribute would be re-applied on any data reload (for example a skill save) and wipe unsaved ticks.
- The session picker is remounted, keeping the picked session, when the set of marked sessions changes, so its labels are current.
- The three redefined functions differ from their 0028 / 0021 / 0036 bodies only in reading `attendance_current` (checked line by line).
- The migration snapshots `attendance_records` and aborts if any row differs at the end. Badges are not recomputed in it: the latest-wins rule can only lower a count, and earned badges stay.
- The teacher's attendance history is now ordered by session date, newest first (before: by `recorded_at`).
- Known: a tick made between the save response and the list's remount is dropped. No index was added for the view.
- After review pass 1 (same day): `markAttendance` reads a posted `loaded_<studentId>` per student and writes only changed marks; "whole save failed" compares failures with the rows attempted. The load returns `attendanceError`, and Save is disabled when it is set. The list's remount key uses the three-state loaded mark, so the posted value always matches the data on screen; a reload in which another teacher marked this session remounts the list and drops unsaved ticks.
- Migration, after review: it aborts if a student of an affected session has no `student_streaks` row or a stored streak different from `compute_student_streak`. A table lock asked for in review (E5) was removed again: the migration runner opens no transaction, so `lock table` fails (SQLSTATE 25P01). Instead the final proof checks only that every mark of the snapshot is still there unchanged, so a mark saved while the migration runs does not abort it. Because there is no transaction, a failed proof stops the migration but does not undo the view and function changes already applied. `recompute_student_streak` (0021) always stores a row, so the check cannot fail for a student it reached.
- The review fixes were applied on top of the first build, not by a revert and rebuild (user's choice). The patched code was read by the orchestrating session and not sent through a second review pass.

## Spec Change Log

- 2026-10-13, review pass 1. Trigger: findings B1/E2 (a save writes every roster student, so with latest-wins a stale or blank form removes credit) and B2 (a failed read leaves a blank, saveable form). Amended with the user's answers: the "Always" rule on what a save writes, the matrix rows "Partly marked" and "Marks can't be read", two new rows ("Unchanged re-save", "Stale form"), the Design Notes, and a second task list. Known-bad state avoided: the last save winning for students the teacher never touched. Applied as patches to the existing build instead of a revert and rebuild, on the user's choice. KEEP: the `attendance_current` view as the one definition of "latest"; the three function bodies changed only in their read source; the paged load with `currentMarks` and `markedSessionIds`; `ixValue(…, 'checked')` with the keyed remount; the migration's snapshot proof.

## Review Triage Log

Pass 1 (2026-10-13). Layers: blind (B), edge-case (E), verification-gap (G).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 | A stale or blank form now takes credit away: `markAttendance` writes a row for every roster student and the latest row decides | high | `+page.server.ts` `markAttendance` inserts `present` for every `studentIds` entry from the posted form; before 0045 a later "absent" never removed credit | intent_gap / bad_spec (with E2) |
| E2 | Form loaded before another teacher's correction overwrites it on save | high | Same defect as B1 | with B1 |
| B2 | When marks can't be read the form is blank and saveable; one save sets the class absent | high | The load clears `currentMarks`; the Save button is disabled only when there is no markable session. The frozen matrix row asks for exactly this | intent_gap |
| B3 | A partial save remounts the list and drops the failed students' ticks | medium | The effect increments `attendanceSaves` on any success, also with `failedStudentIds`; the toast names them. Harmless once only changed marks are written | with B1 |
| B4 | The remount effect can re-run without a new save | low | Only in the partial-failure branch (reads `data.students`); SvelteKit applies the invalidated data before the form result, so no second run was shown. Rejected: unlikely, fix adds state | reject |
| B5 | Paging stops on a short page; a hosted `max_rows` under 1000 truncates silently | maybe-false | Hosted Supabase defaults to 1000, the same assumption as the existing leave paging; settle by reading the hosted API setting. Low once only changed marks are written | reject |
| B6 | Pages are separate requests; a row can repeat or be skipped | low | A first mark for a newer session shifts offsets; needs over 1000 current marks and a concurrent save. A repeated `id` breaks the keyed history list | patch (with E1) |
| E1 | Same as B6 | low | Same defect | patch |
| B7 | `recorded_at` can be set by the caller; ties fall to a random uuid | medium | 0003 gives the column a default only and no trigger stamps it, against AD-5. Pre-existing; only the class's teachers and the admin can insert | defer (with E6) |
| E6 | Same as B7 | medium | Same defect | defer |
| B8 | The migration's proof checks only `attendance_records`; a failed recompute is a warning | medium | `recompute_streaks_for_sessions` (0021) isolates each failure; nothing compares stored streaks afterwards | patch (with E7) |
| E7 | Same as B8 | medium | Same defect | patch |
| B9 | The pre-push query gives a count, not a list of students | low | True; the user asked for a count. Rejected: not a defect | reject |
| B10 | No index supports the view; known items are not in `deferred-work.md` | low | No index on `(class_id, class_session_id, student_id, recorded_at)`; school scale | defer |
| B11 | The #102 entry in `manual-verification-issues.md` still says "not built" | low | True, written before the build | patch |
| B12 | Two sessions on one day show as two lines with the same date; a student enrolled later is written absent on a re-save | low / medium | The first is display only and pre-existing. The second is real and falls under B1 | reject / with B1 |
| B13a | No e2e shows unsaved ticks surviving a skill save | medium | Filed with G3 | patch |
| B13b | Page-two failure and the read's order are not asserted | medium | Filed with G1, G2 | patch |
| B13c | "Nobody writes through the view" asserts empty data only | false | A `distinct on` view is not updatable in Postgres; no write path exists to assert | reject |
| B13d | No test for a correction to absent in a week with planned leave or approved Sick | medium | `protected_weeks` excludes weeks in `attendance_weeks`, which now follows the current mark; the interaction has no test | patch |
| B13e | The e2e's "not marked yet" step depends on test order | low | The earlier serial test marks `days[0]` for student 0 only. Rejected: not shown to fail | reject |
| E3 | A roster change remounts the list and drops unsaved ticks | low | `marksKey` includes every roster student. Rejected: rare, and visible to the teacher | reject |
| E4 | A tick made between the reload and the form result is dropped | low | Known and recorded in Implementation Notes. Rejected: sub-second window | reject |
| E5 | A save during the migration makes the proof abort it | low | The snapshot is taken without a lock; the abort is loud and a re-run fixes it. One-line fix | patch |
| G1 | The partial-read cleanup is never exercised | medium | Pre-verified by the layer: the failing fake fails page one | patch |
| G2 | The order of the `attendance_current` read is not asserted | medium | Pre-verified: the fake ignores `.order()` | patch |
| G3 | "Unsaved ticks survive an unrelated reload" has no check | medium | Pre-verified | patch |
| G4 | The one-time recompute and the proof run only on an empty table in the tests | medium | Pre-verified; the implementer replayed the steps once by hand on 12 re-marked pairs | defer |
| G5 | The picker's "marked" label after an in-page save is not observed | medium | Pre-verified | patch |

## Design Notes

Decided by the assistant: "latest" is `recorded_at desc, id desc`; a student without a mark in a marked session is shown unticked. The form posts, per student, the mark it showed when it opened (present, absent or none); `markAttendance` compares the tick with that posted value, not with the database, so a stale form writes only what its teacher changed. The posted value is trusted: a teacher of the class may write any mark anyway. The badge trigger stays present-only: a correction to absent can only lower the count, and badges are never removed.

Before the push to hosted, the user can run a count of (session, student) pairs whose latest mark is absent while an earlier one is present; these are the marks that change meaning. The query goes in the migration's header comment.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/teacher.e2e.ts` -- expected: exit 0
