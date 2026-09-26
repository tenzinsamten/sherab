---
title: '#50 Sign-ups can no longer choose a privileged role'
type: 'bugfix'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1246d5cb1440543359413357ca7e19c3c9303e79'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `handle_new_user()` sets `profiles.role` from `raw_user_meta_data`, which any caller of the public `supabase.auth.signUp` controls. A crafted sign-up with `role: 'admin'` becomes an admin, and a sign-up with no role becomes a teacher, although only the admin may create teachers (issue #50, spine AD-4).

**Approach:** A new migration makes the trigger take `admin`/`teacher` only from `raw_app_meta_data` (writable only with the service role). The only role accepted from client metadata is `student`, which stays Pending-gated. Any other sign-up is refused. The admin's teacher creation and the tests move to `app_metadata`.

## Boundaries & Constraints

**Always:**
- Role resolution order: `raw_app_meta_data ->> 'role'` if present, otherwise `raw_user_meta_data ->> 'role'` only when it equals `student`, otherwise raise so the whole sign-up rolls back.
- Keep every other column `handle_new_user()` fills today (0006 version) exactly as it is.
- The student `/join` flow keeps working unchanged: same `signUp` call, same Pending state, same duplicate-email handling.
- The admin's "create teacher" still produces a `teacher` profile and still reports duplicate emails the same way.

**Never:**
- No edits to existing migrations. The change is a new `supabase/migrations/0020_*.sql`.
- No push to the hosted database. The user applies the migration.
- No changes to existing profiles' roles. Checking hosted data is a manual step (see Verification).
- No Parent-role work. `parent` is not accepted yet; the Parent stories will add it under AD-4.

**Decisions (user, 2026-09-26):**
- The public `/signup` page is removed, along with its `signup_*` messages and any links to it. First-admin bootstrap becomes: create the account through the Auth Admin API (`curl` with the service-role key, `app_metadata.role = 'teacher'`), then run the existing promote SQL. The README documents this. No public page creates staff accounts.
- Amended (user, 2026-09-26, during implementation): Studio "Add user" was the original bootstrap choice. It can't work, because it sends no role and role-less accounts are refused. The `curl` Admin API bootstrap replaces it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Forged admin | public `signUp` with `data: { role: 'admin' }` | no auth user, no profile | sign-up returns an error |
| Forged teacher | public `signUp` with `data: { role: 'teacher' }` | no auth user, no profile | sign-up returns an error |
| No role | public `signUp` with no role | no auth user, no profile | sign-up returns an error |
| Student join | `/join` `signUp` with `role: 'student'` + class data | Pending student profile, as today | unchanged |
| Admin creates teacher | `admin.createUser` with `app_metadata: { role: 'teacher' }` | teacher profile | duplicate email still detected |
| Service-role admin | `admin.createUser` with `app_metadata: { role: 'admin' }` | admin profile | N/A |
| Mixed | `app_metadata.role = 'teacher'`, `user_metadata.role = 'admin'` | teacher profile (app_metadata wins) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0006_guardian_email_verification.sql:62-107` -- current `handle_new_user()`. Copy it in full and change only the role line (`meta_role := ...`). The student-only columns key off `meta_role`.
- `supabase/migrations/0001_init.sql:125-155` -- original trigger and its comment explaining the `teacher` default. Its reasoning is superseded; don't edit it.
- `src/routes/admin/teachers/+page.server.ts:68-76` -- `createUser` passes `user_metadata: { role: 'teacher', display_name }`. Move `role` to `app_metadata` and keep `display_name` in `user_metadata`, since the trigger still reads `display_name` from there.
- `src/routes/(auth)/join/+page.server.ts:52-62` -- the student `signUp`, with `role: 'student'` in `options.data`. No change.
- `src/routes/(auth)/signup/` -- the bootstrap page (`+page.server.ts`, `+page.svelte`). Delete it (Decision).
- `messages/{en,de,bo}.json` -- `signup_*` keys (e.g. `en.json:68-76`). Remove them in all three files.
- `README.md:37-47` -- first-admin bootstrap instructions.
- `src/lib/server/rls.spec.ts` -- `createSignedInUser` (`:47-55`) and the duplicate test (`:156, :164`) create admin/teacher via `user_metadata.role`; move those to `app_metadata`. `:120-150` asserts the no-role `signUp` lands as `teacher` (the bootstrap test). Rewrite it so the bootstrap is `admin.createUser` plus the promote SQL. The `user_metadata: { role: 'student' }` call sites stay valid.
- `src/lib/server/signup-duplicate.spec.ts`, `rls.spec.ts:191-218` -- the duplicate-signup shape tests sign up with no role. They must pass `role: 'student'` plus a valid class, or use the student helper, since no-role sign-ups now fail.
- `is_admin()` (`0001_init.sql:86`) reads `profiles.role`, and nothing in `src` reads the JWT metadata role, so no other code path trusts client metadata.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0020_signup_role_from_app_metadata.sql` -- `create or replace function public.handle_new_user()`, the 0006 body with role resolution per Boundaries. Raise a clear exception for a refused role, and add a header comment citing #50 and AD-4 -- the fix itself.
- [x] `src/routes/admin/teachers/+page.server.ts` -- set the teacher role through `app_metadata` -- the admin path must keep producing teachers.
- [x] `src/lib/server/rls.spec.ts` -- move admin/teacher helpers to `app_metadata`, and add the I/O-matrix cases (forged admin, forged teacher, no role, mixed, student join). Adjust the bootstrap and duplicate-shape tests -- this proves the hole is closed.
- [x] `src/lib/server/signup-duplicate.spec.ts` -- keep its sign-ups valid under the new rule -- the tests stay meaningful.
- [x] `src/routes/(auth)/signup/`, `messages/*.json`, `README.md` -- delete the route and `signup_*` messages, and rewrite the bootstrap section to an Admin API `curl` plus the promote SQL -- the bootstrap stays documented and working.
- [x] `_bmad-output/manual-verification-issues.md` -- set #50's status to built, naming the migration -- the issue log stays accurate.

