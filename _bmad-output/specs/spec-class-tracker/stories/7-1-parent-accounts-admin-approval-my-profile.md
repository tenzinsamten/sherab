---
title: '7-1 Parent accounts, admin approval & My Profile'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c607c7a7a449db636c7755e586e1d27a4eba6c15'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sherab has no Parent role. Stories 7-2 to 7-6 need a parent account that is confirmed and approved by the admin, and they need one way to ask "is this login an approved parent".

**Approach:**
- A visitor registers as a parent with an email and password, then confirms the email.
- Only the admin approves or rejects them, in an admin-only section of `/requests`.
- Parents get My Profile.
- Parent capability lives only in a `parents` row (AD-4), read through `is_parent()` in SQL and `getCapabilities()` in SvelteKit.

## Boundaries & Constraints

**Always:**
- **Where parent capability lives:** only in an **approved** `parents` row. The row has PK = FK to `profiles.id` with on delete cascade, `status` of `pending`/`approved`/`rejected`, plus `created_at`, `reviewed_by` and `reviewed_at`. It is never inferred from `profiles.role`. `profiles.role = 'parent'` marks a parent-only login.
- **Sign-up:** clients may self-assign only `student` or `parent`, and 0020 keeps refusing everything else. A `parent` sign-up creates the `parent` profile and a `pending` parents row in the same transaction.
- **Duplicate emails:** a registration whose email already has any login creates nothing and shows one generic message: "An account with this email already exists. Sign in instead." It never names the role.
- **Approval rules:**
  - Only `is_admin()` may change `parents.status` (RLS).
  - Approval is refused unless the login's email is confirmed (`profiles.email_confirmed_at`).
  - Rejection is always allowed. It deletes the parent-only auth user, and the profile and parents row go with it by cascade, so the email can register again.
- **Who can read `parents`:** the owner and the admin, nothing else. Teachers and `anon` get nothing.
- **Helpers:**
  - `is_parent()`: an approved row exists for `auth.uid()`. It is security definer, uses `search_path = ''`, and has explicit revokes and grants.
  - `getCapabilities()` in `src/lib/server/`: returns `{ role, parentStatus }`. Route guards use it, never `profiles.role` alone.
- **`/requests`:**
  - The admin sees a "Parents" section listing pending parents (name, email, confirmed or not) and decided parents. Approve is disabled while the email is unconfirmed.
  - Pending parents count in the admin's nav badge.
  - Teachers see no parent section and no parent count.
- **Parent landing (`/parent`):** a parent-only login lands here. An unconfirmed parent sees "Confirm your email", and a pending parent sees "Waiting for approval", with no student data. An approved parent sees an empty "No children linked yet" state until 7-2.
- **My Profile (`/account`):** a parent can edit their display name, change their password and use forgot-password. The email is read-only.
- **i18n:** every new string is added in en, de and bo.

**Never:**
- **Out of scope:**
  - Dual role (teacher/admin with parent capability), the role switcher and promotion. These are deferred.
  - Student linking, `parent_id`, `is_parent_of()` and any child data (7-2/7-3).
  - Leave and deletion requests.
  - Production SMTP (deferred).
- **Forbidden:**
  - Teacher-visible parent data.
  - Any client write path to `profiles.role`.
  - Edits to old migrations.
  - Pushing to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register | new email + password + name | profile `parent` + parents `pending`; confirmation mail; receipt "Check your email" | N/A |
