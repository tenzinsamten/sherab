---
title: '7-5 Sick leave with teacher approval'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7550f4aa66ebc9007953060e5c3120dc4645b95d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The database accepts a Sick answer (7-4), but parents can't choose it and nobody can decide it. Because Sick is never approved, it always costs a streak grace week.

**Approach:**
- The parent marks a child Sick.
- Any teacher of the class, or the admin as a backup, approves or rejects it from a queue.
- Undecided Sick is approved automatically 14 days after the session.
- Approved Sick protects the streak week; pending or rejected Sick uses up a grace week.

## Boundaries & Constraints

**Always:**
- **Migration `0028_sick_leave_decisions.sql`:**
  - **`sick_leave_decisions` table:**
    - Columns: id, class_session_id (FK → `class_sessions` `ON DELETE CASCADE`), student_id, decision (`approved`/`rejected`), decided_by (NULL = system, following the 0005 convention), decided_at.
    - `UNIQUE (class_session_id, student_id)`: one decision per session, and it is final.
    - A BEFORE INSERT trigger stamps `decided_by = auth.uid()` and `decided_at = now()`.
    - It refuses the insert unless the student's current answer (the latest `session_leave_history` row) is `sick`.
  - **RLS:**
    - INSERT with check `(is_admin() or is_teacher_of_class(session's class)) and not is_parent_of(student_id)`. This is the first AD-4 self-decision guard.
    - SELECT for the student, `is_parent_of`, the class's teachers, and the admin.
    - No UPDATE or DELETE policies.
  - **Leave trigger (`trg_session_leave_before_insert`, redefined):** once a decision exists for (session, student), every new answer is refused with hint `leave_decided`. A rejection is final and can't be re-submitted.
  - **Auto-approval job:** `approve_stale_sick_leave()` is a security definer function granted to `service_role` only. It inserts `approved` with a NULL actor for every (session, student) whose current answer is `sick`, has no decision, and whose `session_starts_at` is at or before `now() − 14 days`. It uses `on conflict do nothing`, so it is idempotent and catches up after missed runs. `cron.schedule('approve-stale-sick-leave', '15 3 * * *', …)`.
  - **Streak:** in `compute_student_streak`, a missed session also counts as protected when its current answer is `sick` and its decision is `approved`. An AFTER INSERT trigger on decisions (statement-level, via `recompute_streaks_for_sessions` or per row) calls `recompute_student_streak`.
  - **Functions:** all new ones use `search_path = ''` with explicit revokes and grants.
- **Parent page (`/parent/children/[id]`):**
  - It offers Sick (per decision 2).
  - Each answer shows its decision: "Sick · Pending", "Sick · Approved" or "Sick · Rejected".
  - A decided session shows no controls.
  - `setLeave` accepts `sick`, and `leaveErrorMessage` maps `leave_sick_closed` and `leave_decided`.
- **Teacher and admin:**
  - A pending-Sick queue (per decision 1) lists student, class and session date and time, with Approve and Reject buttons.
  - Decided rows go into a DECIDED history with status chips, following the `/requests` pattern.
  - The nav badge count includes pending Sick.
  - A parent-teacher never sees Approve or Reject for their own child, and the database refuses it anyway.
- **Student view:** the student keeps seeing "Sick" read-only; masking to classmates is unchanged (7-4).
- **Decision 1 — queue on `/requests`:**
  - A "Sick leave" section on `/requests` shows pending Sick rows. Teachers see their classes' rows; the admin sees all classes.
  - Each row shows student, class and session date and time, with Approve and Reject.
  - Decided rows go into a DECIDED history with status chips.
  - A row for the viewer's own child shows no buttons.
- **Decision 2 — Sick for yesterday and today only:**
  - The parent page lists sessions from yesterday (Berlin) onward.
  - Sick is offered only for sessions dated yesterday or today that are still inside the Sick window and have no decision.
  - Coming and On leave stay as in 7-4 (until start).
- **Size:** the full spec was kept, not split.
- **No reason or medical detail** is collected. **i18n:** every new string exists in en, de and bo.

