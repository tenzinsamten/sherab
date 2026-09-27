---
title: '7-3 Parent read access & child overview cards'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b07b3f845c5371e18113a655059f513f734a94ec'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An approved parent sees only their children's names on `/parent`, and the database gives parents no read access to any child data.

**Approach:**
- Grant approved parents read-only access to their approved children's data through RLS (AD-12).
- Add one shared `homework_counts(student_id)`.
- Turn `/parent` into one card per child: name, classes, Open and Overdue counts, with Overdue highlighted. A pending child shows only "Waiting for approval".
- The child detail page is a follow-up story (deferred).

## Boundaries & Constraints

**Always:**
- **Migration `0025_parent_reads.sql`:**
  - **Student-keyed SELECT policies** add `or public.is_parent_of(student_id)`:
    - `homework_status_history`, `skill_status_history`, `student_streaks`, `badges_earned`, `class_enrollments`;
    - `profiles` (`is_parent_of(id)`).
  - **New `is_parent_in_class(class_id)`:** true when the caller has an approved child enrolled in the class. Add it to the `classes` and `class_sessions` SELECT policies.
  - **Homework instances and assignments:** a parent sees one only when one of their approved children is targeted by it, mirroring `is_targeted_for_homework_*`. `is_parent_in_class` alone never grants it.
  - **Attendance:** parents never read `attendance_records` directly, because `notes` stays teacher-only. New `child_attendance(p_student_id)` checks self-or-parent and returns date, class and present only.
  - **`class_people(p_class_id)`:** a caller authorized only by `is_parent_in_class` gets the teachers only.
  - **`homework_counts(p_student_id)`:** the caller must be the student, their parent, a teacher of the student, or the admin. It returns `open_count` and `overdue_count`.
    - **Open:** assigned, not Done or Reviewed, instance not archived, student still enrolled in the class, and `due_date` ≤ today + `homework_lookahead_days` (the same rule as the student's To-do list, `isTodoVisible`).
    - **Overdue:** Open and `due_date` < today. "Today" is in Europe/Berlin.
  - New functions are security definer with `search_path = ''`, check the caller, and have explicit revokes and grants.
- **No writes:** parents get no INSERT, UPDATE or DELETE anywhere.
- **Student dashboard:** its To-do and Overdue tiles come from `homework_counts`, so they show the same numbers as today.
- **`/parent` cards** come from `linked_children()`, then for each approved child the classes (enrollments → classes) and `homework_counts`. There is no link yet, and every read uses an explicit student id.
- **Teacher UI:** the skill notes field in `teacher/classes/[id]` reads "Visible to the student's parent".
- **i18n:** every new or changed string exists in en, de and bo.

**Never:**
- **Out of scope:**
  - the child detail page (deferred);
  - leave answers (7-4);
  - sick leave (7-5);
  - 7-6;
  - the role switcher;
  - an admin per-student counts view.
- **Forbidden:**
  - showing parents `attendance_records.notes`, classmates' names, or another student's data;
  - matching on email text in RLS;
  - editing old migrations, or pushing to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cards | approved parent; approved child with 2 Open (1 overdue); pending child | approved card: classes, Open 2, Overdue 1 highlighted; pending card: name + "Waiting for approval" only | N/A |
| Counts | archived instance, left class, Done, Reviewed, due beyond lookahead | not Open, not Overdue | N/A |
| Student tiles | student dashboard | same To-do/Overdue numbers as before, via `homework_counts` | N/A |
| Own child reads | parent selects own approved child's rows in each student-keyed table, targeted homework, class, sessions | rows returned | N/A |
| Isolation | parent reads another student's rows, untargeted homework, `homework_counts`/`child_attendance` for another student | no rows / refused | RLS / 42501 |
| Pending child | parent reads their pending child's data | nothing (`is_parent_of` false) | N/A |
| Attendance | `child_attendance` for own child; direct `attendance_records` select | RPC rows without notes; direct select empty | N/A |
| class_people | parent for child's class | teachers only | N/A |
| No writes | parent inserts or updates homework status, skill, attendance, streak | refused | RLS error |
| Revoked | parent set to rejected | all of the above return nothing | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0024_parent_first_registration.sql:264-305` -- `is_parent_of`, `linked_children`: the helper pattern (`search_path=''`, revoke/grant).
- `supabase/migrations/0004_*.sql:135,153,193,214,257` -- `is_targeted_for_homework_instance/assignment` and the homework SELECT policies to extend.
- `supabase/migrations/0003_*.sql:105,129` -- skill and attendance SELECT policies (admin/teacher); `notes` columns at 0003:36,57.
- `supabase/migrations/0016_class_enrollments.sql:46,64,89,395,411` -- `is_enrolled_in_class`, `is_teacher_of_student`, and the enrollments/classes/streaks policies.
- Other policies and functions:
  - badges policy `0008_*.sql:249`;
  - `class_sessions` policy `0018_*.sql:134` (`class_days` is already open);
  - `class_people` `0017_*.sql:9`.
- `src/lib/server/student-homework.ts:107,124,187,225` -- `splitProgress`, `isTodoVisible` (the Open rule `homework_counts` must equal), `loadStudentClasses` (reuse with the child's id), `loadStudentHomework`.
- `src/lib/server/homework-status.ts:76` `isOverdue`.
- `src/routes/student/+page.server.ts:56-87` -- the tiles to switch; its spec pins the numbers.
- `src/routes/parent/+page.server.ts:16-42`, `+page.svelte:51-60` -- the current children list to turn into cards. Keep the layout guard (`+layout.server.ts:10-22`) and the non-approved states.
- `src/routes/teacher/classes/[id]/+page.svelte:212-216` -- notes input (placeholder `roster_notes_placeholder`, `messages/en.json:183`).
- `src/lib/server/rls.spec.ts` -- existing helpers to reuse:
  - `createApprovedParent` :510, `signUpStudent` :544, 7-2 block :7324;
  - homework :1742-1828, streak :3439-3521, badges :4294, calendar :5423-5443, attendance :6404-6438.
- `src/lib/supabase/database.types.ts` -- hand-add the new RPCs (don't regenerate).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0025_parent_reads.sql` -- helpers, policy changes, `child_attendance`, `homework_counts`, `class_people` parent branch.
- [x] `src/routes/student/+page.server.ts` (+ spec) -- tiles from `homework_counts`.
- [x] `src/routes/parent/+page.server.ts`, `+page.svelte` (+ spec) -- child cards.
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- notes field copy.
- [x] `src/lib/server/rls.spec.ts` -- `describe('7-3 parent reads')`, one test per matrix row. The Counts row must include an item due beyond the lookahead.
- [x] `messages/{en,de,bo}.json`, `src/lib/supabase/database.types.ts`.

**Acceptance Criteria:**
- Given an approved parent's child with Open homework, when a teacher marks it Done, then the card's Open count drops on the next load.
- Given a dual-role teacher-parent, when they open `/parent`, then they see only their own children, and their teacher reads are unchanged.
- Given a freshly reset local DB, when `npm test` and `npm run check` run, then all pass with 0 errors.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind, edge ×2 | "No writes" test is incomplete: streak insert uses a random student id (FK refusal, not RLS); no UPDATE on attendance/homework history/profiles; no DELETE attempts | medium | patch | Test at rls.spec 7-3 "No writes"; the spec's no-writes rule is unproven for those tables. |
| 2 | vgap | Rewritten `class_people` has no test for the enrolled-student (or admin) full roster | medium | patch | Only parent/teacher callers are tested; dropping `is_enrolled_in_class` from `v_full` passes the suite and breaks the #46 student class pages. |
| 3 | blind, edge, vgap-other | `homework_counts` admin branch and the refusal for an unrelated teacher are untested; comment claims the admin is checked | low | patch | Counts test asserts only `teacher.client`. |
| 4 | vgap | The dashboard's UTC→Berlin `today` change isn't pinned by a test | low | patch | Reverting to the UTC expression passes the spec; no fake timers. |
| 5 | blind | The "Visible to the student's parent" warning is only a placeholder: it vanishes once the teacher types, and it replaced the field's "Notes" name (also its aria-label) | medium | patch | `teacher/classes/[id]/+page.svelte:212-218`; `roster_notes_placeholder` now holds the warning. |
| 6 | blind, edge | `/parent` load logs a bare "classes query failed" with no child id; when both reads fail only one error is logged | low | patch | `parent/+page.server.ts:55`. |
| 7 | blind | Other student and teacher loaders still use the UTC date, so near Berlin midnight the dashboard tiles disagree with `/student/homework` overdue flags | low | defer | Pre-existing UTC usage; this story fixed only the dashboard. |
| 8 | blind, edge ×2, vgap-other | SQL and TS parse `homework_lookahead_days` differently (string/fraction/null) | false | reject | DB-only setting seeded as a JSON number in 0004:105; no code or UI writes it (0008:90 "DB-only configuration"). |
| 9 | edge ×2 | NULL `auth.uid()` makes the caller check NULL, so `homework_counts`/`child_attendance` don't raise | false | reject | EXECUTE is revoked from anon; an authenticated JWT always carries `sub`; service_role is trusted. |
| 10 | edge | `homework_counts` failure shows 0 tiles next to listed items | false | reject | `loadError` is set and the tiles render "—" (`student/+page.svelte:53`). |
| 11 | edge | Race: child revoked between `linked_children()` and `homework_counts()` shows a load error | low | reject | Rare admin action; the fix adds an error-code branch. |
| 12 | edge | `seedChildData` ignores upsert errors, so Isolation/Revoked could pass vacuously | low | reject | The same seed feeds "Own child reads", which asserts rows, so a failing seed is caught. |
| 13 | edge | `today` captured once in rls.spec can flake across Berlin midnight | low | reject | Test-only, needs a run across midnight; the fix adds per-test recomputation. |
| 14 | blind | Cards call `loadStudentClasses`, which reads `class_syllabi` parents can't see | low | reject | The cards don't use `hasSyllabus`; relevant only to the deferred detail page. |
| 15 | blind | Per-row `is_parent_*` calls in policies may slow reads for everyone | maybe-false | reject | School scale is tens of students; an EXPLAIN would settle it; at most low. |
| 16 | blind | Parents see homework and attendance from classes the child left | false | reject | These are the child's own records; the counts exclude left classes as specified. |
| 17 | blind | Parents can read every `profiles` column of the child | false | reject | The profile columns (0002, 0006, 0024) hold no teacher-only data: the child's own account fields and the parent's own email. |
| 18 | blind | Parent spec doesn't assert that a pending child triggers no class reads | low | reject | The code reads only for approved children; the fix adds a mock assertion of negligible value. |
| 19 | blind | bo strings are English | false | reject | Project convention for bo. |
| 20 | blind | Dual-role test leaves `teacherB` as a parent | low | reject | It is the last test in the file; no later test uses `teacherB`. |
| 21 | blind | Implementation Notes empty; the UTC→Berlin change unrecorded | low | reject | The fix is editing this build's spec. |
| 22 | vgap-other | 7-3 DB tests skip when local Supabase is down | false | reject | Repo convention (`describe.skipIf(!reachable)`); the ACs require a reset local DB. |

## Design Notes

- **Homework targeting:** homework is class-keyed, but a parent must see only what targets their child. So the helper checks `exists (history row for the instance where is_parent_of(student_id))`, not `is_parent_in_class`.
- **Attendance through an RPC:** RLS can't hide a column (AD-12).

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0025 applies cleanly.
- `npm test` -- expected: all pass (fresh DB).
- `npm run check` -- expected: 0 errors.

**Manual checks (if no CLI):**
- Local: approved parent with one approved and one pending child → `/parent` shows both cards with the right counts; the student dashboard numbers are unchanged.
