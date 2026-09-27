---
title: '7-2 Parent-first student registration & linking'
type: 'feature'
created: '2026-09-27'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'eac60360242b78fe8ba7b946bc05230c4688d659'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student registers with any guardian email. That email becomes the student's auth email and must be confirmed, so siblings collide on Auth's unique email and no parent is ever linked.

**Approach:**
- A student can register only with the email of an **approved** parent. The student's auth user gets a synthetic, pre-confirmed email.
- The link is stored as `profiles.parent_id`, set inside the sign-up transaction (AD-10, AD-11).
- Guardian-email confirmation is retired.
- The parent's `/parent` page lists their linked children.

## Boundaries & Constraints

**Always:**
- **Registering (`/join`):** the server action creates the student with the Admin API:
  - email `pending-<uuid>@students.internal.invalid`, pre-confirmed, with a random unshared password;
  - user_metadata `role: 'student'`, class, name, consent and `guardian_email`.
  
  Credentials are still minted at teacher approval, as today.
- **Pre-check:** the server action checks first and returns only found / not found. When not found, the student sees exactly: "No parent account found. Check the email is correct, or ask your parent to register first." A pending, unconfirmed or rejected parent counts as not found.
- **What the sign-up trigger enforces** (`handle_new_user`) for a student whose role comes from **user_metadata**:
  - It finds the approved parent whose profile email equals `guardian_email` (case-insensitive, trimmed) and sets `parent_id`. If there is none, it raises and the whole sign-up rolls back.
  - It refuses any email other than `pending-%@students.internal.invalid`.
  - `guardian_email` stores the metadata value as a display copy only.
- **Service-role students:** a student whose role comes from **app_metadata** is a trusted path used by tests and fixtures. It may have no parent.
- **Link column:** `profiles.parent_id` is a FK to `parents.id` with `ON DELETE RESTRICT`. RLS never matches on email text.
- **Guard trigger:** `parent_id`, `guardian_email` and `role` can't be changed by `authenticated`/`anon` callers, including through the teacher's registration-review update. The service role and security-definer paths may change them.
- **Approval:** approving a student no longer needs `email_confirmed_at`, in the RLS policy, the action and the UI. The consent step stays. Several siblings can register with one parent email, even while more than one is pending.
- **Helpers:**
  - `is_parent_of(student_id)` is true only when all of these hold: the caller `is_parent()`, the student's `parent_id` is the caller, and the student is approved.
  - `linked_children()` returns the caller's pending and approved children (id, name, status), never rejected ones.
  - Both are security definer with `search_path = ''` and explicit revokes and grants.