**Never:**
- Deciding by anyone who `is_parent_of` the student.
- Changing a decision after it is made.
- Collecting a reason.
- The client stamping `decided_by` or deciding the classification.
- Editing old migrations, or pushing to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Approve | class teacher approves pending Sick | row `approved`, decided_by = teacher; streak recomputed | N/A |
| Reject | admin rejects | row `rejected`; week costs grace | N/A |
| Self-decision | teacher or admin who is the student's parent decides | refused | RLS 42501 |
| Other teacher | teacher of another class decides | refused | RLS 42501 |
| Not sick | decide when the current answer is coming/on_leave/none | refused | trigger error |
| Final | second decision; parent re-sends Sick or Coming after a decision | refused | unique / `leave_decided` |
| Auto | undecided Sick, session started 15 days ago; another 13 days ago; job runs twice | first approved (decided_by NULL), second untouched, no duplicates | N/A |
| Streak | absent week, Sick pending / approved / rejected, grace 0 | pending → reset; approved → unbroken; rejected → reset | N/A |
| Read | student, own parent, class teacher, admin; other student/parent | rows / none | RLS |
| Job access | authenticated teacher/admin calls `approve_stale_sick_leave` | refused | 42501 |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0027_session_leave.sql`:
  - `:187-254` `trg_session_leave_before_insert` (sick cutoff `:237-241`): redefine it to add the `leave_decided` check.
  - `:159-184` leave RLS and grants (the pattern to copy); `:262-290` streak AFTER INSERT trigger pattern.
  - `:471-497` `protected_weeks` block (the `bool_and` at `:478`, the lateral at `:481-488`): extend it; redefine the whole `compute_student_streak` in 0028.
  - `:43` `session_starts_at` (security invoker).
- `supabase/migrations/0005_recurring_homework.sql`:
  - `:140-257` a catch-up job function (`on conflict do nothing`, revokes); `:269-278` `cron.schedule` with a fixed name.
  - `:~214` NULL-actor convention for system rows.
- `supabase/migrations/0023_parents.sql:50-58,87-90` -- decision policy and the BEFORE UPDATE stamping pattern.
- `supabase/migrations/0024_parent_first_registration.sql:264` `is_parent_of`.
- `supabase/migrations/0021_attendance_per_session.sql:466` `recompute_streaks_for_sessions`.
- `src/routes/parent/children/[id]/+page.server.ts`:
  - `:64-72` session window (`.gte('day', today)` at `:70`); `:111` `open`; `:82-97` answers read; `:153-166` `setLeave` (validation at `:159`).
  - Plus `+page.svelte` and its spec.
- `src/lib/server/leave.ts` -- error hint mapping.
- `src/routes/requests/+page.server.ts`:
  - `:71-87` load and the teacher/admin guard; `:106-157` pending and decided queries; `:165+` actions.
  - `+page.svelte:94-152` pending rows (`createPending`, `enhance`); `:177-193` DECIDED history and `ix-pill` chips.
  - Plus `page.server.spec.ts`.
- `src/routes/+layout.server.ts:27-56` -- nav badge counts; `+layout.svelte:63-66,90-96` nav.
- `src/routes/calendar/+page.svelte` -- the student's "Sick" label (unchanged).
- `src/lib/server/rls.spec.ts`:
  - 7-4 block `:8632` with helpers `child` 8682, `setLeave` 8705, `latest` 8724, `withSetting` 8738.
  - Streak `scenario` 8997 and `streakOf` 9061; `mixedWeek` 9107.
  - `runGenerator` 2755 (job-call pattern) and the refusal test 3177.
- `src/lib/supabase/database.types.ts:765` (the leave table) -- add the decisions table and the job RPC by hand.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0028_sick_leave_decisions.sql` -- the table, triggers, RLS, leave-trigger redefinition, job function and schedule, and the streak change.
- [x] `src/routes/parent/children/[id]/+page.server.ts`, `+page.svelte` (+ spec), `src/lib/server/leave.ts` -- the Sick option, decision status, and locked decided sessions.
- [x] `src/routes/requests/+page.server.ts`, `+page.svelte` (+ spec) -- the Sick leave section, approve/reject actions; `src/routes/+layout.server.ts` badge count.
- [x] `src/lib/server/rls.spec.ts` -- `describe('7-5 sick leave decisions')`, one test per matrix row.
- [x] `messages/{en,de,bo}.json`, `database.types.ts`.