| Existing email | email of any existing login | nothing created | generic "already exists" form error |
| Confirm | valid signup link | email confirmed → `/parent` "Waiting for approval" | expired/invalid → login with error message |
| Approve unconfirmed | admin approves before confirmation | refused | form error |
| Approve | confirmed + admin | `approved`, `reviewed_by/at` set; `is_parent()` true | N/A |
| Reject | admin rejects | auth user deleted; same email can register again | N/A |
| Parent edits own row | parent updates `parents.status` | refused by RLS | N/A |
| Teacher reads parents | teacher selects `parents` | 0 rows | N/A |
| Crafted sign-up | user_metadata role `admin`/`teacher` | refused (0020) | sign-up rolls back |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0001_init.sql:28,38,86,104` -- `user_role` enum (no `parent`), `profiles.role`, `is_admin()` pattern.
- `supabase/migrations/0006_guardian_email_verification.sql:~40,114` -- `profiles_student_fields_check` keeps status/review cols student-only, so parent state goes in `parents`. `sync_email_confirmed_at()` mirrors confirmation for every role; use it for the approval check.
- `supabase/migrations/0020_signup_role_from_app_metadata.sql` -- `handle_new_user()` deferred constraint trigger. Extend it: app_metadata `parent`, or user_metadata ∈ {`student`,`parent`}; parent inserts the pending row. Keep the rest verbatim.
- `src/routes/(auth)/join/+page.server.ts`, `src/lib/server/signup-duplicate.ts:28` -- `signUp` + duplicate pattern to mirror.
- `src/routes/auth/confirm/+server.ts` -- recovery only; add a signup/email `verifyOtp` branch → `/parent`.
- `src/lib/server/password-reset.ts` -- skips students only, so it already works for parents; update the "until the parent-account story" comment.
- `src/lib/supabase/admin.ts` -- service-role client for the email lookup and reject delete.
- `src/lib/role-home.ts` (+ spec) -- add `parent` → `/parent`.
- `src/routes/+layout.server.ts:29`, `+layout.svelte:58-110,172-179` -- badge count (admin: add pending parents), `navItems` (add a parent block), `/account` item.
- `src/routes/admin/+layout.server.ts:16` -- `parent()` gate pattern for `src/routes/parent/+layout.server.ts`.
- `src/routes/account/+page.server.ts:50` -- add `parent` to the `requireRole` lists and the email branch of `load`; `page.server.spec.ts` shows the mock style.
- `src/routes/requests/+page.server.ts` (load, `approve` :97, `reject` :237), `+page.svelte:92,189-191` -- queue, `<ix-pill>` chips, `fail`/`success` toast contract. Add parent load + `approveParent`/`rejectParent` actions, admin-checked.
- `src/lib/server/rls.spec.ts:29-60,337-470` -- `adminClient`, `createSignedInUser`, #50 block. **Line 463 asserts app_metadata `parent` is refused; flip it.**
- `src/lib/supabase/database.types.ts` -- regenerate.
- `messages/{en,de,bo}.json` -- flat snake_case keys.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0022_parent_role_enum.sql` -- add `'parent'` to `user_role`.
- [x] `supabase/migrations/0023_parents.sql` -- `parents` table + RLS (owner/admin select; admin-only update with confirmed-email check; no client insert/delete); `is_parent()`; updated `handle_new_user()`.
- [x] `src/lib/server/capabilities.ts` (+ spec) -- `getCapabilities()`.
- [x] `src/lib/role-home.ts` (+ spec) -- parent home.
- [x] `src/routes/(auth)/register/+page.{server.ts,svelte}` -- parent registration + receipt; link from the login page.
- [x] `src/routes/auth/confirm/+server.ts` -- signup branch.
- [x] `src/routes/parent/+layout.server.ts`, `+page.{server.ts,svelte}` -- guard + status/empty states.
- [x] `src/routes/requests/*` -- admin-only Parents section, approve/reject; reject deletes the auth user via the service role.
- [x] `src/routes/account/*` -- parent support.
- [x] `src/routes/+layout.{server.ts,svelte}` -- parent nav, admin badge.
- [x] `messages/{en,de,bo}.json` -- new keys.
- [x] `src/lib/server/rls.spec.ts` -- `describe('7-1 parents')` covering every I/O matrix row except Confirm; flip line 463.

