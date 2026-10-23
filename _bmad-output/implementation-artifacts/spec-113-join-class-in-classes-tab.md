---
title: 'Join another class from the Classes tab'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '674bea670960977406ccced40df75eaa99137feb'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student asks to join another class from the "Join another class" card on their Dashboard (`/student`, #67), but it belongs with their classes (user, 2026-10-23: "currently enrolling for another class is at dashboard. it should be in the class tab").

**Approach:** Move the card (code field, send button, the list of pending and rejected requests with Dismiss) from `/student` to the Classes tab (`/student/classes`), below the class cards, unchanged in behaviour.

## Boundaries & Constraints

**Always:**
- Same behaviour as today: upper-casing as typed, error under the field (also without JavaScript), toast on sent and on dismissed, pending/rejected badges, Dismiss on rejected requests only, focus back to the field after a refused code.
- The card shows on the Classes tab whether the student has classes or not (also when the class list failed to load), and fits at 390 px without sideways scrolling.
- Help texts that say "on your Dashboard" (`help_student_7_body`, `help_faq_9_a`) name the Classes tab instead, in en, de and bo (Tibetan is the assistant's draft, recorded as unreviewed).

**Never:**
- No change to the join request database functions (`request_class_join`, `dismiss_class_join`, `my_class_join_requests`, 0031) or to how teachers approve (`/requests`).
- No change to the other Dashboard cards or to the tab bar.
- Decided (user, 2026-10-23): the Dashboard keeps nothing of the card, no link or hint; the help texts point to the Classes tab.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Send code | Valid code on `/student/classes` | Toast "request sent"; field cleared; request listed as pending | N/A |
| Bad code | Empty, unknown or too long | Nothing sent | Message under the field, code kept, field focused |
| Dismiss | Rejected request | Toast; request gone from the list | Failure: error toast |
| No classes | Student in no class | Empty state and the join card | N/A |
| Requests fail to load | `my_class_join_requests` error | Card shows the load-failed note; form still works | N/A |
| Dashboard | `/student` | No join card | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/student/+page.server.ts` -- `load` reads `my_class_join_requests` (:84-85) and returns `joinRequests`, `joinLoadError` (:115-120); actions `requestJoin` (:134) and `dismissJoin` (:163) use `$lib/server/class-join` (`MAX_JOIN_CODE_LENGTH`, `classJoinErrorMessage`, `classJoinDismissErrorMessage`, `StudentJoinRequest`). Move the read and both actions to `src/routes/student/classes/+page.server.ts` (load currently `loadStudentClasses`, `loadClassPeople`, `loadStudentHomework`; add the RPC to its `Promise.all`). `markDone` stays.
- `src/routes/student/+page.svelte` -- join card markup :204-~290 (`data-testid="join-card"`, `#joinCode`, `#joinCode-error`, `data-testid="join-requests"` / `join-request` / `join-status`), its state and form handling :37-70 (`refused`, `joinCode`, `joinCodeError`, `joinInput`, toasts `student_join_sent` / `student_join_dismissed`), `pending.submit`, `spinner`. Extract to `src/lib/components/JoinClassCard.svelte` (props: `form`, `joinRequests`, `joinLoadError`) and use it in `src/routes/student/classes/+page.svelte` after the class list and after the empty state; remove it and now-unused imports from the dashboard. Keep the test ids.
- `src/routes/student/classes/+page.svelte` -- 72 lines, no form handling yet; needs `form` from `PageProps`, `enhance`, and the page-action pending helper the dashboard uses.
- Tests: `src/routes/student/page.server.spec.ts` (join cases near :90, :116, :171, :184, :288) -- move to a new `src/routes/student/classes/page.server.spec.ts`; `e2e/class-join.e2e.ts` (`goto('/student')` :187, `join-card` :193), `e2e/student-mobile.e2e.ts` (:480-507, :861), `e2e/credentials.e2e.ts` -- point at `/student/classes`; dashboard asserts no `join-card`.
- `messages/{en,de,bo}.json` -- `help_student_7_body` (:1118), `help_faq_9_a` (:1138).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/JoinClassCard.svelte` (new) -- the card from the dashboard, unchanged behaviour -- reuse.
- [x] `src/routes/student/classes/+page.server.ts` -- join requests read, `requestJoin`, `dismissJoin` -- moved server logic.
- [x] `src/routes/student/classes/+page.svelte` -- render the card below the classes and with the empty state -- new place.
- [x] `src/routes/student/+page.server.ts`, `+page.svelte` -- remove the card, its read and actions -- old place.
- [x] `messages/*.json` -- help texts name the Classes tab.
- [x] `src/routes/student/classes/page.server.spec.ts` (new), `src/routes/student/page.server.spec.ts`, `e2e/class-join.e2e.ts`, `e2e/student-mobile.e2e.ts`, `e2e/credentials.e2e.ts` -- every matrix row at the new address.
- [x] `_bmad-output/manual-verification-issues.md` -- log #113 "built, to verify".

**Acceptance Criteria:**
- Given a student with a pending request, when they open Classes on a phone, then the card and the pending request show below the class cards without sideways scrolling.
- Given the existing join tests moved to `/student/classes`, when run on a reset database, then they pass.

## Implementation Notes

- Built 2026-10-23 by the implementation subagent. New `src/lib/components/JoinClassCard.svelte` (props `form`, `joinRequests`, `joinLoadError`), the dashboard markup and logic moved unchanged with its test ids; `requestJoin`, `dismissJoin` and the `my_class_join_requests` read moved to `src/routes/student/classes/+page.server.ts` with their own `joinLoadError`; the card renders after the class grid or the empty state.
- Tests: join action and load tests moved to the new `src/routes/student/classes/page.server.spec.ts`; the dashboard spec asserts no join read; e2e class-join, student-mobile and credentials point at `/student/classes`, plus "no join card on the dashboard".
- Phone tests run at 375 px and 820 px (375 is narrower than the 390 px in the spec). The help screenshot `student-7` (Classes tab) now includes the card and may need regenerating (`e2e/help-screenshots.e2e.ts` not run).

- Review pass 1 (2026-10-23): 4 patches (approval e2e scoped to the class cards; `/join` errors and help texts name “My classes”, bo given the same content as en; credentials e2e posts `id`), 1 deferred, 10 rejected.
- Verified after the patches on a reset database: `npm test` 1667 tests, `npm run check`, `npm run build` exit 0; after a second reset `e2e/class-join`, `student-mobile`, `credentials`: 34 passed.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-23). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| V1 | The approval e2e check on /student/classes can pass on the join card's request row | medium | Filed: `class-join.e2e.ts:376-377` uses unscoped `getByText(targetName).first()`; the card now shares the page | patch (test) |
| B1 | `/join` errors tell the student to use “Join another class” without saying where; after sign-in the Dashboard no longer has it | medium | `join_error_duplicate`, `join_error_already_student` (en.json:546-547) | patch (text) |
| B3 / E1 / B4 | Help names the page "Classes tab", but wide screens label it “My classes” (no tab); one paragraph uses both; de drops quotes; bo lacks "below your classes" | low | `nav.ts:142` long label `nav_my_classes`; en.json:1118 | patch (text) |
| B10 | Credentials e2e posts `requestId`, action reads `id` | low | `credentials.e2e.ts:216`; passes only because the guard refuses first | patch (direct correction) |
| B11 | Classes load uses UTC "today", the Dashboard Berlin | low | `classes/+page.server.ts` `toISOString().slice(0, 10)`, unchanged by this diff | defer (pre-existing) |
| B2 | Dashboard gives no route to joining | low | User decided the Dashboard keeps nothing (frozen) | rejected (intent) |
| B5 | Client component imports a type from `$lib/server` | low | Type-only import, erased at build; `ScheduleFields.svelte` does the same | rejected (pre-existing pattern) |
| B6 | Hard-coded element ids in the card | low | Moved unchanged; one card per page | rejected (low) |
| B7 | No render tests for the card or the Classes page | low | Covered by e2e (send, refuse, badges, dismiss, empty state, no-JS) | rejected (low) |
| B8 | New load spec does not assert localised names or `class_people` arguments | low | Same assertions as the moved dashboard spec; `pickLocalized` has its own tests | rejected (low) |
| B9 | Help screenshot `student-7` may not show the card | low | Doc artifact, opt-in run; noted in Implementation Notes | rejected (recorded) |
| B12 | Two e2e checks for "no join card on the Dashboard" | low | Harmless duplication | rejected (low) |
| B13 | Spec file missing from the diff | false | Excluded on purpose: the spec goes to the edge-case layer only | rejected |
| B14 | Issue log entry has no verification evidence | low | Recorded at the end of the build (step 5) | rejected (handled) |
| E2 | A Dashboard tab opened before deploy posts to removed actions (404) | low | Only across a deploy, one retry from the Classes tab fixes it | rejected (low) |

## Verification

**Commands:**
- `npm run supabase:reset` then `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npx playwright test e2e/class-join.e2e.ts e2e/student-mobile.e2e.ts e2e/credentials.e2e.ts` -- expected: all pass
