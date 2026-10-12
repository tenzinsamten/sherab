---
title: 'Weekly homework: students see the first week as soon as it is created (#96)'
type: 'bugfix'
created: '2026-10-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '8dd9679cce6fd761697d4813f7f0d8efdda2d850'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A teacher who creates weekly homework gets "created", but students see nothing: only the series is stored, and the students' copies come from a job that runs once a day at 03:00 UTC (user, 2026-10-12: "i do not see any home work on students page"). Nothing on the form says so.

**Approach:** When the series' start date is today or earlier, create the students' copies for every week up to today in the same request, so the homework is on the student's page at once. Later weeks keep coming from the nightly job. For a start date in the future, the form and the success message say from when students will see it.

## Boundaries & Constraints

**Always:**
- "Today" is the date in Munich (Europe/Berlin), for the new immediate creation. The nightly job's behaviour is unchanged.
- The immediate copies are exactly what the nightly job would have made: same weeks, same due dates, same students (enrolled and approved at that moment), and the job never makes a second copy of a week.
- Only the admin or a teacher of that class can trigger the immediate creation, and only for a weekly series of that class. Enforced in the database, not only by the page.
- If the immediate creation fails, the series is still saved, the nightly job catches up, and the teacher is told students will see it from the next morning.
- New and changed text in en, de and bo (Tibetan is the assistant's draft, recorded as unreviewed).

**Never:**
- No "New" notification for weekly homework (decision of #92 stands).
- No change to one-off homework, to pausing, ending or editing a series, or to how later weeks are generated.
- Do not regenerate `database.types.ts`. Do not push the migration or commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start today | Weekly, start date = today (Munich), offset 7 | One copy for this week, due in 7 days, on every enrolled approved student's page at once | N/A |
| Start in the past | Start date 3 weeks ago | Copies for each week from then up to today | N/A |
| Start in the future | Start date next Sunday | No copy now; success message and form note name the date students will see it | N/A |
| Nightly run afterwards | Job runs after an immediate creation | No second copy of any week | N/A |
| Class with no students | Start today, nobody enrolled | The week's copy exists with no students; a student enrolled later gets it as today | N/A |
| Not the class's teacher | Another teacher or a student calls the database function directly | Nothing created | Refused |
| Not a weekly series | One-off assignment id passed | Nothing created | Refused |
| Immediate creation fails | Database error after the series was saved | Series kept; success message says "from tomorrow morning" | Logged on the server |
| Midnight in Munich | Start date = today, created at 00:30 Munich (still yesterday in UTC) | Copy is created at once | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/classes/[id]/homework/new/+page.server.ts:90-137` -- weekly branch: inserts the series only, then redirects to `…/homework?created=weekly`. Needs the new id (`.select('id')`) and the call.
- `supabase/migrations/0016_class_enrollments.sql:419-523` -- current `generate_recurring_homework_instances()` (SECURITY DEFINER, revoked from `authenticated`, run by the cron job `generate-recurring-homework-instances`, `0 3 * * *`, 0005:274). Its inner loop per series is what must be reused, not copied.
- `supabase/migrations/0005_recurring_homework.sql` -- columns `recurrence_rule`, `recurrence_start_date`, `due_offset_days`, `ends_on`, `paused_at`; `UNIQUE(assignment_id, period_start)` makes generation idempotent.
- `supabase/migrations/0013_…`, `0016` -- `class_enrollments_assign_open_homework`: a student enrolled later gets open whole-class homework.
- `supabase/migrations/0037_push_notifications.sql` -- `homework_push_targets` / `trigger_homework_push`: "New" is for one-off homework only; confirm the immediate copy sends none.
- `src/lib/berlin-date.ts` (`todayInBerlin`) -- the app's "today"; use it for the message choice.
- `src/routes/teacher/classes/[id]/homework/new/+page.svelte:~148` -- `startDate` field and `homework_recurring_note`; `…/homework/+page.svelte` -- the `?created=weekly` toast.
- `messages/{en,de,bo}.json` `homework_*` -- `homework_start_date_label`, `homework_due_offset_label`, `homework_recurring_note`.
- `src/lib/server/rls.spec.ts`, the action's spec next to the route, `e2e/teacher.e2e.ts` -- tests to extend. `src/lib/supabase/database.types.ts` -- hand-maintained. Next migration number: `0040`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0040_weekly_homework_first_copy.sql` -- move the per-series loop into one function used by both paths; keep the nightly function's result the same; add a function callable by `authenticated` that checks admin or teacher of the series' class and that it is a weekly series, then generates up to today in Munich -- immediate creation with database-side authorization.
- [x] `src/lib/supabase/database.types.ts` -- add the new function by hand -- typed call.
- [x] `src/routes/teacher/classes/[id]/homework/new/+page.server.ts` -- after saving the series, call it when the start date is today or earlier; redirect with which of the three outcomes happened (visible now, visible from a date, visible from tomorrow morning) -- behaviour.
- [x] `…/homework/new/+page.svelte`, `…/homework/+page.svelte`, `messages/en.json`, `de.json`, `bo.json` -- a note at the start date saying when students see the homework; the three success messages -- the teacher is told.
- [x] `src/lib/server/rls.spec.ts`, the action's spec, `e2e/teacher.e2e.ts` -- every matrix row: copies at once, no duplicate after the nightly function runs, refusals, future start, failure path, no "New" push target -- tests.
- [x] `_bmad-output/manual-verification-issues.md` -- #96 to "built, to verify", migration not pushed -- project log.

**Acceptance Criteria:**
- Given a teacher creates weekly homework starting today, when an enrolled student opens their homework page straight after, then the homework is there with its due date.
- Given that homework, when the nightly job runs, then the student still has exactly one copy for the week.
- Given a start date in the future, when the teacher saves, then the message names that date and the student sees nothing until then.
- Given the series the user created before this fix, when the nightly job runs, then it behaves as before.

## Implementation Notes

- Built 2026-10-12 by the implementation subagent; details in log entry #96 of `_bmad-output/manual-verification-issues.md`. Migration `0040_weekly_homework_first_copy.sql`: the per-series loop is one function used by the nightly job and by `create_weekly_homework_first_copies`, which `authenticated` may call and which checks admin or teacher of the class.
- Review pass 1: 15 fixes applied, 7 rejected, one item deferred (what a start date in the past should do), see the triage log. Two fixes differ from what was asked: the start-date note is the date field's own helper text, because iX's validation replaces a described-by link set from outside; the "no New notice" database assertion was dropped, because the database's push-target function has no weekly exclusion and the guarantee lies in the action never announcing weekly homework, which the action's spec asserts.
- Verified after the fixes on a reset database: 1140 unit and database tests, `npm run check` and `npm run build` exit 0; `e2e/teacher.e2e.ts` passes 14 of 14 on a second reset. The full browser suite was not run.
- Not verified: the hosted project (whether the nightly job exists and runs there); the database's own Munich-date choice between 00:00 and 02:00 Munich time, which the tests cannot reach because the database clock cannot be set.
- Found, not changed: on a fresh page load in the dev server the homework list keeps `?created=…` in the address after the toast (SvelteKit's `replaceState` before the router has started, dev only, every `created` toast).
- Not committed and not pushed; migration 0040 is local only.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-12). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B3 / E2 / E11 / V-other | The action ignores the count the function returns and says "visible now" whenever there is no error | medium | `new/+page.server.ts`: only `error` is read. A result of 0 (app and database disagreeing on the date around midnight) still redirects with `visible=now`. | patch |
| E1 / E10 / B4 / V2 | A start date more than 104 weeks back makes 104 old weeks and never reaches the current one; the cap is untested; the in-file comment says later runs catch up | medium | True of the loop: it restarts at the start date on every call and counts weeks that already exist. Same logic as 0016, so pre-existing in the nightly job; now reached in the create request. | patch: test the cap and correct the comment; defer the catch-up bug and the question of past start dates |
| B5 | Backfilled weeks can trigger "Due soon" and "Overdue" notifications for homework that did not exist the day before | medium | True of 0037's rules; equally true of the nightly backfill before this change. "No New notification" holds. | defer (pre-existing); reported to the user |
| E4 / B8b | A thrown `rpc` call would answer 500 after the series is saved; a retry would make a second series | low | No `try` around the call. supabase-js normally returns an error object, so this needs an unusual failure. | patch (catch it like an error) |
| B1 / E5 | The start-date note stays after switching One-off and back to Weekly, under an empty field | low | `startDate` is page state; the input is recreated empty inside the `{#if}`. | patch |
| B2 | `aria-describedby` on the `ix-date-input` host does not reach the real input | low | `src/lib/ix-fields.ts` documents that an id cannot cross the shadow boundary and offers a helper. | patch |
| B9 | Any unrecognised or missing `visible` shows the failure message | low | `homework/+page.svelte`: the final `else` is the "tomorrow" text. | patch (explicit match, neutral fallback) |
| B11a | The series filter is written twice in 0040 | low | Nightly loop and per-series function repeat the same four conditions; one will drift. | patch |
| B11b | 0016's rationale comments (why `ON CONFLICT`, why catch-up) were trimmed | low | True of the moved loop. | patch (comments) |
| E8 | `service_role` is granted execute on a function that always refuses it | low | `auth.uid()` is null for the service role, so `is_admin()` and `is_teacher_of_class()` are false. | patch (drop the grant) |
| B6 / E12 | The `push_notification_log` assertion cannot fail | low | Only the app's sender writes that table. | patch (assert the push targets, or drop it) |
| B7 / V1 | The "midnight in Munich" database test does not call the function its title names | low | It calls the per-series function with a hand-built date; the database clock cannot be faked from the test harness. | patch (rename to what it proves) |
| V3 | No test shows the toast for `visible=tomorrow` or that the parameters are removed | low | Filed evidence: only the producer side is asserted. | patch (test) |
| V-other2 | A signed-out caller is not tried against the per-series function | low | The loop tries teacher and admin only. | patch (test) |
| B12a | German note wording is awkward | low | "Liegt es heute oder früher". | patch |
| B8a | The failure message is a success toast and "tomorrow morning" is the wrong day between midnight and the run | low | True; the wording is the frozen matrix row. | rejected (intent) |
| B10 | Three definitions of "today": the nightly job still uses the UTC date | low | True; the frozen rule is that the nightly job is unchanged, and the two dates agree at 03:00 UTC. | rejected (intent) |
| E3 | App and database can disagree on the date around midnight | low | Covered by the first row: a count of 0 no longer says "now". | merged |
| E6 | The note accepts a typed date that is not a real date | low | Needs a hand-typed impossible date; the server refuses it. | rejected (low) |
| E7 | The note can go stale if the form stays open across midnight | low | True; negligible. | rejected (low) |
| E9 | A teacher could call the function directly for an existing series just after midnight and get next week's copy hours early | low | True; same copy the job makes at 03:00 UTC. | rejected (low) |
| B12b-e | "from {date}" means the 03:00 UTC run; duplicated note style; e2e date helper; no test of the de / bo date sentences | low | True; cosmetic. | rejected (low) |

## Verification

**Commands:**
- `npm run supabase:reset` then `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/teacher.e2e.ts` on a freshly reset database -- expected: the weekly homework test passes
