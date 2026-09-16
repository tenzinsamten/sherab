---
title: 'Student Self-Registration & Approval'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tib-class-2026-09-14/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tib-class-2026-09-14/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1-1 ends before any student exists — Sherab has admin/teacher accounts and classes, but no way for a student to join, so nothing downstream (rosters, homework, gamification) has anyone to track.

**Approach:** A prospective student self-registers via a join wizard (class code, name, guardian email, guardian consent), lands Pending — invisible everywhere, no activity — until their class teacher or the admin (backup) approves or rejects them via a shared queue. The guardian's real email is used directly as the Supabase Auth account's email at registration time, so Supabase's own built-in confirmation flow verifies it — no separate email-sending infrastructure. The Pending row is visible to the approver immediately, flagged unverified until the guardian confirms; approving (not rejecting) is blocked until then, enforced in RLS. At approval, the system assigns a team, auto-generates a username (from the registration name, deduped) and a random PIN, and swaps the guardian's email for a deterministic internal one (e.g. `{username}@students.internal.invalid`) as the account's real Auth identity, shown once to the approver for out-of-band handoff — mirroring Story 1-1's temp-password-shown-once pattern for teachers, not a new mechanism. The guardian's email is retained separately on the student's profile even after this swap, as a durable contact. Sign-in: a server-side action validates username+PIN against `profiles`, then signs in via that synthesized internal email + PIN-as-password through `signInWithPassword`, so `auth.uid()` and every existing RLS policy keep working unmodified through a real Supabase Auth session — no parallel auth model.

## Boundaries & Constraints

**Always:** Every authorization rule enforced in Postgres RLS (AD-2), reusing `is_admin()`/`is_teacher_of_class()` rather than inventing new checks. Student rows extend `profiles` (`role='student'`) via the existing `handle_new_user()` trigger pattern (no client-facing INSERT policy) — never fork a parallel students table. `team_id` settable only from `NULL` via the approval action; changing an already-set `team_id` requires an explicit admin-only override, enforced by trigger. Guardian consent is a required, timestamped checkbox at registration, alongside a required guardian email that must pass Supabase Auth's own confirmation before the registration is approvable (rejection remains available regardless of confirmation state); the confirmed-email signal is mirrored from `auth.users.email_confirmed_at` onto `profiles.email_confirmed_at` via trigger, and the approval RLS policy's `WITH CHECK` enforces the gate at the database level, not just in the app. A Pending student is invisible on every roster/leaderboard and cannot log any activity. Usernames are globally unique (enforced by the synthesized-email uniqueness constraint in Supabase Auth), not merely unique per class. A new registration is blocked while a Pending or not-yet-cleared Rejected row exists for the same `(class_id, registration_name)` pair; clearing the rejected row (existing "CLEAR REJECTED" action) re-opens that pair for resubmission.

