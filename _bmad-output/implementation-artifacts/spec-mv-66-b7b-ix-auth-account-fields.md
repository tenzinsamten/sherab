---
title: 'B7b — iX form fields, part 1b: auth pages and /account (#66)'
type: 'refactor'
created: '2026-09-28'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The auth pages and /account still use native fields where iX fields could be used, so they look inconsistent with the iX UI (#66, split from B7).

**Approach:** Convert the non-credential fields to `ix-input`: register `displayName`, account `displayName` and its read-only username/email display, join `classCode`, `registrationName` and `guardianEmail`. Credential fields (login email/password, register email/password/confirm, forgot-password email, reset-password password/confirm, account current/new/confirm password, and the hidden `username` autocomplete helper) stay native, because `ix-input` hard-codes `autocomplete="off"` (user decision 2026-09-28, option A). Keep field names, server actions and `/join`'s current three-step layout (workflow steps are B9). Reuse `src/lib/ix-fields.ts` and B7's patterns (`value` + `onvalueChange` instead of `bind:value`; `ixFieldError` for invalid state).

</frozen-after-approval>

## Implementation Notes

2026-09-28:
- `src/routes/account/+page.svelte`: `displayName` → `ix-input` (name, `max-length="80"`, `required`, value from `data`). The read-only username/email display → `ix-input readonly` (no name). The hidden `username` autocomplete helper and all password fields stay native.
- `src/routes/(auth)/register/+page.svelte`: `displayName` → `ix-input`. Email, password and confirm stay native. The form already uses `update({ reset: false })`, so the missing iX reset is not an issue.
- `src/routes/(auth)/join/+page.svelte`: `classCode`, `registrationName` and `guardianEmail` → `ix-input`, with `value` + `onvalueChange` in place of `bind:value`.
  - The class code is uppercased in the handler.
  - The invalid code state uses the `ix-invalid` class (the message stays the toast, as before).
  - `guardianEmail` keeps `name` and `type="email"`.
  - The three-step layout is unchanged (B9).
- Dropped: `autocomplete="name"` (display/registration name) and `autocomplete="email"` (guardian email), because ix-input forces `autocomplete="off"`. These are not credentials, so option A leaves them converted. On /join the class code's `aria-invalid` is replaced by the iX invalid class; the toast still announces the error.
- `ix-fields.ts` helpers were not needed. These fields have no server field errors, and their values are either user-owned state or come from reloaded data on reset-free forms.
- New `e2e/auth-fields.e2e.ts` covers three flows. /join: uppercase code, step gating on name, email + consent, and the invalid code state. /account: display name prefill, save and reload. It passed 3/3 on a freshly reset DB.
- Review fixes:
  - /account `displayName` now sets its value via `ixValue`, so a password-form save no longer overwrites an unsaved name.
  - The /join class code error is a light-DOM `.field-error` (`role="alert"`) linked with `ixFieldError`. The step-1 form is `novalidate`: iX's own validation otherwise sets the control's `aria-describedby` on change/blur and replaces the link (noted in `ix-fields.ts`).
  - The comments beside the native credential fields now name the `autocomplete="off"` reason.
  - e2e: register posts `displayName`, /join step 3 posts `guardianEmail` and `registrationName` (captured and aborted), and the class code has aria-invalid plus a linked description.
  - `toHaveAccessibleDescription` doesn't follow cross-shadow element references, so the tests read `ariaDescribedByElements` as B7's tests do.
- Verification: `supabase:reset` 0 → `npm test` 650/650 → `check` 0 errors → `build` 0. Reset again → `test:e2e` 29/29.

## Review Triage Log

- medium · patch — /account `displayName` template `value=` is re-applied when the password form's save reloads `data`, which overwrites an unsaved name. Fixed with `ixValue`.
- medium · patch — The /join class code lost `aria-invalid` and had no linked message, contrary to the intent's "`ixFieldError` for invalid state". Fixed; the form is `novalidate` so iX doesn't replace the link.
- medium · patch — Register `displayName` posting via form association was untested. Added an e2e test.
- medium · patch — /join step 3 never submitted, so posting `guardianEmail` was untested. Added an e2e test.
- low · patch — The comments gave the wrong reason for keeping native fields. Now they name `autocomplete="off"`.
- low · rejected — Dropped `autocomplete` on the name and guardian email fields. Re-adding it on the shadow input would be undone by iX re-renders. The user accepted this trade-off in option A.
- low · rejected — The student read-only username is untested. It is display-only and has no `name`, so nothing is posted.
- maybe-false · rejected — Uppercasing may move the caret. The native field had the same value round-trip. It would only be low; settle it by editing mid-string in a browser.
- false — The spec record was incomplete. It is finalized here.
- low · rejected — The account test renames the fixture teacher. It is the last test in the file, and the fixture is deleted in `afterAll`.
