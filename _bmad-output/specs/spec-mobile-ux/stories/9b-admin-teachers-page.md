---
title: 'Admin teachers page'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
baseline_commit: 'f58062403a46e61da0e1d3d7d57e8cfe0603ce16'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/admin/teachers` is the last admin page still on iX: iX inputs and checkboxes, iX modals and an `ix-message-bar` for the one-time password, plus a table that scrolls sideways on a tablet. It was split off from story 9 (SPEC CAP-8).

**Approach:** Rebuild it the way story 9 rebuilt `/admin/classes`:
- a `data-ui="new"` root;
- stacked cards below `xl` (80em) and a full table from 80em;
- native fields and a native checkbox list;
- `createConfirm` + `ConfirmDialog` for confirms;
- the Requests outcome box for the one-time password.

Every teacher action stays reachable.

## Boundaries & Constraints

**Always:**
- Keep every posted field and action:
  - `?/create` (`email`, `displayName`, `classIds`) with the B14b promote flow: a `promotable` result asks, and OK resubmits the same values with `promote=1`.
  - `?/updateClasses` (inline per row via `editingId`), `?/resetPassword` and `?/remove` (`teacherId`).
- Keep every toast and confirm message:
  - the remove question and the removed toast differ when the teacher is also a parent;
  - a failed create keeps the typed email, name and checked classes;
  - a successful create empties the form;
  - with no classes, the create card shows its "add a class first" text.
- Confirm buttons:
  - Remove: `destructive`, labelled Remove.
  - Reset password: not destructive, labelled Reset password.
  - Promote: not destructive, labelled Make teacher.
- Every confirm message reads the row's current name at submit time (story 9's lesson).
- The one-time password (create or reset) uses the Requests outcome box (`role="status"`, success style) with `CredentialFields`. It stays until the next result and scrolls into view.
- "Also a parent" is a `Badge` (`outline`).
- Sizing and layout: buttons, fields and checkboxes are ≥44px (`ui.touch`) with visible labels. Nothing scrolls sideways at ≤820px. At ≥1280px the page shows the full table with the side nav.

**Never:**
- No server, load, action, route, permission, message-key or tour-registry changes.
- No iX element, `$lib/ix-fields`, `confirmAction` or `<style>` left in the page. `showToast` from `$lib/ix` stays until story 10.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create | Email, name, one class | Outcome box "Teacher account created for …" with email and password; row appears; form (incl. checkboxes) empty | Existing teacher email → error toast, email/name/classes kept, nothing created |
| Promote | Email of an approved parent-only login | Confirm "Make them a teacher too?"; Make teacher → `promote=1` posted, toast, row with "Also a parent", no password box | Cancel → nothing changes, no toast |
| Edit classes | Edit classes, toggle, Save | `classIds` posted, toast, row shows the new classes, edit closes | Cancel → nothing posted |
| Reset password | Reset password, confirm | Outcome box "…reset…" with the new password | Cancel → nothing |
| Remove | Remove, confirm (red) | Row gone, toast; also-a-parent → "parent account is kept" question and toast | Cancel → nothing |
| No classes | No classes exist | Create card shows its text, no form | — |
| Fit | 375 / 820 / 1440px, en/de/bo | Cards below 80em and a table from 80em; no sideways scroll at ≤820px | — |

</frozen-after-approval>

## Code Map

- `src/routes/admin/teachers/+page.svelte` (322): the only page.
  - `ix-input` `#email` and `#displayName` with `ixValue` echo; `ix-checkbox name="classIds"` in the create form and the edit row.
  - The `createKey` remount: drop it, since native fields reset with the form.
  - `confirmPromotion` (tick + `requestSubmit` with `promote`).
  - `runConfirmed` via a hidden form with a dynamic `action`: becomes a form per row action.
  - `ix-message-bar` credential; `ix-pill`; `.page-counter`.
  - Keep the `$effect` toasts and `credential` derivation.
- `src/routes/admin/teachers/+page.server.ts`: read only. Result shapes: `promotable`, `promoted`, `success` + `tempPassword`, `reset` + `tempPassword`, `updated`, `removed` + `keptParent`, `error`. Do not change it.
- Copy from story 9 (`f580624`):
  - `src/routes/admin/classes/+page.svelte`: table/card constants, `cardLabel`, inline edit row, per-row action forms, inline lazy `confirm: () => confirm.ask(…)`, `page-counter`, `data-hydrated`.
  - Outcome box: `src/routes/requests/+page.svelte:351-367` (`bind:this` + scroll after `tick()`).
  - Native checkbox: `ScheduleFields.svelte`.
- `src/lib/ui/tailwind.css`: add `@source '../../routes/admin/teachers/*.svelte';` and update the story 9 comment.
- e2e:
  - `forms.e2e.ts:~650-700`: `ix-input` waits, `locator('input')`, `toHaveJSProperty`, `ix-message-bar`.
  - `parent-access.e2e.ts:166-235`: `ix-checkbox`/`ix-input` waits, `#email input`, `ix-checkbox[value]`, `ix-modal`.
  - `teacher-mobile.e2e.ts:1993`: add `/admin/teachers` to `ADMIN_PAGES`.
