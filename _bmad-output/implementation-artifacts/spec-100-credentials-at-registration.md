---
title: 'Credentials at registration (#100)'
type: 'feature'
created: '2026-10-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '8e82bab601a7124cf2450debe84430400fccf377'
context:
  - '{project-root}/_bmad-output/specs/spec-class-tracker/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-class-tracker/roles-and-permissions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A new student's username and PIN are made at approval and shown once to the approver, so the family has to go to the admin or teacher for them. After registering, the student sees only that they will be approved.

**Approach:** Make the username and PIN at registration, show them on the confirmation screen, and let the student log in at once. Until approval, a logged-in student sees only a pending-approval page. Approval opens the portal and sends the family nothing (SPEC CAP-15, amended CAP-1).

**Decided (user 2026-10-13):**
- The email to the parent is not part of #100; it is its own build (`deferred-work.md`).
- At approval the approver sees the username and a note that the family already has the PIN. The PIN stays unstored; a forgotten PIN is handled with Reset PIN as today.
- A rejected student can log in and sees only a page saying the registration was not accepted, with sign-out.

## Boundaries & Constraints

**Always:**
- The PIN is never stored readable and never logged. It exists as the Auth password, in the short-lived confirmation cookie, and in whatever is shown or sent to the family once.
- Registration succeeds whenever the account was created, whatever happens afterwards.
- A student who is not approved (pending or rejected) reaches their status page and sign-out, and nothing else, by GET or POST.
- Approving a student who registered under this feature leaves their username and PIN untouched.
- Every new or changed text exists in English, German and Tibetan.

