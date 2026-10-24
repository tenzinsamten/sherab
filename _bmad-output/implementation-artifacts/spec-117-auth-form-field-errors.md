---
title: 'Sign-in forms show their errors at the field (#117)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
baseline_commit: '27a2b308cb5df9653b4f4c5a3c8a745100a89b8f'
route: 'dispatch'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On login, register, forgot password, reset password and resend confirmation, a failed submit shows its error only as a 5-second toast (the root layout's `fail({ error })` handler). No error stays next to the field and no field is marked `aria-invalid`, so slow readers miss it and cannot tell which field is wrong.

**Approach:** On these five pages, show the action's error in the form as well: under the field it belongs to (marked `aria-invalid`, `aria-describedby` pointing at the message), or, when it belongs to no one field, as one message above the submit button. The toast stays. Same pattern as `/account` and `/join`.

**Decisions (2026-10-24):** Split from #117: the admin create and rename forms (classes, teachers, teams) are deferred as #117b. Review loop 1: the inline message has no `role="alert"`, so screen readers hear the error once (from the toast); it stays visible and is linked with `aria-describedby`.

## Boundaries & Constraints

**Always:** Messages use `ui.error`, without `role="alert"` (the toast already announces the error once); ids `<field>-error` (form-level: `form-error`). The error goes away on the next successful submit or a different error, as `form` changes. Field values keep what they keep today. Login invalid credentials marks both fields (never says which one is wrong).

**Never:** No change to the root layout toast, the `+page.server.ts` actions or their texts, `/join`, `/account` or the admin forms. No pending state on the buttons (#118). No new message keys. The forgot-password "expired link" toast on load is not a form error and stays as it is.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Login wrong password | known email, wrong password | `login_error_invalid` above the button; email and password `aria-invalid`, described by it | toast too |
| Login unconfirmed | right password, unconfirmed email | `login_error_unconfirmed(_resent)` above the button, no field marked; resend link as today | toast too |
| Register mismatch | passwords differ | `reset_error_mismatch` under Confirm, Confirm marked | toast too |
| Register too short | password < 6 (no browser check) | `reset_error_length` under Password | toast too |
| Register exists | email taken | `register_error_exists` under Email | toast too |
| Register required / generic | invalid name or email, or server error | message above the button, no field marked | toast too |
| Forgot required / student | empty or a student's username | message under Email | toast too |
| Reset mismatch / length / failed | as named | under Confirm / under Password / above the button | toast too |
| Resend required | empty email | message under Email | toast too |

</frozen-after-approval>

## Code Map

- `src/routes/account/+page.svelte:37-48,96-100` -- the pattern to copy: `errorText` from `form.error`, `fieldError` maps a text (compared with `m.*()`) to a field id, `describedBy(id)`, an `error(id)` snippet with `<p id="{id}-error" class={ui.error}>`; inputs get `aria-invalid` / `aria-describedby`.
- `src/routes/(auth)/join/+page.svelte:19,129-133` -- the same under one field, with `role="alert"`.
- `src/routes/(auth)/login/+page.svelte` -- reads `form.email`, `unconfirmed`; never `form.error`. Server `login/+page.server.ts:28,46,52,63`: `login_error_required` (empty field: Email if `form.email` is empty, else Password), `login_error_unconfirmed`, `login_error_unconfirmed_resent`, `login_error_invalid`.
- `src/routes/(auth)/register/+page.svelte` -- `values` = failed `form`. Server `register/+page.server.ts:43-88`: `register_error_required`, `reset_error_length`, `reset_error_mismatch`, `register_error_exists`, `register_error_generic`.
- `src/routes/(auth)/forgot-password/+page.svelte` -- server: `forgot_error_required`, `forgot_error_student` (both Email).
- `src/routes/(auth)/reset-password/+page.svelte` -- no `form` prop yet; server: `reset_error_length`, `reset_error_mismatch`, `reset_error_failed`.
- `src/routes/(auth)/resend-confirmation/+page.svelte` -- server: `resend_error_required` (Email).
- `src/lib/components/PasswordInput.svelte` -- spreads props onto `Input`, so `aria-invalid` / `aria-describedby` pass through; `Input` already styles `aria-invalid`.
- `src/lib/components/AuthCard.svelte` -- `auth.field`, `auth.form` classes.
- `e2e/auth-mobile.e2e.ts:244-326` -- sign in, register, forgot/resend, reset tests that today check the toast; `e2e/auth-fields.e2e.ts:207-240` -- the join field-error checks to mirror.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/(auth)/login/+page.svelte` -- map the four errors per the matrix; message under a field or above the button; mark fields -- the fix.
- [x] `src/routes/(auth)/register/+page.svelte` -- same for its five errors (only on a failed `form`, not on the receipt).
- [x] `src/routes/(auth)/forgot-password/+page.svelte`, `reset-password/+page.svelte`, `resend-confirmation/+page.svelte` -- same; reset-password takes the `form` prop.
- [x] `e2e/auth-mobile.e2e.ts` -- in the existing sign-in, register, forgot/resend and reset tests, also assert the message under (or above) the field, `role="alert"`, and `aria-invalid` / `aria-describedby` on the marked field; one register case with too-short passwords bypassing `minlength` (as `/account` tests do) -- the matrix rows.

**Acceptance Criteria:**
- Given a wrong password on `/login`, when the toast has gone, then the error is still above the button and both fields are marked invalid.
- Given any of the five pages, when the next submit succeeds or fails differently, then the old message is gone or replaced.
- Given the page under Tibetan, when an error shows, then the inline message is the Tibetan text (the existing keys).

## Implementation Notes

- Verification additions (orchestrator): `src/routes/(auth)/form-errors.render.spec.ts` server-renders the five pages with each `form.error` and checks where the message lands (`role="alert"`) and which inputs carry `aria-invalid` / `aria-describedby`: covers the matrix rows the browser cannot reach (login unconfirmed and required, register required and generic, forgot required, reset failed) and AC 3 under Tibetan.

## Spec Change Log

- Loop 1 (2026-10-24): finding "screen readers announce each error twice" (toast live region + inline `role="alert"`). The user chose: inline message without `role="alert"`. Amended the frozen Always rule and Decisions. Known-bad state avoided: double announcement. KEEP: the placement logic and field marking on all five pages, the e2e and render tests (only their `role="alert"` checks change). Code not reverted: the decision removes one attribute per page.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind + edge | Error announced twice (toast live region + inline `role="alert"`) | medium | Sonner's toaster is a live region and the inline `<p role="alert">` renders in the same update; the frozen spec required both | intent_gap → user chose no `role="alert"` (loop 1) |
| 2 | blind + edge | Login: both fields empty marks only Email | low | Real only with browser checks bypassed; the server does not echo the password, so the page cannot know it was empty without a server change | reject |
| 3 | blind + edge | Marking stays while the user corrects the field | low | Matches the frozen rule (goes away on the next submit), as on `/account` | reject |
| 4 | blind | Placement compares translated texts | maybe-false | Server and page render in the same request's locale (as `/account`); a mismatch falls back to above the button, still shown | reject |
| 5 | blind | Focus not moved to the invalid field | low | Not in intent; adds behaviour after `enhance` | reject |
| 6 | blind | Register "required" marks no field | low | The server's required check covers name, email and password without saying which (frozen matrix row) | reject |
| 7 | blind | Pattern copied into five pages | low | Same per-page convention as `/account`; no named divergence | reject |
| 8 | blind | `/join` left out | false | `/join` already shows its class-code error under the field (`join/+page.svelte:129-133`) | reject |
| 9 | blind | Dead `'form'` branches on forgot/resend | false | They catch any unmatched text (e.g. a future error or locale mismatch), so the message still shows | reject |
| 10 | blind | Render-spec regexes depend on attribute order | low | Test maintenance only; a reorder fails loudly, not silently | reject |
| 11 | blind | Generic/required/failed errors untested in the browser | low | Covered by the render spec; verification-gap layer found no gap | reject |
| 12 | blind | Toast-gone wait may flake | maybe-false | 5 s toast vs 10 s expect timeout; the pointer rests on the submit button, not the toast | reject |
| 13 | verification-gap | No gaps | — | Every `fail()` error of the five actions is pinned by the render spec; replace/clear covered in e2e | — |
