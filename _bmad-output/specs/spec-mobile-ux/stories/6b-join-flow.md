---
title: 'Join flow'
type: 'feature'
created: '2026-10-20'
status: 'done'
route: 'dispatch'
baseline_commit: '52ea13d306b1bbb90e4d6e1a8bde1079f677d8fb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/join` and `/join/pending` are the last signed-out pages on iX: iX inputs, checkbox, pills, buttons and `ix-workflow-steps`, in an inlined copy of the old auth card story 6 left behind (SPEC CAP-3, CAP-5).

**Approach:** Rebuild both pages on story 6's `AuthCard`, and `JoinSteps` as an accessible new-UI stepper, phone-first. Split from story 6 at its scope gate.

## Boundaries & Constraints

**Always:**
- Keep the flow and data: step 1 is client-only (`validate_class_code` RPC, code upper-cased as typed); step 3 posts `?/register` with the hidden `classId`, `className`, `classCode`, `registrationName` and the visible `guardianEmail`/`guardianConsent`, through today's `use:enhance` (`submitting`). The visible class-code and name fields keep their `id`s and stay without `name`.
- Keep today's behaviour: the class-code error under the field (`aria-invalid` + `aria-describedby`, wired by hand) plus its toast; step 2's Continue disabled until a name; step 3's submit disabled until email and consent, and while checking/sending; Back keeps typed values.
- Stepper: four steps, the current one `aria-current="step"`, finished ones marked done without colour alone; on `/join` a finished step is a button that goes back to it (not while checking or sending) and moves focus to that step's field; the polite progress announcement stays. Going forward moves focus as today (no change).
- Consent is a native checkbox in a ≥44px label row. Pills become `Badge`s (success on step 2, warning on pending).
- Join pending keeps the receipt (name, class), `CredentialFields` in `data-testid="join-credentials"`, the once-only note, and both footer actions (start over → `/join`, sign in → `/login`).
- Each page renders inside `AuthCard` (its `data-ui="new"` root, `data-hydrated`).