**Never:** Do not build team-leaderboard ranking/scoring (Story 4-3) — only the minimal team-assignment seam, including a minimal admin-only "create team" (name only) mirroring Story 1-1's class-creation pattern, since the approval team-picker needs teams to exist. Do not build an avatar-picker or nickname-change flow — `display_name` defaults to the registration name, editable later (follow-up, see Implementation Notes). Do not build the admin cross-class oversight dashboard or data-deletion-request flow (Story 5-1). Do not build a custom email-sending/verification mechanism — reuse Supabase Auth's native confirmation flow rather than inventing a parallel one. Do not provision production Supabase/hosting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student registers | Valid class code + name + guardian email + consent checked | Pending `profiles` row created immediately, visible to the approver flagged "unverified"; Supabase sends a real confirmation email to the guardian; `/join/pending` shown telling the guardian to check it | Missing consent/email → blocked, inline error |
| Invalid class code | Unknown/malformed code at wizard step 1 | Wizard blocked from advancing | Inline error, no account created |
| Guardian confirms email | Guardian clicks the real Supabase confirmation link | `profiles.email_confirmed_at` populated server-side via trigger, independent of whatever the browser does with the redirect | N/A |
| Teacher approves | Teacher assigned to student's class, guardian's email confirmed, picks a team | `status→approved`, `team_id` set, username+PIN generated and shown once, guardian's email retained on the profile | N/A |
| Teacher attempts approval before confirmation | Teacher assigned to the class, but guardian hasn't confirmed yet | Approval rejected (RLS `WITH CHECK` denies with a real permission error; app pre-checks and surfaces a friendly message first) | Rejecting the same row is still allowed |
| Duplicate registration attempt | Same `(class_id, registration_name)` while a Pending/Rejected row exists, uncleared | Blocked before a new row is created | Inline error; resolves once existing row is cleared/decided |
| Same guardian registers a second child while the first is pending | Same guardian email, still-open pending registration | `signUp()` returns the existing account rather than creating a new one; surfaced as a friendly duplicate-guardian-email error | Self-resolves once the first child is approved (their Auth email frees up) |
| Non-assigned teacher attempts approval | Direct API call, not assigned to that class | RLS rejects the update regardless of frontend state | N/A |
| Admin approves (backup path) | Admin approves a student in any class, guardian's email confirmed | Same as teacher approval, any class | N/A |
| Student signs in | Correct username + PIN | Session established via Supabase Auth | Wrong PIN → generic error, no account/session leak |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0002_student_registration.sql` (new) -- `registration_status` enum; extend `profiles` with `status`, `class_id`, `team_id`, `registration_name`, `guardian_consent_given_at`, `reviewed_by`, `reviewed_at`; `teams(id, name, created_at)` table (admin-insert-only RLS, mirroring `classes_insert_admin`); RLS UPDATE policy for approval reusing `is_admin()`/`is_teacher_of_class(class_id)`; `BEFORE UPDATE` trigger enforcing team_id-settable-once-from-NULL; `validate_class_code(code)` `SECURITY DEFINER` RPC so an unauthenticated wizard step 1 can look up a class without a broad anon SELECT policy on `classes`.
- `src/routes/admin/teams/+page.server.ts`, `+page.svelte` (new) -- minimal admin-only team creation (name only), mirroring `admin/classes`'s create-action shape; teams populate the approval team-picker dropdown.
- `supabase/migrations/0001_init.sql:132` (`handle_new_user()`) -- extend to read `class_id`/`registration_name`/`guardian_consent_given_at` from `raw_user_meta_data`, mirroring how teacher creation already passes `role` this way. Do not add a client INSERT policy on `profiles`.
- `src/lib/server/class-code.ts`, `src/lib/server/temp-password.ts` -- reuse `CLASS_CODE_LENGTH`/`CODE_ALPHABET` for client-side format validation; extend `temp-password.ts`'s generator pattern for the student PIN (short, numeric) and add a matching username generator (slugify `registration_name`, dedupe against existing usernames).
- `src/routes/(auth)/join/+page.server.ts`, `+page.svelte` (new) -- 3-step wizard; carry step state client-side in Svelte (not hidden fields across named actions), one `signUp()` call at the end with metadata, so no partial/orphaned auth user exists mid-wizard.
- `src/routes/(auth)/join/pending/+page.svelte` (new) -- Pending status receipt per EXPERIENCE.md.
- `src/routes/requests/+page.server.ts`, `+page.svelte` (new) -- shared approval queue (teacher: own assigned classes; admin: all classes); APPROVE/REJECT actions with inline team-picker, `aria-live="polite"` outcome announcement, DECIDED history section, CLEAR REJECTED action.
- `src/routes/(auth)/signup/+page.server.ts`, `src/lib/server/signup-duplicate.ts` -- pattern to mirror for form-action structure and duplicate/validation-helper extraction, not literally reused (different flow).
- `src/routes/admin/classes/+page.server.ts:7-14`, `teacher/+page.server.ts:12-15` -- `loadError` pattern; reuse `m.load_error_generic()` verbatim on the new routes rather than minting a new key.
- `messages/{en,de,bo}.json` -- new keys following the `<route>_<element>_<purpose>` convention (`join_*`, `requests_*`); `bo.json` gets English placeholders per established convention, flagged not translated.
- `src/lib/server/rls.spec.ts` -- extend with live-Supabase tests for the new RLS policies and the team_id-once trigger, following Story 1-1's pattern.
- `supabase/migrations/0006_guardian_email_verification.sql` (new, 2026-09-16 amendment) -- adds `profiles.guardian_email`/`email_confirmed_at`; extends `handle_new_user()` to populate both (`guardian_email` from `new.email`, `email_confirmed_at` from `new.email_confirmed_at`); new `sync_email_confirmed_at()` trigger (`AFTER UPDATE ON auth.users WHEN (email_confirmed_at changed)`) mirrors GoTrue's own confirmation state onto `profiles`; rewrites `profiles_update_registration_review`'s `WITH CHECK` to require `email_confirmed_at is not null` for `status='approved'` (not for `'rejected'`).
- `src/routes/(auth)/join/+page.server.ts` -- `register` action now signs up with the guardian's real email (replacing the retired `generatePendingRegistrationEmail()` placeholder) and reuses `isDuplicateSignup()` (from `src/lib/server/signup-duplicate.ts`, previously only used by the teacher `/signup` route) to catch a guardian re-registering a second child while the first is still pending.
- `src/lib/server/signup-duplicate.ts` -- `isDuplicateSignup()` fixed during this amendment: this project's actual GoTrue version doesn't produce the documented empty-`identities` duplicate shape; it returns the pre-existing user's real identity with `updated_at` advanced past `created_at`. The function now detects both shapes. This also fixes duplicate-detection on the pre-existing teacher `/signup` route, not just the new guardian-email path.
- `src/routes/requests/+page.server.ts` -- `approve` action pre-checks `email_confirmed_at` on its initial RLS-scoped fetch, before any Admin API call runs -- required because the credential-minting step later in the same action would otherwise force `email_confirmed_at` non-null (on the synthetic address) before the final `profiles` update, silently defeating the RLS gate if the app-level check weren't there.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0002_student_registration.sql` -- schema + RLS + trigger + RPC per Code Map
- [x] `handle_new_user()` update -- read registration metadata, default `status='pending'`
- [x] `src/routes/admin/teams/**` -- minimal admin team creation (name only)
- [x] `src/routes/(auth)/join/**` -- 3-step wizard + pending receipt
- [x] `src/routes/requests/**` -- shared approval queue with team-picker
- [x] Paraglide messages for both new routes, all three locales
- [x] `rls.spec.ts` -- cover every I/O matrix row plus the team_id-once trigger
- [x] `supabase/migrations/0006_guardian_email_verification.sql` -- guardian-email columns, confirmation-sync trigger, RLS `WITH CHECK` gate (2026-09-16 amendment)
- [x] `join/+page.server.ts` -- collect + signUp with guardian's real email, reuse `isDuplicateSignup()` for the sibling-collision case
- [x] `requests/+page.server.ts` / `+page.svelte` -- unverified badge, approve gated on confirmation (reject unconditional)
- [x] `rls.spec.ts` -- confirmation-gate tests (approve-denied-when-unconfirmed, reject-still-works, sibling-collision)

