---
title: 'Auth pages'
type: 'feature'
created: '2026-10-20'
status: 'done'
route: 'dispatch'
baseline_commit: '77fac965337ce341b037d6a22203919a284a8b2b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signed-out users still see iX: the public header (`ix-application-header`, `ix-dropdown-button` language switch) and iX buttons/inputs on login, register, forgot/reset password, resend confirmation and auth confirm (SPEC CAP-3, CAP-5, CAP-6).

**Approach:** Rebuild these pages, the shared `AuthCard` and the signed-out header phone-first on the new system, following stories 3–5b. `AuthCard` moves now, so the signed-out home (`/`) changes with it. The join flow (join, join pending, `JoinSteps`) is story 6b (split at the scope gate).

## Boundaries & Constraints

**Always:**
- Keep data, loads, actions, redirects, messages, and every input's `type`, `name`, `id` and `autocomplete`, so iOS password managers keep working. Keep `PasswordInput` as it is (already new).
- Keep register's custom `use:enhance` (`update({ reset: false })`) and receipt card; `auth/confirm` stays a plain POST form without enhance (#89).
- Errors that are toasts today (app-wide `form.error`, forgot-password's expired link) stay toasts (`showToast`); login's confirm-link `role="alert"` line and resend's `role="status"` line stay inline.
- Each migrated page has its own `data-ui="new"` root with `data-hydrated`.
- Signed-out header at 375px: logo/name linking home and a language switch, no overflow, no truncation in en, de or bo. It reuses the signed-in shell's language menu (flags, locale switching), extracted into one component.
- `/reset-password` keeps rendering inside the signed-in shell (recovery session).
- Join and join pending look as today until 6b.

**Never:**
- No server, load, action, redirect or permission changes.
- No iX element or page-scoped `<style>` left in the migrated pages, `AuthCard` or the signed-out header.
- No change to the signed-in shell's look or behaviour.
- No Help screenshot regeneration (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Sign in | Valid email + password, 375px | Signed in, redirected as today | Wrong password → toast as today, email kept |
| Register | Name, email, matching passwords | Receipt card shown | Server error → toast, fields keep values |
| Forgot / resend | Email | Toast / `role="status"` line as today | Expired link → toast |
| Reset password | Recovery session, password twice | Saved as today, inside the signed-in shell | Mismatch / too short → toast |
| Auth confirm | Link opened | One button posts the form | — |
| Language switch | Signed out, pick de / bo | Page in that locale, header fits | — |
| Keyboard | Tab through any migrated page | Visible focus on every control, logical order | — |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte` -- signed-out branch `{:else}` (:268-294): `.app-public`, `ix-application-header` + `use:headerHomeLink`, `ix-dropdown-button` + `use:dropdownButtonLabelRoom`, `languageItems` snippet (:184-204), `localeFlags` (:33). Keep the `form.error` toast effect (:57-64) and PWA registration. Already in `@source`.
- `src/lib/components/shell/AppHeader.svelte` -- language DropdownMenu (:83-107); extract it (e.g. `shell/LocaleMenu.svelte`) for AppHeader and the signed-out header. AppHeader unchanged to the user.
- `src/lib/components/AuthCard.svelte` (26) -- styled by `src/app.css:497-570`; own root + utilities. Consumers: the migrated pages and `src/routes/+page.svelte`. Join and join pending still hold iX fields, which must not sit inside a `data-ui="new"` root (reset.css): until 6b they inline today's `.auth-page`/`.auth-card` markup instead of importing `AuthCard`, so keep those `app.css` rules.
- `src/routes/(auth)/`: `login` (65: ix-button, `#email` `username`, PasswordInput `#password` `current-password`, confirm-link alert :28); `register` (101: ix-input `#displayName` max 80, ix-button with local `submitting`, `#email` `email`, `#password`/`#confirm` `new-password` `minlength 6`); `forgot-password` (43), `reset-password` (36), `resend-confirmation` (38): one ix-button each.
- `src/routes/auth/confirm/+page.svelte` (27): ix-button, plain POST.
- Reuse the `account/+page.svelte` pattern (root :102, `hydrated` in `onMount`, label + `Input`, `ui.*` from `$lib/ui/classes`, `Button` with `aria-busy` + spinner); add `@source` lines in `src/lib/ui/tailwind.css` for each migrated file.
- e2e:
  - `e2e/fixtures.ts:327-336` `signIn` and `team-students.e2e.ts:324` wait for `ix-button`: wait for the hydrated root instead.
  - `e2e/auth-fields.e2e.ts`: register `#displayName` via `typeInto`/`#id input`; `.auth-card-header img` (:324); `ix-application-header a.header-logo` (:334-335). Join cases stay until 6b.
  - `e2e/ix-visual.e2e.ts:134-136` login shots: re-baseline.
  - `e2e/help-screenshots.e2e.ts:255-260, 280-286`: waits/selectors for `/login` and `/register` only.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/shell/` + `src/routes/+layout.svelte` -- extract the language menu; build the signed-out header from it, no iX.
- [x] `src/lib/components/AuthCard.svelte`, `src/routes/+page.svelte` -- new root and utilities.
- [x] `src/routes/(auth)/{login,register,forgot-password,reset-password,resend-confirmation}`, `src/routes/auth/confirm` -- rebuild per Always/Never.
- [x] `src/routes/(auth)/join`, `join/pending` -- inline today's card markup in place of `AuthCard`, nothing else.
- [x] `src/lib/ui/tailwind.css` -- `@source` for each migrated file.
- [x] e2e -- rework the Code Map selectors; new `e2e/auth-mobile.e2e.ts` covering each matrix row at 375 and 820px and the en/de/bo fit check per migrated page.

**Acceptance Criteria:**
- Given a migrated page at 375px in en, de and bo, when loaded, then `scrollWidth` ≤ viewport, every input and button is ≥44×44px, labels are visible and the header does not truncate.
- Given join and join pending, when loaded, then they look and behave as before (existing join e2e pass unchanged).
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | Signed-out home's Sign in / Join a class links never followed by a test | medium | patch | Pre-verified gap; only the fit check loads `/`, which never reads `href`. |
| 2 | edge-case | `expectFits` header checks pass silently on `/reset-password` (no public header) | low | patch | Query returns null there, so `headerFits`/`languageCut` default to pass. One-line fallback. |
| 3 | edge-case | `languageCut` can never fail (nowrap flex item) | low | patch | `scrollWidth > clientWidth` on a min-width:auto item is never true; add a right-edge check. |
| 4 | blind-hunter | 44px check skips the header's controls | low | patch | Query covers only `main` controls; CAP-6 header controls unmeasured. Widen the selector. |
| 5 | edge-case | Keyboard focus check passes on a resting box-shadow | low | patch | It tests for any outline/shadow on the focused element, not a change on focus. |
| 6 | blind-hunter, edge-case | Dead `ix-application-header` CSS block; stale "still iX" comments | low | patch | `grep ix-application-header src` hits only `app.css:74`; `PasswordInput.svelte:15`, `+layout.svelte:172` now false. Direct deletion/correction. |
| 7 | verification-gap | Register's in-flight disabled/aria-busy state untested | maybe-false | defer | Filed as defer: old iX `loading` was untested too; needs request interception. |
| 8 | blind-hunter | `leading-tight` on the auth `h1` overrides Tibetan's `line-height: 2` | medium | defer | Real (tailwind.css: a `leading-*` utility wins), but `ui.heading` puts `leading-tight` on every migrated page's h1 since story 3: a project-wide pattern, not this story's. |
| 9 | blind-hunter | Double tap on auth/confirm's button can spend the token twice | maybe-false | defer | Old page had the same undisabled `ix-button` in a plain POST; pre-existing. Needs a test with two quick POSTs. |
| 10 | blind-hunter | Login/forgot/resend/reset have no pending state | low | reject | Pre-existing (old ix-buttons had none); adding one is new behaviour. |
| 11 | blind-hunter | No focus move/announcement after register's receipt or resend status | low | reject | Pre-existing behaviour; fix adds new focus logic. |
| 12 | blind-hunter | Register display name lacks `autocomplete="name"` | low | reject | iX forced it off before; the spec keeps behaviour, and adding a hint is a new choice. |
| 13 | blind-hunter | Hydration wait selector copied into five e2e files | low | reject | Test-only duplication, no named breakage. |
| 14 | blind-hunter | Join pages under the new header have no fit or visual check | low | reject | Existing join e2e pass unchanged (AC 2); 6b covers them. |
| 15 | blind-hunter | Vertical clipping (scrollHeight) never checked | low | reject | Fix is a new test kind; #8 is deferred with its cause. |
| 16 | blind-hunter | Only login shots re-baselined, in the iX visual file | low | reject | Spec asks only for the login re-baseline; more baselines are new coverage. |
| 17 | edge-case | Test cleanup ignores a `profiles` lookup error | low | reject | Test-only, unlikely; leaks a test user at worst. |
| 18 | blind-hunter | Legacy `.auth-*` rules lack a "removed in 6b" note | false | reject | The inlined join markup carries the 6b comment, and story 6b in stories.yaml says to remove it. |
| 19 | edge-case | (merged into #6) dead `ix-application-header` block | low | patch | Same defect as #6. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone: sign in with a saved password (Keychain fills both fields); register and accept iOS's suggested strong password.