**Acceptance Criteria:**
- Given local Supabase with migration 0020 applied, when the RLS suite runs, then every I/O-matrix row passes and no existing test regresses.
- Given the admin on `/admin/teachers`, when they create a teacher, then the teacher can sign in and sees their assigned classes as before.

## Implementation Notes

- **Deferred constraint trigger (deviation from "create or replace function" only).** GoTrue's Admin API (`auth.admin.createUser`, and Studio's "Add user") inserts the `auth.users` row with only `{provider, providers}` in `raw_app_meta_data` and writes the caller's `app_metadata` with a later UPDATE in the same transaction. The immediate AFTER INSERT trigger therefore never saw `app_metadata.role`, and every `createUser` was refused (confirmed locally from the auth logs). 0020 recreates `on_auth_user_created` as a `DEFERRABLE INITIALLY DEFERRED` constraint trigger. `handle_new_user()` re-reads the row at commit, so it sees the final metadata, and a raise still rolls back the whole sign-up. `user_metadata` is part of the INSERT, so `/join` is unaffected.
- **Bootstrap: Studio "Add user" does not work.** It sends no role, so under the frozen rule (no role, then raise) it is refused. The README instead creates the first account with a `curl` to the Admin API (`app_metadata.role = 'teacher'`), then runs the promote SQL. The rls.spec bootstrap test mirrors this, and a test pins that a role-less `createUser` is refused.
- An unknown `app_metadata` role (e.g. `parent`, which is not in `user_role` yet) raises a `check_violation`.
- `e2e/fixtures.ts` (not in the Code Map) also created admin/teacher users through `user_metadata`. It now uses `app_metadata` for staff.
- The `?justSignedUp=1` toast (`+layout.svelte`) and its `home_just_signed_up` message were only reachable from `/signup`, so both are removed.
- `signup-duplicate.spec.ts` is a pure unit test with no real sign-ups, so it needed no change.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind + edge | Refused sign-ups still send a confirmation email (refusal happens at commit, after GoTrue mails) | medium | Reproduced locally: a forged `role: admin` signUp returns a 500 and Mailpit got "Confirm your email address". Not caused by this change: before 0020 the same sign-up succeeded and mailed too, so public signUp could already mail any address. | defer |
| 2 | blind | `/join` depends on the insert-time error shape, and the commit-time failure breaks the duplicate-race handling | false | `join/+page.server.ts:96-113` handles any `signUpError` the same way and uses `check_registration_available` to tell cases apart. The message and status aren't read. | reject |
| 3 | blind | Migration header says "Everything else is 0006's body unchanged", which is inaccurate (return null, re-read row, constraint trigger) | low | True: the body re-reads `u`, returns null, and the trigger type changed. | patch |
| 4 | blind | Implementation Notes claim an unknown app role (`parent`) is refused, but no test covers it | low | No such test exists in the #50 describe block. | patch |
| 5a | blind | README `curl` uses env vars without saying where they come from, and the password lands in shell history | low | True: the README doesn't say to load `.env` or use `supabase status`. | patch |
| 5b | blind | README could create the admin directly with `app_metadata.role = 'admin'` instead of teacher + promote | low | Works (test proves it), but the frozen Decision fixes teacher + promote SQL. | reject (frozen intent) |
| 6 | blind | Other role-less GoTrue paths (invite, OTP, OAuth) are now refused but undocumented | low | True: the migration refuses any user without `app_metadata.role` or a student role. Only Studio is named. | patch |
| 7 | blind + edge | `password-rules.ts:1` still refers to the deleted signup; the test's `story-1-1-signup-dup-` prefix and comment are stale | low | True at the cited lines. | patch |
| 8 | blind | No remediation steps if the hosted check finds unexpected staff accounts | medium | True: the #50 issue entry has detection only. JWTs stay valid until expiry. | patch (issue log) |
| 9 | blind | Root `+page.server.ts` still forwards `url.search` without a documented caller | low | Behavior existed before and is a same-origin path; no harm shown. | reject |
| 10 | blind | `expectNoAccount` ignores the delete error, and the #50 block leaves test data | low | True, but it matches the suite's existing no-cleanup convention; the targeted rerun passed after reset. | reject |
| 11 | verification-gap | The admin "create teacher" action's `app_metadata` payload is never run by a test | medium (unverified regression risk) | The action is correct in the diff, but no test ever ran it; that gap existed before this change. | defer |
| 12 | verification-gap | The RLS suite, including the #50 tests, skips silently when local Supabase is down | medium | Established `describe.skipIf(!reachable)` convention, not introduced here. | defer |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: all migrations through 0020 apply cleanly.
- `npm run test` -- expected: all tests pass, including the RLS suite against local Supabase.
- `npm run check && npm run lint` -- expected: no errors.

**Manual checks (if no CLI):**
- Hosted (user, after pushing 0020): `select id, email, role from profiles where role in ('admin','teacher') order by created_at;` shows only accounts you recognize. Also check with `select email, raw_app_meta_data from auth.users` that no unexpected account exists.