- Unit: add `src/routes/admin/teachers/page.render.spec.ts`, copying `admin/classes/page.render.spec.ts`.
- Do not change: `+page.server.ts`, `page.server.spec.ts`, `messages/*.json`, `ix-toast` locators.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/admin/teachers/+page.svelte` -- new root, native fields, checkbox list, card/table, per-row forms with lazy confirms, promote confirm, outcome box -- CAP-8.
- [x] `src/lib/ui/tailwind.css` -- `@source` line -- the classes are collected.
- [x] `src/routes/admin/teachers/page.render.spec.ts` -- the new root with no iX, row actions present, Also a parent badge, the no-classes text, the empty list -- render coverage.
- [x] `e2e/forms.e2e.ts`, `e2e/parent-access.e2e.ts` -- native selectors, `confirm-dialog`, outcome box; also assert the checkboxes are cleared after create, the reset password box, and Cancel on reset and remove -- matrix rows.
- [x] `e2e/teacher-mobile.e2e.ts` -- `/admin/teachers` in the admin pages fit loops, plus a 820px card test: edit classes (Cancel, then Save), and remove a teacher -- fit and card actions.

**Acceptance Criteria:**
- Given an admin at 1440px, when they open `/admin/teachers`, then they see the side nav and the full table, and no `ix-*` element renders inside `main`.
- Given an admin at 820px, when they open `/admin/teachers`, then each teacher is a card with Edit classes, Reset password and Remove reachable, and `scrollWidth ≤ clientWidth`.
- Given the teachers list after another action's result (create, edit classes, reset), when the admin presses Remove on a row, then the question names that row's teacher and posts that row's `teacherId`.

## Design Notes

- The table constants are copied, as in story 9. There are now five copies. Extracting a shared module is left to story 10's cleanup, so this story does not touch the four migrated pages.
- Promote: on a `promotable` result, `confirm.ask(m.teachers_promote_confirm(), m.teachers_promote_submit())`. On OK, set `promote = true`, `tick()`, `createForm.requestSubmit()`, as today. The failed 409 result does not reset the form, so the values are still there.

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all exit 0.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: all pass except the known Reset PIN failure (`teacher.e2e.ts:1284`).

**Manual checks:**
- On an iPad at 820px and a laptop at 1440px in en and bo: create a teacher with two classes, edit their classes, reset their password, then remove them.

## Implementation Notes

- The create form's email, name and class checkboxes take their values from three `$derived` echoes of a failed create (same conditions as the old `ixValue`/`checked` expressions); a success resets the native form, so `createKey` is gone.
- Reset password and Remove are a form per row, each with a lazy `confirm: () => confirm.ask(…)` reading `teacher` at submit time; the hidden dynamic-action form and `runConfirmed` are gone.
- The outcome box has `data-testid="teachers-outcome"`; rows carry `data-testid="teacher-row"` and `data-teacher-id`, the edit row `teacher-edit-row`, the create card `teacher-create`.
- The class checkboxes share one snippet between the create form and the edit row (ScheduleFields' label style, a full-width ≥44px row each).
- The create form is `novalidate` (as /admin/classes), so an empty email or no class gets the server's toast.

- Review patches: Save classes posts with `{ reset: false }` (no checkbox flash); e2e asserts the reset password box is in view at 820px and that reset/remove post the row's `data-teacher-id`.
- Verified 2026-10-22 after a reset: `npm test` 99 files, 1579 tests; check, eslint, Prettier and build exit 0; e2e 353 passed, 4 skipped, 1 failed (the known Reset PIN, `teacher.e2e.ts:1284`).

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | edge-case | Edit-row checkboxes flash to unchecked after a successful Save classes | low | patch | `forms.js:100-105` resets the form before `invalidateAll()`; the edit row is client-rendered, so `defaultChecked` is false. Fix is `{ reset: false }`. |
| 2 | edge-case | Another action's result clears a failed create's echoed values | low | reject | The `createdEmail`/`createdName`/`createdClassIds` derivation matches the old `ixValue` echo (pre-existing); same verdict as story 9 #4. |
| 3 | edge-case | Test cleanup drops the login from `userIds` if the lookup errors | low | reject | Test-only; needs a failing local DB read, and the fix adds a guard. |
| 4 | verification-gap | Password box scroll after Reset password not verified | medium | patch | Pre-verified: only the create path has `toBeInViewport` (`forms.e2e.ts:704`); reset is pressed on a row far below the box. |
| 5 | blind-hunter | Password box can't be dismissed | false | reject | The old `ix-message-bar` was `persistent`, which in iX disables the close button (`message-bar.d.ts:12`); the box stays until the next result in both versions. |
| 6 | blind-hunter | Row action wipes a half-filled create form | low | reject | Same as #2. |
| 7 | blind-hunter | forms.e2e reset/remove `teacherId` only compared to each other | low | patch | Passes if both target the wrong teacher; comparing against `data-teacher-id` is direct. |
| 8 | blind-hunter | Scroll into view tested only after create | medium | patch | Same as #4. |
| 9 | blind-hunter | Render spec only renders `form: null` | low | reject | The failed-create echo, outcome box (create and reset) and edit row are asserted in `forms.e2e` and `teacher-mobile.e2e`; SSR can't open the edit row. |
| 10 | blind-hunter | Promote e2e doesn't record posts; one `tr` locator left | low | reject | The role turning `teacher` after Make teacher proves `promote=1` (without it the server returns `promotable` again); the `tr` locator still matches the row. |
| 11 | blind-hunter | Inline edit row has no focus handling | low | defer | Pre-existing; already deferred for classes and teams in story 9. |
| 12 | blind-hunter | `role="status"` mounted filled may not be announced | low | reject | Same shared Requests outcome pattern as story 8 #18; changing it is a shared-pattern decision. |
| 13 | blind-hunter | Spinner snippet used once, inline elsewhere | low | reject | Cosmetic; no named harm. |
| 14 | blind-hunter | Badge assertion relies on Badge's class string | low | reject | Same style as the story 9 render specs; breaks only if `badge.svelte` changes. |
| 15 | blind-hunter | Spec gaps (de manual check, 1440 edit row AC, empty logs) | low | reject | Fixes edit this spec. |
| 16 | blind-hunter | `tailwind.css` comment muddled | low | patch | Direct rewording. |
