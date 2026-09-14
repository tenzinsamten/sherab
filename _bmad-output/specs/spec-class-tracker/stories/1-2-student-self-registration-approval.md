---
title: 'Student Self-Registration & Approval'
type: 'feature'
created: '2026-09-14'
status: 'in-review'
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

**Approach:** A prospective student self-registers via a 3-step join wizard (class code, name, guardian consent), lands Pending — invisible everywhere, no activity — until their class teacher or the admin (backup) approves or rejects them via a shared queue. At approval, the system assigns a team, auto-generates a username (from the registration name, deduped) and a random PIN, and shows both once to the approver for out-of-band handoff — mirroring Story 1-1's temp-password-shown-once pattern for teachers, not a new mechanism. Sign-in: a server-side action validates username+PIN against `profiles`, then signs in via a deterministic internal email (e.g. `{username}@students.internal.invalid`) + PIN-as-password through `signInWithPassword`, so `auth.uid()` and every existing RLS policy keep working unmodified through a real Supabase Auth session — no parallel auth model.

## Boundaries & Constraints

**Always:** Every authorization rule enforced in Postgres RLS (AD-2), reusing `is_admin()`/`is_teacher_of_class()` rather than inventing new checks. Student rows extend `profiles` (`role='student'`) via the existing `handle_new_user()` trigger pattern (no client-facing INSERT policy) — never fork a parallel students table. `team_id` settable only from `NULL` via the approval action; changing an already-set `team_id` requires an explicit admin-only override, enforced by trigger. Guardian consent is a required, timestamped checkbox at registration. A Pending student is invisible on every roster/leaderboard and cannot log any activity. Usernames are globally unique (enforced by the synthesized-email uniqueness constraint in Supabase Auth), not merely unique per class. A new registration is blocked while a Pending or not-yet-cleared Rejected row exists for the same `(class_id, registration_name)` pair; clearing the rejected row (existing "CLEAR REJECTED" action) re-opens that pair for resubmission.

**Never:** Do not build team-leaderboard ranking/scoring (Story 4-3) — only the minimal team-assignment seam, including a minimal admin-only "create team" (name only) mirroring Story 1-1's class-creation pattern, since the approval team-picker needs teams to exist. Do not build an avatar-picker or nickname-change flow — `display_name` defaults to the registration name, editable later (follow-up, see Implementation Notes). Do not build the admin cross-class oversight dashboard or data-deletion-request flow (Story 5-1). Do not provision production Supabase/hosting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student registers | Valid class code + name + consent checked | Pending `profiles` row created, `/join/pending` shown | Missing consent → blocked, inline error |
| Invalid class code | Unknown/malformed code at wizard step 1 | Wizard blocked from advancing | Inline error, no account created |
| Teacher approves | Teacher assigned to student's class, picks a team | `status→approved`, `team_id` set, username+PIN generated and shown once | N/A |
| Duplicate registration attempt | Same `(class_id, registration_name)` while a Pending/Rejected row exists, uncleared | Blocked before a new row is created | Inline error; resolves once existing row is cleared/decided |
| Non-assigned teacher attempts approval | Direct API call, not assigned to that class | RLS rejects the update regardless of frontend state | N/A |
| Admin approves (backup path) | Admin approves a student in any class | Same as teacher approval, any class | N/A |
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

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0002_student_registration.sql` -- schema + RLS + trigger + RPC per Code Map
- [x] `handle_new_user()` update -- read registration metadata, default `status='pending'`
- [x] `src/routes/admin/teams/**` -- minimal admin team creation (name only)
- [x] `src/routes/(auth)/join/**` -- 3-step wizard + pending receipt
- [x] `src/routes/requests/**` -- shared approval queue with team-picker
- [x] Paraglide messages for both new routes, all three locales
- [x] `rls.spec.ts` -- cover every I/O matrix row plus the team_id-once trigger

**Acceptance Criteria:**
- Given a Pending student, when any roster/leaderboard query runs, then that student never appears in results.
- Given a student already approved with a team assigned, when anyone (including an admin) tries to change `team_id` through the normal approval path again, then the update is rejected — only the documented admin override path can change it.
- Given a rejected registration, when the teacher/admin uses "CLEAR REJECTED", then the row is removed from the DECIDED history but the earlier registration attempt is not silently deleted without that explicit action.

## Implementation Notes

_(Deferred, not built here: avatar/nickname-change UI — `display_name` defaults to `registration_name` at approval time, matching the temp-password-shown-once precedent from Story 1-1 of shipping the minimum that satisfies the acceptance criteria. GDPR/compliance stance: this story ships with only the documented consent-at-registration + admin-approved-deletion flow (human decision, 2026-09-14) — broader obligations (data controller identity, retention limits, breach notification) remain an explicitly logged gap, matching SPEC.md's own Open Questions entry, not a resolved question. Record both in `deferred-work.md` once implementation starts.)_

## Spec Change Log

None yet.

## Review Triage Log

Not yet run.

## Design Notes

The synthesized-email PIN approach (see Intent) is the load-bearing trick that keeps this story small: every RLS policy in the codebase keys off `auth.uid()`, and Supabase Auth is the only thing that populates it. Routing student sign-in through a real (if synthetic) Supabase Auth session means zero RLS policies need a parallel "is this a PIN session" check — the student just becomes a normal authenticated user with `role='student'` for every existing and future policy.

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including new live-Supabase RLS cases (requires `npm run supabase:start` first)

**Manual checks (if no CLI):**
- Local Supabase must be running for the new RLS/trigger tests to execute rather than skip (known gap, tracked in `deferred-work.md`).
