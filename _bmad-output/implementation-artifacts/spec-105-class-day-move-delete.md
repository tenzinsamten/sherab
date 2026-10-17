---
title: 'Admin moves and deletes class days (#105)'
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'ef6c387abbf7ee8a50d176d632413025fba22276'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-class-day-admin/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin can add, cancel and restore class days, but can't fix one. A day on the wrong date, or a Sunday that has to move to Saturday, today means cancel-and-add. That leaves a cancelled day behind and loses parents' leave answers (#105, SPEC-class-day-admin).

**Approach:** In the existing day view, the admin gets **Move day** (pick a new date) and **Delete day**, next to Cancel/Restore.
- **Move:** changes the day's date. Its sessions (classes, times, overrides) and the leave answers on them stay attached.
- **Delete:** removes an untouched day and its sessions.
- **Where the rules live:** the database enforces them (admin only, future only in Europe/Berlin, free target date, untouched for delete). The UI shows a clear message when one refuses.

## Boundaries & Constraints

**Always:**
- **Future only:** both the day and the target date must be after today (Europe/Berlin). Today and the past are fixed.
- **Delete only when untouched:** none of the day's sessions has an attendance record, a leave answer (`session_leave_history`) or a sick-leave decision. Otherwise the refusal points the admin to Cancel day.
- **One class day per date:** a move onto a date that already has one is refused, and nothing changes.
- **Enforcement in the database (AD-2):**
  - `class_days` gets a delete permission for the admin.
  - The date change is guarded so the existing Cancel/Restore of today's or past days keeps working.
- **Text:** all new copy is in en, de and bo.
- **Moved days keep their sessions** (user, 2026-10-17). A moved day carries a `moved` marker that `regenerate_class_sessions` respects: a later schedule edit never deletes a moved day's sessions. The marker shows no label in the UI.
- **After review** (user, 2026-10-17):
  - A move keeps each On-leave answer's `planned` / `short_notice` mark as it was when answered.
  - A moved day keeps exactly its own sessions. Schedule edits never add or remove sessions on it; extra sessions can still be added by hand.
- **Size:** kept as one spec at ~2 000 tokens (user, 2026-10-17). Move and Delete share one migration, one day-view change and one set of messages.

**Never:**
- No list view; no bulk move or delete; no undo.
- No notification to parents or teachers.
- No change to session times or classes from here.
- No edit to past migrations. The schema change is a new migration, and `database.types.ts` is updated by hand if anything typed changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Move | future day, free future date | Day shows on the new date with the same sessions and answers; old date empty | N/A |
| Move onto a taken date | target date has a class day | Refused, nothing changes | Message: that date already has a class day |
| Move today, the past or onto them | day or target ≤ today (Berlin) | Refused, nothing changes | Message: only future days can be moved |
| Delete untouched | future day, no attendance, answers or sick decisions | Day and its sessions gone for every role | N/A |
| Delete with answers | a parent answered a session | Refused, day stays | Message: has answers, cancel it instead |
| Delete today or the past | day ≤ today | Refused | Message: only future days can be deleted |
| Non-admin | teacher, parent or student calls either action | Refused by the database | Generic calendar error |
| Cancel/Restore of a past day | admin, existing action | Still works as today | N/A |
| Schedule edit after a move | Sunday day moved to Saturday, then the class's schedule changes | The moved day's sessions and answers stay | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/calendar/+page.server.ts` -- actions `addClassDays` (:~313) and `setClassDayCancelled` (:~363; `.select()` plus a row check because RLS turns a refusal into zero rows). Add `moveClassDay` and `deleteClassDay` in the same style.
- `src/routes/calendar/+page.svelte:767-800` -- the admin's day view (`{#if data.isAdmin}` with Cancel/Restore). Add Move (a date input, e.g. an iX date field) and Delete (confirm via `confirmAction` from `src/lib/ix.ts`).
- Schema: `class_days(id, day unique, cancelled, created_by, created_at)` (0018:75). Policies: select for signed-in users; insert and update for admin (0051, wrapped). No delete policy.
- FKs: `class_sessions.class_day_id → class_days` CASCADE; `attendance_records → class_sessions` RESTRICT; `session_leave_history` and `sick_leave_decisions → class_sessions` CASCADE.
- Triggers on `class_days`: `class_days_create_sessions` (AFTER INSERT) and `class_days_cancel_recompute_streaks` (AFTER UPDATE OF cancelled). Neither fires on a `day` change.
- `regenerate_class_sessions()` (0026) -- deletes future, non-`extra`, non-matching sessions without attendance on a schedule change. Recreate it in 0052 so it also skips days with `moved = true`. Keep its other behaviour, including the insert of matching days.
- Berlin date in SQL: `(now() at time zone 'Europe/Berlin')::date` (used in 0019, 0026).
- Tests: `src/routes/calendar/page.server.spec.ts` (action mocks), `src/lib/server/rls.spec.ts` (DB rules, reachable-gated), `e2e/calendar.e2e.ts` (admin day view).
- Messages: `messages/{en,de,bo}.json`, `calendar_*` keys (e.g. `calendar_cancel_day`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0052_class_day_move_delete.sql` -- the `class_days.moved boolean not null default false` column, set when a day's date changes; an admin delete policy on `class_days`; database guards for future-only moves and deletes, untouched-only deletes and the free target date, with clear error codes; and `regenerate_class_sessions` recreated to keep moved days' sessions. -- The rules hold whatever the client does, and schedule edits don't wipe moves.
- [x] `src/lib/supabase/database.types.ts` -- add `moved` to `class_days` Row, Insert and Update by hand. -- Types match the schema; never regenerate the file.
- [x] `src/routes/calendar/+page.server.ts` -- `moveClassDay` and `deleteClassDay` actions that map each refusal to its message. -- The UI explains why.
- [x] `src/routes/calendar/+page.svelte` -- Move (date picker) and Delete (with confirm) in the admin day view, shown only for future days. -- The admin finds them where Cancel is.
- [x] `messages/en.json`, `de.json`, `bo.json` -- labels, confirm text and the refusal messages. -- Localized.
- [x] `src/lib/server/rls.spec.ts` (or a new reachable-gated spec) -- every matrix row against local Supabase. -- The database rules are proven.
- [x] `src/routes/calendar/page.server.spec.ts` -- the action wiring and message mapping. -- Unit coverage.
- [x] `e2e/calendar.e2e.ts` -- the admin moves a future day and deletes an untouched one. -- The end-to-end path.

**Acceptance Criteria:**
- Given an admin on a future day's view, when they move it to a free future date, then the calendar shows the day with its sessions and answers on the new date.
- Given the full suite after `supabase db reset`, when `npm run test` runs, then every existing test passes.

## Implementation Notes

- Error codes: `CD001` (day or target not after today, Berlin) from both guards; `CD002` (a session has attendance, an answer or a sick-leave decision) from the delete guard; a taken target fails on `class_days_day_unique` (`23505`). The actions map each to its message; anything else, and RLS zero-row refusals, give `calendar_error_failed`.
- The guards apply only to client requests (`auth.role()` authenticated / anon). The service role and direct database sessions are exempt, because test fixtures and e2e cleanups delete and re-date class days of any date with the service role. `moved` is set on every date change, whoever makes it.
- The delete guard locks the day's sessions (`for update`) before the untouched check, so a concurrent answer insert waits and then fails its foreign key.
- Review fixes: `regenerate_class_sessions` skips moved days in its insert branch too (a moved day keeps exactly its own sessions); an AFTER UPDATE OF day trigger (`class_days_follow_move`) moves `attendance_records.session_date` with the day; `moveClassDay` refuses a missing `dayId` and the day's current date (`calendar_error_move_same_date`); the move picker's `min-date` is tomorrow.
- The existing 6-1 DB test asserted "no hard delete, not even for the admin"; it now asserts a teacher can't delete (the admin delete is covered by the #105 block).

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Leave `planned`/`short_notice` marks go stale after a move | medium | Real; intent gap → user: keep as answered (now in the frozen intent) | resolved, no code change |
| 2 | The rebuild still inserts sessions on a moved day for newly matching classes, while its delete branch skips moved days | medium | Real; intent gap → user: a moved day keeps only its own sessions | patch (`and not d.moved` in the insert branch) |
| 3 | Attendance on a moved day keeps its old `session_date` (copied when the attendance is recorded) | medium | Real: 0021 fills `session_date` from the day by a BEFORE trigger. Rare on a future day, but it skews streaks and history | patch (update `session_date` on move) |
| 4 | Today's boundary is never tested in the DB: a move or delete of a day dated today (verification-gap) | medium | Verification-gap, pre-verified: only centuries-past and centuries-future source days are tested | patch |
| 5 | A no-op move (same date) reports "Class day moved." | low | Real; a direct check | patch |
| 6 | An empty `dayId` reaches the DB as an invalid uuid | low | Real; a direct check | patch |
| 7 | The move date picker has no minimum date | low | Real; one attribute | patch |
| 8 | The e2e "past and today" test only opens today | low | Real; one more assertion | patch |
| 9 | The CD002 sick-decision fixture deletes or re-points shared rows on today's day | medium | Real test hygiene: it can remove rows it didn't create on a shared DB | patch (touch only what it created) |
| 10 | The e2e cleanup can delete a class day it didn't create; its setup query result goes unchecked | low | Real; direct corrections | patch |
| 11 | The move and delete success toasts are not asserted | low | Real; one line each in the existing e2e | patch |
| 12 | `moved` is never reset, and there's no "moved from" hint for parents | low | Harmless: a day moved back keeps its sessions, which match anyway. An indicator would need a new column, and the spec rules out notifications | reject |
| 13 | The moved-day exemption keeps sessions after the schedule ends | low | Follows from the user's "keeps exactly its own sessions" | reject |
| 14 | The delete confirm text doesn't mention overrides or extra sessions | low | Copy polish; the confirm already says the sessions are deleted | reject |
| 15 | No 401 or refused-message UI tests | low | Unit tests already map every code to its message; adds little | reject |
| 16 | The streak recompute doesn't fire on a move | false | Streaks count past sessions only, and only future days can move | reject |

## Design Notes

- The database guard is most naturally a `BEFORE UPDATE OF day` / `BEFORE DELETE` trigger on `class_days`, plus an admin delete policy. An update policy can't tell a date change from a cancel. A guard on `day` keeps `setClassDayCancelled` on past days working. The untouched check: `exists` on `attendance_records`, `session_leave_history` or `sick_leave_decisions` joined through the day's `class_sessions`.
- A move is a single `update class_days set day = $new where id = $id`. The sessions follow through `class_day_id`, because their date comes from the day.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm run test` -- expected: exit 0, the new DB tests showing as passed, not skipped
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/calendar.e2e.ts` -- expected: all pass

**Manual checks:**
- Production: apply migration 0052, then as admin move a test day and delete an untouched one.