**Acceptance Criteria:**
- Given a Pending student, when any roster/leaderboard query runs, then that student never appears in results.
- Given a student already approved with a team assigned, when anyone (including an admin) tries to change `team_id` through the normal approval path again, then the update is rejected — only the documented admin override path can change it.
- Given a rejected registration, when the teacher/admin uses "CLEAR REJECTED", then the row is removed from the DECIDED history but the earlier registration attempt is not silently deleted without that explicit action.
- Given a pending student whose guardian has not yet confirmed their email, when a teacher or admin attempts to approve them, then the approval is rejected at the RLS level; rejecting the same row remains available regardless of confirmation state.

## Implementation Notes

_(Deferred, not built here: avatar/nickname-change UI — `display_name` defaults to `registration_name` at approval time, matching the temp-password-shown-once precedent from Story 1-1 of shipping the minimum that satisfies the acceptance criteria. GDPR/compliance stance: this story ships with only the documented consent-at-registration + admin-approved-deletion flow (human decision, 2026-09-14) — broader obligations (data controller identity, retention limits, breach notification) remain an explicitly logged gap, matching SPEC.md's own Open Questions entry, not a resolved question. Record both in `deferred-work.md` once implementation starts.)_

## Spec Change Log

- **2026-09-16 (human-directed renegotiation):** Intent/Boundaries/I-O-matrix renegotiated to add guardian-email verification. Trigger: production's Supabase Auth already required email confirmation (`enable_confirmations = true`), which broke registration outright since the original design's `signUp()` email was a synthetic, never-deliverable `pending-<uuid>@students.internal.invalid` placeholder that GoTrue could never confirm. Rather than disabling confirmation to match local dev, the design was extended to use it as a real verification gate: the guardian's real email becomes the registration-time Auth email (confirmed via Supabase's own native flow, no new email infrastructure), and the pre-existing synthetic-username+PIN login system is unchanged post-approval. See `supabase/migrations/0006_guardian_email_verification.sql` and the updated Code Map/Tasks above.

