---
title: '#99 The team is assigned automatically and evenly at approval'
type: 'feature'
created: '2026-10-12'
status: 'done'
route: 'dispatch'
baseline_commit: 'ccd67ea3456e44b297e7e527d90727adb2a36a8f'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a student registration is approved on `/requests`, the admin or class teacher has to pick the team by hand. Nothing keeps the teams the same size. Reported by the user: "currently the team is assigned by admin. please assign the team randomly but make sure we have same number of student through out".

**Approach:** The database chooses the team at approval: one of the teams with the fewest students, at random among those. The team picker is removed from `/requests`, and the approval message names the team the student got.

## Boundaries & Constraints

**Always:**
- A team's size is the number of students whose team it is. Only approved students have a team, so pending and rejected registrations do not count.
- The new student goes to a team of the smallest size; when several are smallest, one of them at random.
- The choice is made in the database, inside the approval's own transaction, and two approvals at the same moment cannot both count the same state.
- For a signed-in approver (admin or teacher) the database always chooses; a team sent by the client is ignored. The service role may still set a team itself (tests, fixtures, out-of-band repair).
- With no team at all, approval is refused before any sign-in credentials are created, with the existing "create a team first" text.
- A student's team is still set once and never changed.
- Changed and new texts exist in en, de and bo.

**Never:**
- No moving of students who already have a team; teams that are uneven today even out only through new approvals.
- No way for the approver to pick or override the team, and no rule to keep siblings together.
- No change to "Join another class", to team creation or deletion, or to the leaderboard.
- No push to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One smallest team | Teams A=3, B=2, C=3; a student is approved | Student is in B | N/A |
| Several smallest | A=2, B=2, C=3; approved | Student is in A or B, never C | N/A |
| Even from empty | 3 empty teams; 7 students approved one after another | Sizes are 3, 2, 2 in some order | N/A |
| Uneven today | A=5, B=1; three approvals | All three go to B | N/A |
| New empty team | A=4, B=4, new C=0; approvals | Go to C until it has caught up | N/A |
| Same moment | Several approvals at once over even teams | Sizes still differ by at most 1 | Serialised by a transaction lock |
| Client sends a team | A teacher's update carries a `team_id` of a larger team | The database's choice wins | N/A |
| Service role sets a team | Service-role update to approved with a `team_id` | That team is kept | N/A |
| No teams | Approval with no team in the database | 400, "create a team first"; no credentials created, student stays pending | Checked in the action first; the database refuses too |
| Rejection | A registration is rejected | No team is assigned | N/A |
| Team already set | An update that would change an existing team | Refused as today (set once) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0002_student_registration.sql:112-130` -- `enforce_team_id_set_once()` and trigger `profiles_team_id_set_once` (before update). Keep. Before-update triggers fire in name order, so a trigger named `profiles_assign_team_on_approval` runs first.
- `supabase/migrations/0024_parent_first_registration.sql:210-234, 245-259` -- `guard_profile_link_columns()` shows how to tell client roles apart (`current_user in ('authenticated', 'anon')`, security invoker). Policy `profiles_update_registration_review`: its `with check` does not require a team, so an update without `team_id` passes. Do not change the policy.
- `supabase/migrations/0031_class_join_requests.sql:102` -- `pg_advisory_xact_lock(hashtextextended(...))`, the pattern for the lock.
- `supabase/migrations/0042_student_unique_per_parent.sql` -- latest migration; the new one is `0043`. Follow its header style.
- `src/routes/requests/+page.server.ts:243-369` -- `approve`: reads `teamId`, refuses without it (line 254), mints credentials, then updates `status`, `team_id`, `email`, reviewer. `load` returns `teams` (line 165, 227), used only by the picker and the no-teams note.
- `src/routes/requests/+page.svelte:19-30, 39-48, 271-311, 338-346` -- `teamMissing` and `submitApprove`, the outcome message, the `ix-select` picker, the no-teams note.
- `messages/{en,de,bo}.json` -- `requests_outcome_approved` (537), `requests_team_label`, `requests_team_placeholder`, `requests_error_team_required` (525-541), `help_teacher_3_body` (1019, "Choose a team and approve").
- `src/routes/requests/page.server.spec.ts:320-360` -- the approve cases post `teamId`.
- `src/lib/server/rls.spec.ts` -- approval tests update as a teacher with an explicit `team_id`; some assert it.
- `e2e/forms.e2e.ts:440-525` -- drives the team picker and its "Choose a team before approving." error.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0043_auto_team_assignment.sql` -- before-update trigger `profiles_assign_team_on_approval` on `profiles`: when a student's status becomes `approved`, and the caller is a client role or no team was given, take one transaction-level advisory lock, pick the team with the fewest students (ties by `random()`), and set `new.team_id`; raise with hint `no_teams` when there is none. The function that counts must see every student whatever the caller's rights -- the rule.
- [x] `src/routes/requests/+page.server.ts` -- `approve`: drop `teamId`; refuse with the no-teams text before minting credentials when no team exists; update without `team_id`; read the assigned team back and return its localized name; map a `no_teams` failure to the same text. `load`: return only what the page still needs about teams -- the action.
- [x] `src/routes/requests/+page.svelte` -- remove the picker, `teamMissing` and its error; keep Approve disabled with the note when there is no team; show the team in the outcome message -- the page.
- [x] `messages/en.json`, `messages/de.json`, `messages/bo.json` -- `requests_outcome_approved` names the team (`{team}`); `help_teacher_3_body` no longer says to choose a team; remove the three picker texts if nothing uses them -- the words.
- [x] `src/routes/requests/page.server.spec.ts` -- approve without a team, the team name in the result, the no-teams refusal with nothing minted.
- [x] `src/lib/server/rls.spec.ts` -- a block for the matrix rows the database decides; adapt existing approval tests that relied on the teacher's own choice, without weakening what they prove.
- [x] `e2e/forms.e2e.ts` -- replace the picker test: no team field, approving shows the team's name.
- [x] `_bmad-output/manual-verification-issues.md` -- append the #99 build entry: what changed, what was checked, what was not.