**Never:**
- No parent view of the username and PIN, no parent PIN reset and no email to the parent (all in `deferred-work.md`).
- No change to the teacher's and admin's Reset PIN, to who may approve, or to team assignment (#99).
- No message of any kind to the family at approval.
- No database migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register | Valid form, approved parent | Account has a real username and a 6-digit PIN; confirmation screen shows name, class, username, PIN and a link to the login page | N/A |
| Username taken | Another student already has the slug | Next free username (`name2`, `name3`); up to 5 tries | After 5 tries: generic registration error, no account left behind |
| Screen reloaded after 10 minutes | Cookie expired | Generic pending text, no username or PIN | N/A |
| Pending student logs in | Username + PIN from the screen | Lands on the pending page; no menu entries | N/A |
| Pending student opens any other page or posts a form | e.g. `/student`, `/leaderboard`, `/account` | Sent to the pending page | N/A |
| Approval | Student registered under this feature | Status and team change; the approver sees the username and the note, no PIN; the same username and PIN keep working; the student's next request reaches the dashboard | Unchanged from today |
| Rejected student logs in | Username + PIN from the screen | The same status page with the not-accepted text; no menu entries; every other request is sent back to it | N/A |
| Approval, older registration | Pending student still on a `pending-` placeholder address | Username and PIN are made and shown to the approver as today | Unchanged from today |
| Approved student opens the pending page | - | Sent to the dashboard | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/(auth)/join/+page.server.ts` -- `register` creates the auth user with a `pending-<uuid>` address and a random password; sets the `JoinReceipt` cookie; redirects to `/join/pending`. Mint here instead.
- `src/routes/(auth)/join/pending/+page.server.ts`, `+page.svelte` -- confirmation screen; reads the cookie; falls back to generic text without it. Keep the fallback.
- `src/lib/server/join-receipt.ts` -- `JoinReceipt` type and cookie name (httpOnly, 10 min, path `/join/pending`).
- `src/lib/server/temp-password.ts` -- `generateStudentPin`, `generateUniqueStudentUsername`, `studentUsernameToEmail`, `studentEmailToUsername`, `STUDENT_EMAIL_DOMAIN`. Reuse unchanged.
- `src/routes/requests/+page.server.ts` `approve` (lines 291-344) -- username scan and the mint-with-retry loop; also writes `profiles.email`. Extract the scan; keep the loop for `pending-` addresses only.
- `src/routes/requests/+page.svelte` -- shows `username` and `pin` from the `approved` result.
- `handle_new_user()` (0020, 0024, 0042) -- copies the auth email to `profiles.email` on insert, so a username given at `createUser` reaches the profile without an update.
- `src/hooks.server.ts` -- `sequence(handleLocalePrefix, handleParaglide, handleSupabase)`; `locals.safeGetSession`. The gate goes after `handleSupabase`.
- `src/routes/+layout.svelte`, `src/lib/menu.ts` -- menu by role; `data.profile` carries `status`.
- `src/routes/parent/+page.svelte` (`parent_pending_*`) -- the look to mirror for the pending page.
- RLS: a pending student has no `class_enrollments` row, so class, homework, syllabus, session and roster reads return nothing. Readable by any signed-in user and not personal: `teams`, `app_settings`, `class_days`, `team_leaderboard()`. Do not change.
- `messages/{en,de,bo}.json` -- `join_pending_*`, `help_student_2_body`, `help_teacher_3_body`, `help_parent_4_body`.
- Tests: `src/routes/(auth)/join/page.server.spec.ts`, `src/routes/requests/page.server.spec.ts`, `src/lib/server/rls.spec.ts` (line 8519: pending student has a synthetic email), `e2e/fixtures.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/student-credentials.ts` (new) + spec -- `takenStudentUsernames(adminClient)` moved out of `approve` -- one scan for both callers.
- [x] `src/routes/(auth)/join/+page.server.ts` + spec -- create the user with the username address and a PIN; on a duplicate-address error take the next username, up to 5 tries; other errors keep today's re-check; put `username` and `pin` in the receipt -- credentials at registration.
- [x] `src/lib/server/join-receipt.ts`, `src/routes/(auth)/join/pending/+page.svelte` -- show username and PIN with copy buttons (`$lib/clipboard`) and a link to `/login`; say they are shown here once -- the confirmation screen.
- [x] `src/routes/requests/+page.server.ts` + spec, `+page.svelte` -- mint only when the profile address is a `pending-` placeholder; otherwise flip the status only and return the username from the profile address with no `pin`; the page then shows the username and the family-has-the-PIN note -- approval keeps the family's PIN.
- [x] `src/hooks.server.ts` + spec -- `handleUnapprovedStudent`: for a session whose address ends in `STUDENT_EMAIL_DOMAIN`, read the own profile's status; if not approved, redirect anything but `/student/pending` and `/logout` to `/student/pending` (303) -- one extra query, students only.
- [x] `src/routes/student/pending/+page.server.ts`, `+page.svelte` (new) + spec -- the pending message, or the not-accepted message for a rejected student; an approved student is sent to `/student` -- the only page before approval.
- [x] `src/routes/+layout.svelte` -- no menu entries for a student who is not approved.
- [x] `messages/en.json`, `de.json`, `bo.json` -- new texts; correct the three help texts and `join_pending_explanation` / `join_pending_cannot_yet`, which say sign-in comes after approval.
- [x] `src/lib/server/rls.spec.ts` -- a pending student created with a username and PIN and a rejected one each sign in and read their own profile, and no row of `classes`, `class_enrollments`, `homework`, `class_sessions` or other profiles; update the line-8519 expectation.
- [x] `e2e/forms.e2e.ts` (or a new `e2e/credentials.e2e.ts`) -- register, read the credentials off the screen, log in, see only the pending page, get approved, reach the dashboard with the same PIN; a rejected student sees the not-accepted page.
- [x] `_bmad-output/manual-verification-issues.md`, `docs/` help screenshots note -- record what was built and what is known stale.

**Acceptance Criteria:**
- Given a family that has just registered a student, when they type the username and PIN from the screen on the login page, then the student is signed in without anyone else's help.
- Given a pending student who is signed in, when a teacher approves them, then their next page load shows the student dashboard and the PIN still works.
- Given a signed-in pending student, when they request any route or submit any form other than sign-out, then they end on the pending page and nothing is written.

## Implementation Notes

- The Code Map was wrong about `handle_new_user()`: migration 0024 refuses a student sign-up on any address but `pending-<uuid>`. With no migration allowed, registration creates the account on the placeholder address and sets the username address and PIN right after (`updateAuthUserEmailAndPassword`, then `profiles.email` with the service-role client). The retry on a taken username is on that second step.
- If the second step fails for another reason, the registration stands, the screen shows its generic text, and approval makes the credentials as for an older registration.
- Added beyond the task list: "My Account" is hidden for an unapproved student; the root layout load re-runs on navigation while a student is unapproved, so the menu appears after approval without a reload; a "Check again" link on the pending page.
- `e2e/team-students.e2e.ts`: a pending student now lands on the pending page where the test expected the team page's "not found".
- Tibetan texts were written by the implementer and need a native reader.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-13), three layers: blind (B), edge-case (E), verification-gap (V). Route in brackets.

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| B1 | A family that loses the PIN before approval cannot get a new one | medium [rejected: intent] | True: `resetStudentPin` needs an approved student. The frozen block excludes any new reset path in #100 and names Reset PIN as the remedy; it works after approval. Recorded in SPEC `roles-and-permissions.md` and told to the user. |
| B2, E11 | Without credentials the confirmation page still says "You can sign in right away" | medium [patch] | `join/pending/+page.svelte` uses `join_pending_explanation` in every case. |
| B3, E2, E3, E4 | A failed profile read sends an approved student to the waiting page; `loadError` is never rendered | medium [patch] | `handleUnapprovedStudent` drops the error; the pending page returns `loadError` and the Svelte file does not read it. |
| E1, E20 | Deleted auth user with a still valid token loops between `/student/pending` and `/login` | medium [patch] | Profile row is gone, so the hook redirects; the page load's `getUser()` fails and redirects to `/login`, which the hook redirects again. Reachable after `clearRejected`. |
| B4 | RLS tests cover one write only for a pending or rejected session | low [patch, tests] | Read the migrations: no self-update policy on `profiles`; `request_class_join` (0031) and `save_push_subscription` (0037) need an approved student; `deletion_requests` insert is parent-only. No write path found; tests added to hold that. Readable and not personal: `teams`, `app_settings`, `class_days`, `team_leaderboard()`. |
| B5, E7 | `takenStudentUsernames` drops the query error; scan capped at 1000 rows | low [rejected] | Same scan as before #100. An empty set costs at most extra tries against Auth's unique email; it fails only with five students on the same slug. The school has far fewer than 1000 students. |
| B6 | The exhausted path deletes the account, against "registration succeeds whenever the account was created" | low [rejected] | The frozen matrix row asks for exactly this ("no account left behind"). Reaching five taken usernames needs a failed scan plus five namesakes. |
| E8 | Exhausted and `deleteUser` fails: orphan account, family blocked by #98 | low [patch] | `join/+page.server.ts` logs the failed delete and still returns the error. |
| B7, E12 | The receipt cookie shows username and PIN again within 10 minutes, also after sign-in | medium [patch] | Cookie lives 10 minutes by the frozen matrix; nothing clears it at sign-in and the page is cacheable. |
| B8, E9 | `isDuplicateEmailError` matches any message containing "exists" | low [rejected] | Moved unchanged from `approve`. Narrowing it risks missing Auth's real duplicate answer, which was never captured in a test. |
| B9 | Approval can run between the two registration steps and mint a second PIN | low [rejected] | Window is the few milliseconds between two server calls of one request; an approver would have to act on a row created in that instant. |
| B10 | Canonical SPEC lists settled questions as open and does not say what is built | medium [fixed in SPEC] | Not this build's spec: two questions removed, decisions and build state written to `spec-class-tracker` (memlog, SPEC.md, roles-and-permissions.md). |
| B11 | spec-100 bookkeeping (ticked docs task, empty change log, `source_spec: none`) | [rejected] | Its fix edits this build's spec. No `docs/` screenshot note file exists; the note is in `manual-verification-issues.md`. |
| B12, V2 | `void url.pathname` in the root layout load is redundant, and untested | low [patch, test] | Not redundant: a student approved while on the pending page who clicks the logo navigates client-side. No test did that. |
| B13 | The hook reads the profile a second time for every student request | low [rejected] | Decided in the spec: one extra query, students only. |
| B14 | Pending page: unstyled link, pill repeats heading, no polling | low [rejected] | Cosmetic; polling is new behaviour nobody asked for. The non-student case is in B3. |
| B15 | Test gaps: no POST by an approved student, unreachable `/de/…` case, positional selectors, `createUser` without id | low [patch in part] | Hook spec cases go with B3/E1. Positional selectors and the id-less `createUser` (cannot happen with Auth) rejected. |
| B16 | Tibetan unreviewed; `/help` blocked for a pending student | [rejected] | Tibetan needs a native reader (told to the user). The frozen block gives an unapproved student the status page and sign-out only. |
| E5 | `/auth/confirm`, reset and help links land on the pending page in a browser holding an unapproved student's session | low [rejected: intent] | Same frozen rule as B16. |
| E6 | POST to `/logout/` with a trailing slash is redirected | low [rejected] | Nothing in the app posts there. |
| E10 | Auth update succeeds, profile write fails: a username the scan cannot see and an unseen PIN | low [rejected] | Approval then mints again onto the same account; the unseen PIN is no weaker than any pending student's. |
| E13, E19 | Approval mints when the profile address is null or not a student address | false | `handle_new_user()` (0024) accepts only a `pending-` student address at sign-up and the column is not null; no student row can have another address. |
| E14 | `takenStudentUsernames` throws inside `approve` | false | It never throws: supabase-js returns `{ data, error }` and the function drops the error. |
| E15 | Account entry shown when the layout's profile read fails | low [rejected] | Needs a failed read; the entry only leads back to the status page. |
| E16 | `help_teacher_3_body` says the approver never hands anything over | low [patch] | Wrong for a registration without credentials, where the PIN is shown once at approval. |
| E17 | The team page's own refusal for a pending student is now unreachable and untested | low [rejected] | The hook answers first; the route's check stays as a second line and costs nothing. |
| E18 | Registration can succeed with no credentials shown | false | Intended: the frozen rule is that registration succeeds once the account exists. The misleading text is B2. |
| V1 | Nothing asserts that an older registration's approval still shows the one-time PIN | medium [patch, test] | As filed: `e2e/forms.e2e.ts` checks only the sentence both messages share. |
| V3 | No assertion that "My Account" is hidden for an unapproved student | low [patch, test] | As filed. |
| V4 | Page behaviour is verified by Playwright only; touched e2e files are not on the verification list | low [done in verification] | `forms`, `team-students` and `credentials` e2e files are run in the final verification. |
| V5 | New RLS tests skip when local Supabase is down | low [rejected] | The harness's existing rule; they ran (1257 tests with the database up). |
| V6 | `signUpStudent` in `rls.spec.ts` repeats the action's second step instead of calling it | low [rejected] | True of every RLS test here; the browser test joins the two. |
| V7 | A dropped scan error is not the failure the join spec mocks | low [rejected] | Same root as B5. |

## Design Notes

- The PIN travels in the existing confirmation cookie: httpOnly, same-site, 10 minutes, readable only at `/join/pending`. It is the family's own browser and the same lifetime the screen already has.
- The gate is in the hook, not in a layout load: layout loads do not run for form posts and are not re-run on every navigation. It is a UX gate; RLS stays the barrier (AD-2).
- The address suffix tells a student session without a query, so staff and parent requests cost nothing extra.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test` on the registration spec -- expected: exit 0