**Acceptance Criteria:**
- Given a pending or unconfirmed parent, when they sign in, then they land on `/parent` with the matching status, and no student, class or homework rows are readable.
- Given a parent on `/account`, when they change their name or password, then it saves, and the email is shown read-only.
- Given a teacher, when they open `/requests`, then no parent section or parent count appears.
- Given the full suite against local Supabase, when `npm test` runs, then existing and 7-1 tests pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-26; blind B, edge-case E, verification-gap V):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1/E13 | "Unconfirmed" /parent state unreachable; AC says unconfirmed parent lands on /parent | low | `enable_confirmations = true`: GoTrue refuses sign-in, login shows `login_error_unconfirmed` instead. Code is harmless defensive; the fix would edit the spec's AC | reject |
| B2/E4 | Expired or lost confirmation link leaves the parent stuck (register says exists, login says unconfirmed, no resend) | medium | `otp_expiry = 3600`; `emailHasLogin` finds the pending profile; no `auth.resend` anywhere | patch P1 |
| B3/E6 | Crafted anon signUp with role parent bypasses /register's student-domain ban and name cap | medium | `handle_new_user()` (0023) accepts any `parent` metadata; a parent at `x@students.internal.invalid` blocks that student username | patch P2 |
| B4 | Parent can change auth email via `updateUser`; `profiles.email` goes stale | medium | only `email_confirmed_at` is synced (0006); same for teachers since 0001, so pre-existing | defer |
| B5 | /register reveals whether any email has a login, with no rate limit | low | the frozen intent picks the generic existence message; the PRD accepts the disclosure risk | reject |
| B6 | Rejection leaves no audit row | low | the frozen rule is that rejection deletes the auth user and cascades; this is intended | reject |
| B7 | Registration receipt shows "Waiting for approval" pill before confirmation | low | `register/+page.svelte:22` uses `parent_status_pending`; direct correction | patch P3 |
| B8/V1/V2/V4 | No tests for the register action, the approve/reject actions, the /parent gate + state mapping, the teacher `update parents` refusal, or parent sign-up leaving student cols null | medium | pre-verified by V: no spec imports these modules | patch P4 |
| B9 | Register form repeats 80/6 as literals | low | drift risk only; the fix needs a shared module | reject |
| B10 | `rejectParent` fails silently for a non-parent role | false | no client insert on `parents`; only parent-only logins own rows until dual role ships | reject |
| B11 | Badge counts unconfirmed parents the admin can't approve | low | the admin can still reject them, so they are actionable | reject |
| B12 | bo strings are English copies | low | matches existing bo practice; real translation is tracked separately | defer |
| B13 | No privacy notice or consent on parent registration | medium | GDPR is already a go-live-blocking SPEC open question | defer |
| B14 | /parent 403 is hard-coded English | low | same pattern as `admin/`/`teacher/+layout.server.ts` | reject |
| V3 | Admin dashboard "Pending requests" tile ignores pending parents while badge/counter include them | medium | `admin/+page.server.ts:33-38` counts students only | patch P5 |
| V5 | Login `email_not_confirmed` branch and `?error=confirm` flag untested | medium | pre-verified | patch P1 |
| E1 | `/auth/confirm` now accepts `type=email` token_hash | low | token only reaches the inbox owner; no new capability beyond their own login | reject |
| E2 | Signup code without `flow=signup` falls into the recovery branch | low | a disallowed redirect falls back to `site_url` root, not `/auth/confirm`; unlikely | reject |
| E3 | Any 422 (e.g. weak_password) reported as "already exists" | low | client `checkNewPassword` enforces length first; unlikely | reject |
| E5 | Receipt wrong when confirmations are off | false | the project config has confirmations on | reject |
| E7/E15 | A rejected row can be flipped to approved by the admin | low | trigger only blocks →pending; a one-condition fix | patch P6 |
| E8 | Null profile shows "unconfirmed" state | low | root layout read failure only; unlikely | reject |
| E9 | role parent with no parents row → nav to 403 | false | the row is created atomically with the profile and has no delete grant | reject |
| E10/E14 | Pending parent can read team leaderboard totals and class_days | low | pre-existing any-authenticated policies; aggregates, not student personal data | defer |
| E11 | Decided parents list unbounded | low | same as the existing student decided list | reject |
| E12 | Blank parent name | false | `handle_new_user` falls back to the email for `display_name` | reject |

## Design Notes

- **Two migrations:** Postgres can't use a new enum value in the transaction that added it, and each migration file is one transaction.
- **Registration:** the server action does a service-role email lookup first (generic message only), then an anon `signUp` with user_metadata `role: 'parent'`, so GoTrue sends the confirmation mail.

## Verification

**Commands:**
- `npm run supabase:reset && npm run supabase:types` -- expected: 0022/0023 apply cleanly.
- `npm test` -- expected: all pass.
- `npm run check` -- expected: 0 errors.

**Manual checks (if no CLI):**
- Register a parent → Mailpit link → `/parent` waiting → admin approves in `/requests` → `/parent` empty state; reject → same email registers again.
