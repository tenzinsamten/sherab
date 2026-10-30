---
title: 'Toggle and Mark done on the child page'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: '043802078176064f4563c4502d2d477b86982975'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-managed-homework/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1 added the parent-managed flag and the parent `done` rule in the database. Parents still have no way to use them, so they keep logging into the child's account.

**Approach:** On `/parent/children/[id]`:
- an overview card lets either linked parent turn "I manage homework for this child" on or off;
- when it is on, each open item in the Homework tab gets the existing Mark done button (with its confirm dialog).

This is SPEC CAP-1 (UI) and CAP-2 (child page).

## Boundaries & Constraints

**Always:**
- The toggle calls `set_parent_managed` through a server action.
- Mark done inserts `done` with `student_id = params.id` and `recorded_by = parent`.
- RLS is the barrier. A `42501` maps to a localized "not allowed" message.
- After either action the page stays on its tab (`?tab=overview&/…`, `?tab=homework&/…`).
- The Mark done button appears only when `parentManaged` is true, and only on open items, never on done items.
- Reuse `MarkDoneForm`, adding an `action` prop whose default keeps today's `?/markDone`.
- Reuse `markHomeworkDone`, adding an optional `studentId` (default `user.id`), so the student callers are unchanged.
- New text is in `child_managed_*` keys in en, de and bo.

**Never:**
- No database or migration change.
- No change to student pages or their behavior.
- No "marked by" labels (story 5).
- No detail page (story 3).
- No change to `/parent/homework` (story 4).
- No new UI library. The toggle is a native control or a Button form.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Load, flag off | linked parent | `parentManaged: false`; card shows off; no Mark done buttons | N/A |
| Load, flag on | linked parent | `parentManaged: true`; Mark done on each open item only | N/A |
| Turn on / off | `setParentManaged` with `on=true`/`false` | RPC called with `p_student_id = params.id`, `p_on`; success toast; stays on overview | N/A |
| Toggle refused | RPC returns 42501 | `fail(403, { managedError })` | localized message |
| Toggle bad input | `on` missing or not `true`/`false` | `fail(400)`, no RPC call | localized message |
| Parent marks done | flag on, `instanceId` of the child's open item | insert `{instance_id, student_id: child, class_id, status:'done', recorded_by: parent}`; success toast; stays on homework | N/A |
| Mark refused | insert 42501 (flag off or not linked) | `fail(403, { error })` | localized "turn on managing first / not allowed" |
| Unknown instance | instance read fails | `fail(400, { error })` | existing not-found message |
| Not signed in | either action | redirect `/login` | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/parent/children/[id]/+page.server.ts`:
  - The profiles read is at :411 (`select('team_id')`). Add `parent_managed`.
  - The load return is at :500-518. Add `parentManaged`.
  - Actions are at :619-830. Copy `inviteParent` (:783-829) for the RPC action. Copy `setLeave` (:647-678) for the session, UUID and 42501 handling.
- `src/routes/parent/children/[id]/+page.svelte`:
  - Overview cards are at :420-695. Copy the deletion card form (:641-689, `action="?tab=overview&/requestDeletion"`).
  - The Homework tab is at :696-732.
  - The `homeworkList` snippet (:1285-1320) is shared by the open and done lists. Add a `canMark` parameter.
  - Toasts go in the `$effect` at :144-160. `createPending()` is at :90.
- `src/lib/components/MarkDoneForm.svelte` -- hardcodes `action="?/markDone"`. Add an optional `action` prop.
- `src/lib/server/student-homework.ts:362-412` -- `markHomeworkDone`. Add optional `studentId`. Error keys are `student_homework_error_*`. Student callers are at `student/+page.server.ts:110`, `student/homework/+page.server.ts:71`, `student/homework/[instanceId]/+page.server.ts:83` and `student/classes/[classId]/+page.server.ts:76`, and stay unchanged.
- `messages/en.json`, `de.json`, `bo.json` -- the `child_*` keys are around en :1057. Reuse `student_homework_mark_done*` for the button and confirm.
- `src/routes/parent/children/[id]/page.server.spec.ts` -- `fakeSupabase({linked, tables, rpc, insert})` (:18-110), `runLoad` (:162), `event` (:175). Invite action tests start at :1267.
- `e2e/parent-mobile.e2e.ts:109` -- `homework()` helper. `e2e/fixtures.ts` -- `linkParent` (:52), `signIn` (:364), `service` (:36).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/student-homework.ts` -- optional `studentId` param; `student_id: studentId ?? user.id`; map insert `42501` to a 403 with a parent-facing message only when `studentId` is given -- reuse without changing student behaviour.
- [x] `src/lib/components/MarkDoneForm.svelte` -- optional `action` prop, default `?/markDone`.
- [x] `src/routes/parent/children/[id]/+page.server.ts` -- load `parentManaged`; actions `setParentManaged` and `markDone` per the matrix.
- [x] `src/routes/parent/children/[id]/+page.svelte` -- overview "Homework for this child" card with state text and an on/off form; `homeworkList(items, canMark)` renders `MarkDoneForm action="?tab=homework&/markDone"` on open items when `data.parentManaged`; success toasts.
- [x] `messages/{en,de,bo}.json` -- `child_managed_*` keys (title, explanation, on/off button, saved toast, errors, mark-not-allowed).
- [x] `src/routes/parent/children/[id]/page.server.spec.ts` -- a test for every matrix row.
- [x] `src/lib/server/student-homework.spec.ts` -- `studentId` given gives a child insert; omitted keeps the old row.
- [x] `e2e/parent-managed-homework.e2e.ts` -- parent turns on, marks an open item done, it moves to Done; flag off shows no button.