**Acceptance Criteria:**
- Given a parent marks today's session Sick, when a teacher of the class approves it, then the parent sees "Sick · Approved" and the week no longer costs grace.
- Given a dual-role teacher-parent, when they open the queue, then their own child's Sick row has no decision controls.
- Given a freshly reset local DB, when `npm test` and `npm run check` run, then all pass with 0 errors.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind, edge | Sick for a future session is refused only in the UI; a crafted POST sets Sick weeks ahead, which then enters the queue | medium | patch | Redefined `trg_session_leave_before_insert` checks only the upper bound (`today > v_day + 1`); decision 2 limits Sick to yesterday and today, and AD-2 forbids a UI-only barrier. |
| 2 | blind, edge ×2 | Queue and auto-approval include cancelled sessions | medium | patch | `sick_leave_queue` and `approve_stale_sick_leave` never filter `s.cancelled` / `d.cancelled`; a Sick on a later-cancelled session stays pending, is badged, and is auto-approved. |
| 3 | blind, edge ×2, vgap | The "Sick then Coming → not decidable" check never runs | medium | patch | The test branch sits under `if (starts_at > now)`; the fresh classes have no start time, so today's session starts at 00:00 and the branch is dead. Dropping `order by … limit 1` still passes. |
| 4 | blind, vgap | The root layout nav badge's Sick count is untested | medium | patch | No spec imports `src/routes/+layout.server.ts`; dropping the `!ownChild` filter or the `sickError` merge passes. |
| 5 | vgap | The admin dashboard's pending-requests tile ignores pending Sick | medium | patch | `admin/+page.server.ts:30-42` says it mirrors the layout count; the layout and `/requests` now add Sick, the tile doesn't, so the admin sees two numbers. |
| 6 | blind | Parent page copy is stale: "Upcoming sessions" / "No sessions in the next 12 weeks" while the list starts yesterday | low | patch | A direct string edit; every parent sees it. |
| 7 | vgap | The `/requests` `load` (including `sickError` → `loadError`) is untested | medium | defer | Pre-existing: no test calls this route's `load` for any query. |
| 8 | blind, edge, vgap-other | The nav badge loads the full queue (decided rows included) on every staff page load | low | reject | School scale is tens of students and ~40 sessions a year; the fix adds RPC surface. |
| 9 | edge | `futureDay()` may repeat within the Not-sick loop | low | reject | ~54k values, three draws; patch 3 rewrites the test anyway. |
| 10 | blind | DECIDED history shows no time or decider; section lacks `aria-labelledby` | low | reject | Status and automatic flag shown; cosmetic. |
| 11 | blind | The Rejected pill variant differs between the parent page and `/requests` | false | reject | Different audiences and pages; no defect. |
| 12 | blind | A decided session shows no explanation on the parent page | false | reject | The "Sick · Approved/Rejected" status is shown, as the spec requires. |
| 13 | blind | The `decideSick` toast name comes from a hidden form field | low | reject | Affects only the caller's own toast; the insert is RLS-checked. |
| 14 | blind | `formatDay` is duplicated a third time | low | reject | Refactor. |
| 15 | blind | The decision trigger raises P0002 before the caller check (session-id probing) | low | reject | Needs a guessed UUID and reveals only existence. |
| 16 | blind, vgap-other | Missing tests: plain parent deciding, the cron row existing, the second Auto run returning 0 | low | reject | A plain parent fails the same policy the self-decision test covers; the second-run check goes into patch 3. |
| 17 | blind | Rejected vs approved with grace ≥ 1 is untested | false | reject | Grace 0 already separates "uses a grace week" (reset) from "protected" (unbroken). |
| 18 | edge | A staff parent whose parent status is revoked after setting Sick could decide their own child | low | reject | Needs approval then revocation between the answer and the decision; `is_parent_of` is the AD-4 helper by design. |

## Design Notes

- **A decision locks the session's answers:** the approved or rejected Sick stays the current answer, so the streak rule and the queue never see a decision attached to a stale answer.
- **Auto-approval uses `session_starts_at`** (AD-15), not the class day, so all cutoffs come from one source.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0028 applies cleanly.
- `npm test` -- expected: all pass (fresh DB).
- `npm run check` -- expected: 0 errors.