- **`/parent` (approved parent):**
  - One entry per linked child: the name, plus "Waiting for approval" for a pending child.
  - The "No children linked yet" empty state when there are none.
  - No other child data (that's 7-3).
- **i18n:** every new or changed string in en, de and bo.

**Never:**
- **Out of scope:**
  - Child details, `homework_counts` or parent read policies (7-3).
  - Guardian email correction (7-6).
- **Forbidden:**
  - Dropping `sync_email_confirmed_at` or `profiles.email_confirmed_at` (parent approval uses them).
  - Editing old migrations, or pushing to the hosted database.
- **Data:** no data migration. Existing test students keep `parent_id` null, because test data is reset at release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register | guardian email = approved parent (any case) | pending student, `parent_id` set, synthetic auth email, no mail sent; `/join/pending` receipt | N/A |
| No parent | unknown email | nothing created | exact FR-3 message |
| Parent not approved | pending / unconfirmed / rejected parent's email | nothing created | FR-3 message |
| Siblings | two registrations, same parent email, both pending | both created, both linked | N/A |
| Crafted sign-up | anon signUp, role student, unknown guardian or real auth email | refused, rolls back | N/A |
| Approve | teacher approves a pending student | approved with credentials; no confirmation needed | N/A |
| Guard | teacher/student/parent updates `parent_id`, `guardian_email` or `role` | refused | RLS/trigger error |
| Parent sees children | approved parent, children pending + approved + rejected | pending (waiting) + approved listed; rejected hidden | N/A |
| is_parent_of | own approved child / own pending child / other child | true / false / false | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/(auth)/join/+page.server.ts:25-115` -- `register`: replace anon `signUp(guardianEmail)` + `isDuplicateSignup` with the parent pre-check + Admin API `createUser`; keep `check_registration_available`, consent, receipt cookie, redirect.
- `src/routes/(auth)/join/+page.svelte:146-158` -- guardian email field/note copy (parent's registered email, no confirmation mail).
- `src/routes/(auth)/join/pending/+page.svelte:32` -- drop "check your email"; say the teacher will approve.
- `src/lib/server/join-receipt.ts` -- receipt shape; keep.
- `src/lib/server/parent-registration.ts` -- `escapeLikePattern`; add `approvedParentExists(adminClient, email)` (profiles email match + `parents.status = 'approved'`).
- `src/lib/server/temp-password.ts:55-62` -- `STUDENT_EMAIL_DOMAIN`; `studentEmailToUsername` ignores the `pending-` prefix, so approval's username scan stays correct.
- `src/lib/supabase/admin.ts:21,45` -- `createSupabaseAdminClient`, `updateAuthUserEmailAndPassword` (approval rewrite; unchanged).
- `supabase/migrations/0023_parents.sql:132-222` -- latest `handle_new_user`; copy it into the new migration and change only the student branch. Keep the deferred-trigger shape and the parent branch.
- `supabase/migrations/0006_guardian_email_verification.sql:152-170` -- latest `profiles_update_registration_review`; recreate it without the `email_confirmed_at` clause.
- `supabase/migrations/0002_*.sql:93-130` -- `profiles_open_student_registration_unique`, `enforce_team_id_set_once` (keep; pattern for the guard trigger).
- `supabase/migrations/0016_class_enrollments.sql:46,64` -- `is_enrolled_in_class`/`is_teacher_of_student` helper pattern.
- `src/routes/requests/+page.server.ts:99,151,208`, `+page.svelte:99-100,140` -- remove the student unverified gate/pill/disabled state; parent section untouched. `page.server.spec.ts:128-137` fixture.
- `src/routes/parent/+page.server.ts`, `+page.svelte:42-45` -- approved state: call `linked_children()` and render the list.
- `src/lib/server/rls.spec.ts` -- `signUpStudent` (~521, 21 call sites) becomes Admin-API + approved parent; `confirmGuardianEmail` (~555) stays for 7-1 parent tests; Story 1-2 block L618/842/877/896 asserts the retired flow and needs rewriting; ~15 helpers (`createUser` with `user_metadata.role='student'`) switch to `app_metadata.role='student'`.
- `e2e/fixtures.ts:70-89` -- same switch to `app_metadata`.
- `messages/{en,de,bo}.json` -- remove `join_error_guardian_email_taken`, `join_pending_check_email`, `requests_unverified_badge`, `requests_error_unverified` if unused; change `join_guardian_email_note`; add the FR-3 message.
- `_bmad-output/implementation-artifacts/deferred-work.md:4-9` -- sibling collision + confirm landing entries become resolved; note it in Implementation Notes (don't edit entries).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0024_parent_first_registration.sql` -- `profiles.parent_id` FK RESTRICT + index; `handle_new_user` student branch; guard trigger; recreated review policy; `is_parent_of()`, `linked_children()`.
- [ ] `src/lib/server/parent-registration.ts` (+ spec) -- `approvedParentExists`.
- [ ] `src/routes/(auth)/join/*` -- new register path, copy, pending receipt; add a `page.server.spec.ts` (not found → FR-3 message and no createUser; found → createUser with synthetic `pending-` email, `email_confirm: true`, `guardian_email` metadata).
- [ ] `src/routes/requests/*` -- drop the student confirmation gate; update specs.
- [ ] `src/routes/parent/*` -- children list; extend `page.server.spec.ts`.
- [ ] `src/lib/server/rls.spec.ts`, `e2e/fixtures.ts` -- helper switch; rewrite Story 1-2 retired-flow tests; new `describe('7-2 parent-first registration')` covering every matrix row.
- [ ] `messages/{en,de,bo}.json` -- key changes.
- [ ] `src/lib/supabase/database.types.ts` -- hand-add `parent_id`, `is_parent_of`, `linked_children` (don't regenerate, per 7-1).

**Acceptance Criteria:**
- Given no approved parent with that email, when a student submits `/join`, then no auth user or profile exists afterwards and the FR-3 message shows with the form values kept.
- Given an approved parent, when their child registers and a teacher approves them, then the child signs in with the minted username/PIN, and the parent's `/parent` shows the child without "Waiting for approval".
- Given the whole suite on a freshly reset local DB, when `npm test` runs, then all tests pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- **Two student paths:** user_metadata students must go through the parent match; app_metadata students (service role only, the #50 rule) may skip it. This keeps the ~15 fixtures working with a one-word change and never opens the path to clients.
- **`pending-` prefix:** approval's username scan already filters it out, so a registration-time synthetic email can never collide with a minted username.
- **Guard trigger:** check `current_user in ('authenticated','anon')`. Security-definer functions and the service role run as other roles, so 7-6's approval trigger can still move `parent_id`.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0024 applies cleanly.
- `npm test` -- expected: all pass (fresh DB).
- `npm run check` -- expected: 0 errors.

**Manual checks (if no CLI):**
- Local: approved parent → `/join` with that email (two siblings) → both show "Waiting for approval" on `/parent` → teacher approves one → it shows as approved; unknown email → FR-3 message.