## Review Triage Log

Reviewed via `bmad-build` step-04 (blind-hunter, edge-case-hunter, verification-gap layers) against a best-effort diff (repo has no VCS at the time of this run, so the diff was staged file-by-file against `/dev/null` over all files touched by this story, including the login-identifier fix).

| # | Verdict | Route | Finding & evidence |
|---|---------|-------|---------------------|
| 1 | medium | patch | `requests/+page.server.ts`'s `approve` action sets `profiles.email` but no test (real or the RLS test's hand-rolled mirror) asserts it — a regression reverting that line would leave every approved student's `profiles.email` at its placeholder forever, undetected. Filed pre-verified by the verification-gap layer. |
| 2 | medium | patch | The nav "pending requests" badge count (`+layout.server.ts`) has zero test coverage for its RLS-scoping (teacher sees only their classes' pending count, admin sees all) — a scoping regression would ship silently. Filed pre-verified by the verification-gap layer. |
| 3 | medium | patch | The username-collision retry loop in `approve` (two same-slugging registration names) is only unit-tested at the pure-helper level, never through the real retry branch against live Supabase Auth — a one-line regression (dropping `existingUsernames.add(username)`) would permanently block approving a second same-named student with no test catching it. Filed pre-verified by the verification-gap layer. |
| 4 | low | patch | `admin/teams/+page.server.ts`'s `create` action returns the raw Postgres `error.message` to the UI instead of a translated `m.*` string, unlike every other create action in this diff — confirmed independently by both the blind-hunter and edge-case-hunter layers. |
| 5 | low | patch | `requests/+page.server.ts`'s `reject` action skips the RLS-scoped pre-check that `approve`/`clearRejected` both do, so an unauthorized/already-decided reject attempt gets the generic `requests_error_reject_failed` instead of the more specific `requests_error_not_found` used everywhere else for that condition — RLS still blocks the actual mutation either way, this is a message-consistency gap, not a security gap. Confirmed by direct read. |
| 6 | low | patch | `join/+page.server.ts`'s `register` action collapses every `signUp` failure — including the rare unique-index race for a duplicate `(class, name)` registration — into the generic `join_error_generic()`, even though `join_error_duplicate()` already exists and is used for the pre-check RPC. Confirmed by direct read. |
| 7 | low | patch | The join wizard's step indicator (`<ol aria-hidden="true">`) hides step progress from screen-reader users with no visually-hidden equivalent ("Step 2 of 3"). Confirmed by direct read of `+page.svelte`. |
| 8 | low | patch | The guardian-consent checkbox has no `aria-describedby` linking it to the preceding consent-notice paragraph, so assistive tech doesn't announce the notice as the checkbox's accessible description. Confirmed by direct read. |
| 9 | low | patch | `join/+page.server.ts`'s `register` action never checks the `signOut()` call's error after `signUp()` — a failed sign-out could leave a Pending student's browser with a live session. Narrow impact (RLS/role checks still gate real access) but the check is a trivial addition. |
| 10 | medium | defer | Student sign-in has no rate limiting/lockout: a 6-digit numeric PIN (10^6 space) paired with a username deterministically derivable from the registration name, with no throttling anywhere in this diff or the planning docs. Real hardening gap, bounded impact (RLS still scopes a compromised student session to that student's own data only), but the fix (lockout/throttle design) is a feature in its own right, not a smallest-fix patch. |
| 11 | low | defer | No "reissue credentials" flow exists if a student's one-time-shown username/PIN is lost — matches an already-existing, unaddressed gap for teachers' one-time temp password (Story 1-1), not something newly introduced here; needs its own design across both roles. |
| 12 | low | defer | Two admins/teachers approving the same pending student at literally the same moment could race between the RLS-scoped pre-check read and the final update, potentially diverging `auth.users.email` from the persisted `profiles.email`. Narrow window, low-volume single-admin tool; a real fix needs a transactional/locking approach beyond a smallest-fix patch. |
| — | false | reject | `messages/bo.json`'s new keys are English placeholders, not real Tibetan — matches the exact, already-documented project convention (Story 1-1's own deferred-work.md entry covers this generically); not a new or undocumented gap. |
| — | false | reject | Teams have no update/delete action or RLS policy — matches this spec's own frozen Boundaries ("minimal admin-only 'create team' (name only)"); explicitly out of scope, not an oversight. |
| — | low | reject | `teams` table has no `created_by` audit column (unlike `classes`) — the spec's own Code Map explicitly scoped the table to `(id, name, created_at)`; a real but low-value nice-to-have, non-trivial to retrofit (migration + insert-time capture) for negligible harm in a single-admin tool. |
| — | false | reject | `rls.spec.ts`/`temp-password.spec.ts` require live Supabase with no CI enforcement — already tracked generically in `deferred-work.md` from Story 1-1's review; not a new gap introduced by this diff. |
| — | low | reject | Empty-string `registration_name` would be treated as "not found" rather than "found but missing name" in `approve` — unreachable through normal operation, since the join wizard already rejects an empty name before creating any row. |
| — | low | reject | The `/join/pending` receipt cookie's parsed shape isn't validated against `JoinReceipt` — only reachable by a student tampering with their own cookie, and the worst case is a cosmetic "undefined" display, not a security or data issue. |
| — | low | reject | `generateUniqueStudentUsername`'s suffix loop has no upper bound — would require thousands of same-slugging registrations to matter, implausible at this app's actual scale (a single Sunday-school's worth of students). |
| — | false | reject | The spec's Approach wording ("validates username+PIN against profiles") doesn't literally match the implementation (it validates against Supabase Auth's `auth.users` via `signInWithPassword`, never queries `profiles`) — the actual mechanism matches this spec's own deeper Design Notes intent exactly; the fix would be editing this spec's wording, which is rejected by rule. |

## Design Notes

The synthesized-email PIN approach (see Intent) is the load-bearing trick that keeps this story small: every RLS policy in the codebase keys off `auth.uid()`, and Supabase Auth is the only thing that populates it. Routing student sign-in through a real (if synthetic) Supabase Auth session means zero RLS policies need a parallel "is this a PIN session" check — the student just becomes a normal authenticated user with `role='student'` for every existing and future policy.

**2026-09-16 amendment — guardian-email verification reuses the same trick, one level earlier.** The registration-time Auth email is now the guardian's real address instead of a random placeholder; approval still swaps it to the synthetic `{username}@students.internal.invalid` exactly as before, so nothing about the post-approval identity model changes. Two things only surfaced by testing against a real local Supabase instance (not documented behavior, and worth recording so a future reader doesn't re-derive them from scratch): (1) with `enable_confirmations = true`, a duplicate `signUp()` for an existing *unconfirmed* email does not error — GoTrue silently returns the pre-existing user's real (non-empty) identity while bumping only `updated_at`, not the documented-elsewhere "empty identities" shape; `isDuplicateSignup()` was fixed to detect this via the `created_at`/`updated_at` drift. (2) A `WITH CHECK` failure on an authorized, USING-passing row (e.g. an assigned teacher approving before confirmation) raises a real Postgres `42501` error, not a silent zero-rows result the way a `USING`-filtered denial does — this is exactly why `requests/+page.server.ts`'s `approve` action pre-checks `email_confirmed_at` itself before ever reaching that update, rather than relying on the RLS policy alone to fail gracefully.

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including new live-Supabase RLS cases (requires `npm run supabase:start` first)

**Manual checks (if no CLI):**
- Local Supabase must be running for the new RLS/trigger tests to execute rather than skip (known gap, tracked in `deferred-work.md`).