**Acceptance Criteria:**
- Given a parent-managed child, when parent B opens the page, then B also sees the card on and the Mark done buttons.
- Given the student's own pages, when the student marks done, then behavior and tests are unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-30). verification-gap: no gaps.

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind | After a refused mark (other parent turned managing off), the On badge and Mark done buttons stay | medium | `use:enhance` doesn't reload data on `failure`; parents with two accounts will meet this | patch: invalidate on failure |
| 2 | blind, edge-case | Every parent 42501 says "turn on managing first", even when it's already on | low | The 42501 also comes from a missing `assigned` row or a removed link; the text is wrong there. Fix is a text change | patch: neutral wording |
| 3 | blind | The explanation says "you and the other parent" though many children have one parent | low | `child_managed_explanation` in en/de/bo; text correction | patch |
| 4 | blind | The e2e header claims "the button is gone" after turn-off, which isn't checked | low | The header doesn't match the test body; direct correction | patch: fix header |
| 5 | blind | `markHomeworkDone` comments still describe only the student path | low | The doc comment and the instance-read comment name the student policy only; direct correction | patch |
| 6 | blind, edge-case | A failed profile read shows the card as Off | low | Needs a DB error; the fix adds an error state and branch | rejected |
| 7 | edge-case, blind | Repeat `done` rows from stale pages, also after `reviewed` | low | `homework-status.ts:24-59` tracks each status separately with its earliest time, so extra `done` rows don't change any display. Already in `deferred-work.md` (story 1 #9) | rejected (deferred already) |
| 8 | edge-case | An unlinked parent gets 400 "not found" instead of 403 | low | True (instance read is RLS-gated), but the outcome is still refused, and an unlinked parent can't reach the page (`loadLinkedChild` 404) | rejected |
| 9 | edge-case | The toggle posts an absolute value from possibly stale data | low | Idempotent; the toast reflects what was set | rejected |
| 10 | blind | The bad `params.id` branch is untested | low | Copied UUID guard; unreachable via the page (404 on load) | rejected |
| 11 | blind | No inline Mark done error without JS | low | `MarkDoneForm` confirms through an AlertDialog, so the flow already needs JS | rejected |
| 12 | blind | The `MarkDoneForm` `action` prop is untested | low | The default is unchanged; the override is covered by the e2e URL assertion | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/parent-managed-homework.e2e.ts` -- expected: pass.
