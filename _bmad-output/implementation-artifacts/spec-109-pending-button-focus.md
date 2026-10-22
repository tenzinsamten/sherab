---
title: '#109 Focus returns to the pressed button after a page action'
type: 'bugfix'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
baseline_commit: 'acaac790f7832539dc539e7fb8decca4ae044ccc'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** While a page action runs, every action button gets `disabled={pending.busy}` (`createPending`, `src/lib/pending.svelte.ts`), and Chromium drops focus from a button that becomes disabled, so it falls to `<body>`. When the save finishes, keyboard and screen-reader users have lost their place: the next Tab starts from the top of the page (#109, found by the story 11 e2e probe).

**Approach:** Fix it once in `createPending`. It knows the pressed button: the submit function's `submitter`. When the action has finished and the buttons are enabled again, move focus back to that button. This only happens if focus was lost (it is on `<body>` or nowhere) and the button is still on the page. No change to how any page's buttons show their pending state.

## Boundaries & Constraints

**Always:**
- Restore focus only when `document.activeElement` is `<body>` or null after the action. Focus the user or the page moved elsewhere (a text field, a dialog's focus return, a new page after a redirect) is left alone.
- Restore only to a submitter that is still connected and no longer disabled. Wait for Svelte's `tick()` after `current = null`, so the button is enabled before `focus()`. Use `{ preventScroll: true }`, so the page does not jump.
- Restore on success and on failure (a `fail()` toast), since the user stays on the page either way.
- User decision (2026-10-22): restore focus after the action, centrally in `createPending`. During the save, focus may sit on `<body>`; the `disabled`/`aria-disabled` switch across all buttons is not done.
- Covers every `createPending` submit, including the wrappers (requests' `decide`, SyllabusFiles, EnrollmentPanel, MarkDoneForm) and confirm-gated submits.

**Never:**
- No change to the 70-odd buttons' `disabled`/`aria-busy` markup, to `createConfirm`, or to page markup.
- No focus move for a cancelled or declined submit (nothing was posted, and focus never left).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Save with mouse/keyboard | Press Save; slow POST; success | After the toast, focus is on Save | — |
| Server `fail()` | Save; action returns `fail(…, { error })` | Error toast; focus on Save | — |
| Button removed | Delete a row; its button leaves the DOM | Focus not moved (stays on body) | No throw |
| Redirect | Action redirects to another page | New page's focus; not moved | — |
| Focus moved meanwhile | User tabs into a field during the save | Focus stays in that field | — |
| Enter in a text field | Submit by Enter; field keeps focus | Focus stays in the field | — |
| `update()` throws | Network error | Focus restored if lost and button present | finally still runs |

</frozen-after-approval>

## Code Map

- `src/lib/pending.svelte.ts:39-52` (`start`):
  - Read `submitter` from the SubmitFunction input; it is `HTMLElement | null`.
  - In the returned callback's `finally`, after `current = null` and `actionEnded()`, call a small exported helper `restoreFocus(submitter)`. The helper does `await tick()`, then focuses the submitter if `document.activeElement` is `document.body` or null, `submitter?.isConnected`, and it is not `disabled`.
  - Guard `typeof document !== 'undefined'`.
- `src/lib/pending.spec.ts`: unit tests for `restoreFocus` with stubbed globals (`vi.stubGlobal('document', …)`; the server project runs in node). Cover lost focus restored, focus elsewhere kept, a disconnected or still-disabled button not focused, and null submitter. Add a `createPending` test showing the submitter is passed through (spy on a fake submitter's `focus`).
- e2e: add to `e2e/nav-progress.e2e.ts`, whose "slow page action" test already holds My account's Save name POST. After the toast, `document.activeElement` is the Save button. Add a `fail()` case with an empty name if the action rejects one; otherwise use another page's validation error. Matrix rows a browser can show: success, fail, Enter in a field.
- Not covered by design: `submitSkill` (`src/routes/teacher/classes/[id]/+page.svelte:186`) and the 4 signed-out auth forms, which don't use `createPending`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/pending.svelte.ts`: `restoreFocus` and the call in `start`'s `finally`.
- [x] `src/lib/pending.spec.ts`: the unit tests above.
- [x] e2e: focus back on Save after a slow success and after a `fail()`, and kept in the field after Enter.
- [x] `_bmad-output/manual-verification-issues.md`: mark #109 built.

**Acceptance Criteria:**
- Given any page action through `createPending`, when it finishes and focus was lost, then the pressed button has focus again and Tab moves on from it.
- Given the existing e2e suite, when it runs, then it passes unchanged, including the calendar's and admin's focus-return tests.

## Implementation Notes

- Finding (2026-10-22, e2e): on a **success** result SvelteKit's own `applyAction` calls
  `reset_focus` (`@sveltejs/kit` 2.70.3, `client.js`), which focuses `<body>`, before
  `update()` returns. So on success focus is always lost, whatever the user did; returning
  it only to the submitter broke the rows "Enter in a text field" and "Focus moved
  meanwhile" (focus ended on Save instead of the field).
- Change (coordinator, 2026-10-22): `start`'s callback records `document.activeElement` as
  the answer arrives, before `update()`. That is the field after Enter or after the user
  moved there, or `<body>` when the clicked button was disabled. `restoreFocus(before,
  submitter)` takes ordered candidates and, still only when focus is lost, focuses the
  first that is not `<body>`, is connected and is not disabled. So both rows hold on
  success and on `fail()`.
- Review fixes (2026-10-22): no focus return on a `redirect` or `error` result (the new page
  or error page sets its own focus, matrix row "Redirect"). `restoreFocus` tries each
  candidate in order and stops at the first that is `document.activeElement` after
  `focus()`, so one that cannot take focus (hidden, inert, disabled fieldset) falls through
  to the submitter.
- e2e: Enter in the field on a successful and a failed save; focus moved to the field
  during a slow successful save; Save keeps focus after a clicked success and fail().
- Final verification after the review patches (2026-10-22), after `npm run supabase:reset`: `npm test` exit 0 (1612/1612); `npm run check` 0/0; `npm run build` exit 0. e2e `nav-progress`, `calendar-mobile`, `teacher-mobile`, `forms` and `student-mobile` passed 137/137.

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Redirect or error result: focus pulled back from the new page's `<body>` when the submitter/field is still connected (blind, edge ×2) | medium | `update()` → `applyAction` → `_goto` (redirect) or `set_nearest_error_page` (error), both resetting focus to `<body>` on purpose; `restoreFocus` treats `<body>` as lost. Breaks the matrix "Redirect" row for same-route redirects or layout-hosted forms. | patch |
| 2 | A candidate passing the filter but unable to take focus (hidden, inert, disabled fieldset) blocks the fallback (blind, edge) | medium | `find` picks one element and calls `focus()` once; a no-op leaves `<body>`, the #109 symptom. Inline edit rows collapse on save. | patch |
| 3 | Refocusing a text field may reopen the Android soft keyboard after Enter-to-save (blind) | maybe-false | Desktop Chromium e2e cannot show it; would be medium if true. Settle on an Android device: Enter in My account's name field, check whether the keyboard reopens. | defer |
| 4 | Cancelled second submit path untested for "no focus move" (blind) | low | Real gap, a direct test. | patch |
| 5 | `fail()` e2e assertions can pass on a stale success toast (blind) | low | Only `toBeVisible()` on any toast; a direct assertion fix. | patch |
| 6 | Redirect and "Button removed" rows lack tests (blind) | low | Covered by #1's new unit tests (redirect) and the existing disconnected-element unit test. | patch (with #1) |
| 7 | Throwing `update()` with a field focused before is untested (blind) | low | Same code path as the tested success case; capture happens before `update()`. | reject |
| 8 | `restoreFocus` throwing in `finally` would mask the original error (blind, edge) | low | `tick()` does not reject and `focus()` does not throw on connected elements; no reachable throw shown. | reject |
| 9 | Deferred hash `reset_focus` (setTimeout) may clear restored focus (edge) | low | Only when `page.url` has a hash whose element exists; no action page here uses one. | reject |
| 10 | Pressed button still disabled by another instance's busy (edge) | low | Buttons use their own instance's `busy`; a cross-instance disable is not shown anywhere. | reject |
| 11 | AC says "pressed button" but Enter restores to the field (edge, claim) | false | The frozen matrix rows ("Enter in a text field", "Focus moved meanwhile") refine the AC; both frozen, consistent. | reject |
| 12 | An existing e2e test gained an assertion, not "unchanged" (edge, claim) | low | The added `toBeFocused` is the new behaviour's check; the test's prior assertions are unchanged. | reject |
| 13 | Spec and issues log missing from the diff (blind) | false | Deliberately outside the code diff; committed with `git add -A`. | reject |
| 14 | Unit-test factory naming and stub-identity dependency (blind) | low | Readability only. | reject |
| 15 | No test pins SvelteKit's `reset_focus` behaviour (blind) | low | `[autofocus]` focus is not `<body>`, so it is already respected; the e2e tests fail if the success path changes. | reject |
| 16 | `student-mobile.e2e.ts` focus flows not in the recorded verification (verification-gap, other) | low | Real evidence gap; added to the final verification run. | patch (verification) |

## Verification

**Commands:**
- `npm run supabase:reset && npm test && npm run check && npm run build`: all exit 0.
- `npx playwright test e2e/nav-progress.e2e.ts e2e/calendar-mobile.e2e.ts e2e/teacher-mobile.e2e.ts e2e/forms.e2e.ts`: pass.