**Acceptance Criteria:**
- Given a fresh database, when `supabase db reset` runs, then all migrations apply.
- Given the change, when `npm test`, `npm run check` and `npm run build` run after the reset, then each ends with exit 0.
- Given `/requests` with a pending student and at least one team, when the page is shown, then there is no team field and Approve works with one click.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-12). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 | The "even from empty" and "new empty team" tests do not prove their titles | medium | The #99 block runs after blocks that leave empty teams behind, so the approvals can all go to those; the second test only asserts "not the big team". | patch (test: assert at every approval that the chosen team is one of the smallest at that moment) |
| V2 / B8 | `hasTeams` from the load is not asserted; the load fetches every team id for a yes/no answer | low | Filed evidence: no spec names `hasTeams`. The action already uses `.limit(1)`. | patch |
| B9 | The 0043 header says pending and rejected registrations do not count; the function counts every student row with that team | low | True of the comment; the function matches the frozen rule ("the number of students whose team it is"). | patch (comment) |
| E5 | `e2e/forms.e2e.ts` `afterAll` throws before the fixture cleanup when the team cannot be removed | low | True of the code order. | patch |
| V1 / B4 | The database's own `no_teams` refusal runs in no automated test | medium | Filed evidence: the shared test database always has teams with students; tried by hand with a script that was not kept. | defer |
| V3 | "At random among the smallest" is not observed by a test | low | Filed evidence: removing `random()` keeps every size assertion true. A test would be probabilistic. | defer (with V1) |
| E1 | A crafted client update can reject a student with a team, which then counts in that team's size | low | The policy and the set-once trigger allowed this before the change too; it needs a hand-made request by an approver. | rejected |
| E2 | The chosen team is deleted by an admin at the same moment | low | Needs an empty team deleted during one approval; the approval then fails as a partial approval and can be repeated. | rejected |
| E3 / B6 | An empty team name gives "is in team “”" | false | After a successful update the trigger has set a team, and teachers and the admin can read teams, so the embedded row is there. | rejected |
| B2 / E4 / V-other | The #99 tests compare all teams and another spec file creates a team in parallel | low | `student-pin.spec.ts` creates its team at its start; the #99 block runs minutes later at the end of `rls.spec.ts`. No overlap seen in three full runs. | rejected, told to the user |
| B3 | An approval can land in `student-pin.spec.ts`'s team before its first student; its delete error is ignored | low | Leaves a team behind in the test database; checking the error would turn the same race into a failure. | rejected |
| E6 | A failed fixture-team insert stays cached | low | Test helper; a failed insert fails the run anyway. | rejected |
| B5 | Trigger conditions without a test (non-student, rejected to approved, anon) | false | Non-students have no status (check constraint); the policy lets a client update only pending rows; anon has no update right on profiles. | rejected |
| B7 | The cast hides the embed's real type | false | The browser test reads the team's name from the real response. | rejected |
| B8b | A failed teams query shows the "create a team" note | low | Pre-existing: the page did the same with an empty `teams` list. | rejected |
| B10 | A client could keep a team through a security-definer function | false | No such function writes `profiles.status`. | rejected |
| B11 | Balance is across all teams, not per class | low | True: teams have no class. It follows from the data model and the request. | rejected, told to the user |
| B12 | Spec status; stale help screenshots; two browser tests fail after `npm test` without a reset; no `drop trigger if exists`; approved students without a team | low | Status is workflow state. Screenshots: true, see the build entry. The two tests pass on a fresh reset. Migrations run once. Approval always required a team before, so no such students come from the app. | rejected, screenshots told to the user |

## Design Notes

A trigger, not a function the action calls: the choice then cannot be skipped by any client path, and it happens in the same transaction as the status change, so a failed approval leaves no team behind.

One global lock is enough: approvals are rare and short. Without it two approvals at once would both see the same smallest team.

Sizes can still be uneven after this for reasons outside the rule: teams uneven today, a student deleted later, or a team added later. Each new approval moves toward even.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0, 0043 applied
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/forms.e2e.ts` -- expected: the replaced approval test passes