**Never:**
- No server, load, action, RPC or permission changes; no new client-side validation messages.
- No iX element, `$lib/ix-fields`, `componentOnReady`/`getNativeInputElement`, inline `style` or `<style>` left in either page or `JoinSteps`.
- No Help screenshot regeneration (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Step 1 | Lower-case valid code, 375px | Field shows it upper-cased; step 2 with the class badge | Empty / unknown code → error under the field + toast, `aria-invalid`, stays on step 1 |
| Step 2 | Name typed | Continue enabled → step 3 | Empty name → Continue disabled |
| Step 3 | Guardian email + consent | Posted with the hidden fields; join pending shows credentials | Server error → toast, email kept |
| Go back | Pick finished step 1 from step 3 | Step 1, code kept, focus in the code field | Not possible while checking/sending |
| Pending | Pending student, credentials once | Step 4 current, badge, receipt, credentials, two actions | No credentials → text without the sign-in promise |
| Fit | en, de, bo at 375 and 820px | No sideways scroll, ≥44px targets, stepper labels not cut | — |

</frozen-after-approval>

## Code Map

- `src/routes/(auth)/join/+page.svelte` (~210): state and `checkClassCode`/`goToConsentStep`/`goBack` keep; `goToStep` (:61-77) focuses via iX APIs → plain `focus()` after `tick()`; replace the inlined `.auth-page/.auth-card` markup (story 6) with `AuthCard title={m.join_heading()}`; ix-input `#classCode` (`onvalueChange` upper-cases and clears the error), `#registrationName`, `#guardianEmail name=guardianEmail type=email`; ix-checkbox `guardianConsent`; ix-pill success; ix-buttons (submit with `loading`, Back `variant=secondary`); `ixFieldError` (:113); inline style on `.check-list`.
- `src/routes/(auth)/join/pending/+page.svelte` (~80): inlined card → `AuthCard` (title, subtitle switching on `credentials`, `footer` snippet with two `Button href`s); ix-pill warning; receipt `<table>` with `th scope="row"` (keep the semantics, restyle with utilities); `<style>` `.credentials`.
- `src/lib/components/JoinSteps.svelte` (56): props `current`, `onselect` keep; `ix-workflow-steps` keyed by `current`, `<style>`. Rebuild as an `<ol>` with its own `data-ui="new"` root; labels `m.join_step_*`; `m.join_step_progress` live region.
- Reuse: story 6's `AuthCard` and its `auth` class set (`form`, `field`, `label`, `submit`, `link`), `ui/input`, `ui/button`, `ui/badge` (`success`, `warning`), the native checkbox row from `ScheduleFields.svelte`, `ui.error`.
- `src/lib/ui/tailwind.css`: `@source` lines for both join pages and `JoinSteps` (story 6 lists files one by one).
- `src/app.css:387-450` `.auth-page`/`.auth-card*` rules: only the join pages use them; delete them.
- e2e:
  - `e2e/auth-fields.e2e.ts`: `typeInto`/`#id input` (:22, 78-95, 154-162, 216, 234), `toHaveJSProperty('value')` (:79, 170-178), `ix-workflow-step(s)` incl. `aria-current`/`status`/`vertical` (:111-207), `.ix-invalid` (:218, 235), `#classCode input` focus (:169, 222), `customElements` waits (:54).
  - `e2e/credentials.e2e.ts:110-124` (`#x input`), `:191` (`ix-button` "Go to sign in").
  - `e2e/class-join.e2e.ts:434-447`.
  - `e2e/help-screenshots.e2e.ts:255` (`ix-button` wait) and `/join` shots: waits/selectors only.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/JoinSteps.svelte` -- new-UI `<ol>` stepper per Always.
- [x] `src/routes/(auth)/join/+page.svelte`, `join/pending/+page.svelte` -- rebuild on `AuthCard` per Always/Never.
- [x] `src/lib/ui/tailwind.css`, `src/app.css` -- `@source` lines; delete the dead `.auth-*` rules.
- [x] e2e -- rework the Code Map selectors to labels, roles and test ids; extend `e2e/auth-mobile.e2e.ts` with each matrix row at 375 and 820px and add `/join` and `/join/pending` to its en/de/bo fit check.

**Acceptance Criteria:**
- Given `/join` and `/join/pending` at 375px in en, de and bo, when loaded (and on each join step), then `scrollWidth` ≤ viewport, every input, button and step button is ≥44×44px and no stepper label is cut.
- Given a screen reader, when the step changes, then the progress announcement is read and the current step is exposed as `aria-current="step"`.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

- `JoinSteps`: one step per row (`<ol>`), so long de/bo labels wrap instead of being cut. A finished step shows a check mark instead of its number and is read as one message, `join_step_label_done({ label })` (en "{label}, done", de "{label}, erledigt", bo without the Latin comma): the button's `aria-label`, and on a plain done row a hidden copy beside the `aria-hidden` visible label.
- Step 3's form is `novalidate`: iX's fields never triggered browser validation, so native bubbles for the email/checkbox would be new client-side messages.
- The three visible fields keep iX's `autocomplete="off"` (and the code `spellcheck="false"`). The class code is upper-cased in the field on `input` (caret kept), skipped while composing and applied on `compositionend`; `autocapitalize="characters"` for iOS.
- `auth-mobile` `expectFits` measures a checkbox by its label row (the ≥44px tap target); `expectStepsFit` checks each `[data-step-label]` box stays inside its row.
- `help-screenshots.e2e.ts` `open()`: a migrated page waits for its hydrated new-UI root, only an iX page (no such root) for iX to load.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind-hunter | Native join fields lost iX's forced `autocomplete="off"`; guardian email may autofill the student's own address | medium | patch | Old fields were ix-inputs (autocomplete off); new `Input`s set none. Direct attribute restore keeps today's behaviour. |
| 2 | blind-hunter, edge-case | Upper-casing rewrites the value mid-IME-composition | medium | patch | `onClassCodeInput` writes `input.value` on every `input` event with no `isComposing` check; new code (iX did this internally). |
| 3 | blind-hunter, edge-case | Done-step name built as "{label}, {done}": stray space on non-button rows, Latin comma in bo | low | patch | Plain row uses an sr-only ", done" span; button joins with a hard-coded comma. One message with a placeholder fixes both. |
| 4 | verification-gap | Caret-keeping in the class-code upper-casing never tested mid-string | medium | patch | Pre-verified gap; every test types at the end. |
| 5 | blind-hunter | `expectStepsFit` label check can't fail; one-shot step reads may flake | low | patch | `wrap-break-word` span never overflows sideways; mixed `expect(await …)` vs `expect.poll`. |
| 6 | blind-hunter | help-screenshots still waits on `ix-button` | low | patch | Passes only because iX loads globally; breaks in story 10. Code Map listed it. |
| 7 | blind-hunter | Focus falls to body after Continue / sending / server error | medium | defer | Pre-existing: old page never moved focus forward; spec says no change. |
| 8 | blind-hunter | Step 2 is not a form, so Enter/Go does nothing on the name step | low | defer | Pre-existing (old step 2 had no form either). |
| 9 | blind-hunter | Class code stored and posted with surrounding spaces | low | defer | Pre-existing: old `classCode` also kept the untrimmed value. |
| 10 | edge-case | Code editable while `validate_class_code` is in flight | maybe-false | defer | Pre-existing (old ix-input stayed enabled); needs a test editing mid-request to confirm the mismatch. |
| 11 | blind-hunter | Stepper `<ol>` has no accessible name | low | reject | Old `ix-workflow-steps` had none either; adds new copy. |
| 12 | blind-hunter | Instructions only in placeholders / hints not linked | low | reject | Pre-existing markup; linking is new behaviour, little everyday harm. |
| 13 | blind-hunter | No visual baseline for /join and /join/pending | low | reject | Spec asks for none; e2e fit checks cover layout. |
| 14 | blind-hunter | `JoinSteps`' nested new-UI root is redundant; comments stale | low | reject | Harmless; `CredentialFields` still needs its root on iX pages (EnrollmentPanel, admin/teachers). |
| 15 | edge-case | `toUpperCase` length change (ß→SS) misplaces the caret | low | reject | Class codes are six ASCII characters; unlikely, guard adds a branch. |
| 16 | edge-case | Test setup ignores a 0-row `parents` update | low | reject | Test-only; would surface as a later failing assertion. |
| 17 | edge-case | Test cleanup cascades when a student delete fails | low | reject | Test-only data leak at worst. |
| 18 | edge-case | Removed 360px join overflow test | low | reject | Spec sets 375/820px; the fit check walks every step at both. |
| 19 | edge-case | Consent checkbox is 20px, AC met only via its label row | false | reject | Spec Always: "native checkbox in a ≥44px label row"; the label row is the tap target by design. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone: join a class through all three steps, go back from step 3 to step 1 by tapping the stepper, and check the code field gets focus with the keyboard up.
