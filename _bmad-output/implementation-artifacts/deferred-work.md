# Deferred Work

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: A guardian registering a second child while their first child's registration is still pending/unconfirmed hits a real Supabase Auth email-uniqueness collision, since the guardian's real email is now the `signUp()` email pre-approval (migration `0006_guardian_email_verification.sql`). Surfaced as a friendly `join_error_guardian_email_taken` message, not a raw failure.
  evidence: Deliberate, narrow, accepted limitation identified while designing guardian-email verification -- it self-resolves once the first child is approved (their `auth.users.email` flips to the synthetic `{username}@students.internal.invalid` address, freeing the guardian's real email for reuse). Covered by a dedicated `rls.spec.ts` test exercising `isDuplicateSignup`'s empty-identities response shape against the real local Auth API.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: No dedicated confirmation-landing route exists for the guardian-email verification link. GoTrue's confirmation template redirects the guardian's browser to `site_url` with a PKCE `?code=` param (confirmed by actually clicking a real captured confirmation email during manual verification) after they click confirm -- the app never exchanges it, so it just sits there unconsumed. Harmless (nothing consumes the code, RLS still gates the pending student account to nothing), but a rough UX edge (the guardian lands on the app's bare homepage with no confirmation message).
  evidence: Identified while designing migration `0006_guardian_email_verification.sql`, confirmed empirically: `profiles.email_confirmed_at` is populated via the `on_auth_user_email_confirmed` trigger server-side, at the moment GoTrue's `/auth/v1/verify` endpoint processes the click -- independent of the redirect and its unconsumed code. A real landing page (e.g. "Thanks — your registration is confirmed") would need a new route in a follow-up.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: The new `join_guardian_email_label`, `join_guardian_email_note`, `join_error_guardian_email_taken`, `join_pending_check_email`, `requests_unverified_badge`, and `requests_error_unverified` keys in `messages/bo.json` are English placeholders, not real Tibetan translations.
  evidence: Same recurring, already-logged pattern as prior stories' `bo.json` additions (see Story 3-2's entry in the sprint-status refresh log) -- native-speaker translation remains a separate, deferred task across the whole file, not specific to this change.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/3-1-one-off-homework-assignment-review.md`
  summary: `homework_instances_update_admin_or_assigned_teacher` grants an unrestricted UPDATE (any column) to any admin/assigned teacher, not just `archived_at`/`archived_by` -- the migration's own comment claims the app only ever writes archive columns "through this policy," but nothing enforces that at the DB level.
  evidence: Story 3-1's own bmad-build review (verification-gap layer) identified this. Not tied to a demonstrated regression in 3-1's own scope (archiving itself works and is tested), but explicitly worth tightening before Story 3-2 builds recurring-instance editing on top of the same table -- a direct call could rewrite `due_date`/`period_start` and undermine AD-8's `UNIQUE(assignment_id, period_start)` guarantee.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: Avatar-picker / nickname-change UI. `display_name` defaults to `registration_name` at profile-creation time (set in the `handle_new_user()` trigger) and stays editable later, but no UI to change it exists yet.
  evidence: Explicitly named as deferred in the story's own Implementation Notes ("Do not build an avatar-picker or nickname-change flow... shipping the minimum that satisfies the acceptance criteria"). A natural follow-on once a student-facing home screen exists.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: GDPR/compliance stance beyond consent-at-registration + admin-approved deletion (CLEAR REJECTED). Data controller identity, retention limits, and breach notification are not addressed by this story.
  evidence: Explicitly named as an open gap in the story's own Implementation Notes ("this story ships with only the documented consent-at-registration + admin-approved-deletion flow... broader obligations... remain an explicitly logged gap, matching SPEC.md's own Open Questions entry, not a resolved question").

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: The "documented admin-only override path" for changing an already-set `team_id` is not a built feature -- the `profiles_team_id_set_once` trigger (migration `0002_student_registration.sql`) rejects the change unconditionally for every client-facing path (including an admin acting through the normal approval route), per the story's own AC. Overriding a mis-assigned team today requires an out-of-band DB action (e.g. running as the table owner, or temporarily disabling the trigger), mirroring the Story 1-1 admin-bootstrap-promotion SQL precedent, but that procedure is not yet written down anywhere.
  evidence: Direct implementation choice made to satisfy AC 2 ("when anyone (including an admin) tries to change team_id through the normal approval path again, then the update is rejected") -- the alternative reading (an is_admin() bypass inside the trigger) would have failed that AC's literal wording. Needs a documented runbook before a real mis-assignment happens in production.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-1-teacher-student-account-management.md`
  summary: Student self-registration (name + class code + guardian consent) and the approval flow (teacher/admin approve or reject a Pending student, with the inline team-picker that sets `team_id`).
  evidence: Split from Story 1-1 to bring the spec back under the ~1,600-token budget. Also depends on decisions made in the narrowed Story 1-1 (classes/codes must exist, admin/teacher accounts must exist to do the approving) and on the student sign-in mechanism (username + short PIN, decided this run) being available before it can be built — a natural follow-on story, not a same-story concern.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-ui-restyle-sherab-design.md`
  summary: Google Fonts loaded via a render-blocking CSS `@import` in `src/app.css` instead of `<link rel="preconnect">` + `<link rel="stylesheet">` in the document head.
  evidence: Pre-existing pattern from before this restyle (the original `app.css` already used `@import` for Baloo 2/Source Sans 3/Noto Serif Tibetan) — this change only swapped which families are requested, not the loading mechanism. A real perf issue, but not caused by this change; fixing it means touching `src/app.html`, outside a token-level restyle's scope.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-ui-restyle-sherab-design.md`
  summary: Repeated inline `style="color: var(--color-muted-foreground); ..."` / border+radius+padding fragments across `admin/classes`, `admin/teachers`, and `teacher/+page.svelte` (e.g. empty-state text, the teacher-assignment checkbox "chips") could be promoted into reusable utility classes (`.text-muted`, `.chip`) in `app.css`.
  evidence: Pre-existing code style from Story 1-1's original implementation (shared classes + inline style for one-offs), not introduced by this restyle. Worth cleaning up now that the project has an explicit token/class system, but it's a refactor of working code, not a fix for something this change broke.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-1-teacher-student-account-management.md`
  summary: `src/lib/server/rls.spec.ts` (the only test coverage of the real RLS authorization boundary, AD-2) silently `skipIf`-skips its entire suite whenever local Supabase isn't reachable, and no CI config exists in the repo to guarantee it ever actually runs — a broken policy could ship behind a green `npm test`.
  evidence: Story 1-1's own bmad-build review (verification-gap layer) confirmed this via direct trace: `package.json`'s `test` script is plain `vitest run` with no Supabase bootstrap, and no `.github/workflows` or other CI config exists anywhere in the repo. Closing this needs a CI job that starts Supabase before running tests — an infrastructure decision beyond a single story's diff.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-1-teacher-student-account-management.md`
  summary: `src/routes/(auth)/signup` has no guard limiting it to the one-time admin-bootstrap use it's documented for (`signup_notice`, README) — it stays open indefinitely, letting anyone self-register a `teacher`-role account after bootstrap.
  evidence: Already named as a known follow-up in this spec's own Implementation Notes ("flagging as a follow-up (e.g. gate it behind 'no admin exists yet', or remove it once the admin-teachers flow is the only account-creation path in production)") but not previously recorded here. Confirmed via direct read: no check against existing admin/profile rows exists in `+page.server.ts`.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-1-teacher-student-account-management.md`
  summary: `messages/bo.json`'s values are English placeholders, not real Tibetan translations, despite dedicated `[lang='bo']` typography (`--font-tibetan`) already wired up in `src/app.css`.
  evidence: Already flagged in this spec's own Implementation Notes ("per the design-tokens doc's own 'flag, don't fabricate' principle... not confident producing accurate Tibetan UI copy... pending native-speaker review") but not previously recorded here. Needs a native Tibetan speaker, not more engineering, to resolve.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: Student sign-in has no rate limiting or lockout -- a 6-digit numeric PIN (10^6 space) paired with a username deterministically derivable from the registration name, with no throttling anywhere in the codebase or planning docs.
  evidence: Story 1-2's own bmad-build review (blind-hunter layer) confirmed no rate limiting exists on the `/login` action or in this project's Supabase Auth configuration. Bounded impact today (RLS still scopes a compromised student session to that student's own data only), but a real hardening gap for a system holding minors' data. Needs its own throttle/lockout design, not a smallest-fix patch.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: No "reissue credentials" flow exists if a student's one-time-shown username/PIN is lost after approval (or, symmetrically, if a teacher's one-time temp password from Story 1-1 is lost).
  evidence: Story 1-2's own bmad-build review (blind-hunter layer) confirmed no such action exists anywhere in the diff. Mirrors an already-existing, unaddressed gap for teachers from Story 1-1 -- needs one design covering both roles, not a per-story patch.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/1-2-student-self-registration-approval.md`
  summary: Two admins/teachers approving the same pending student at the same moment could race between `requests/+page.server.ts`'s RLS-scoped pre-check read and its final `profiles` update, potentially diverging `auth.users.email` from the persisted `profiles.email`.
  evidence: Story 1-2's own bmad-build review (edge-case-hunter layer) identified the narrow TOCTOU window. Low real-world likelihood in a single-admin, low-volume tool; a real fix needs a transactional/locking approach beyond a smallest-fix patch.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/3-2-recurring-homework-assignments.md`
  summary: `messages/bo.json`'s new recurring-homework keys (`homework_mode_legend`, `homework_series_*`, etc.) are verbatim English copies, not real Tibetan translations, unlike the parallel `de.json` additions which are properly localized.
  evidence: Story 3-2's own bmad-build review (blind-hunter layer) confirmed by direct diff comparison. Same class of gap already logged for Story 1-1's original bo.json content (see above) -- recurs here because each new batch of keys needs its own native-speaker pass; needs a native Tibetan speaker, not more engineering, to resolve.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/3-2-recurring-homework-assignments.md`
  summary: `src/lib/server/rls.spec.ts`'s Story 3-2 coverage exercises `homework_assignments`/`homework_instances` directly via Supabase clients and never through the actual SvelteKit form actions (`createAssignment`'s weekly branch, `editSeries`, `pauseSeries`, `endSeries`) or the teacher homework page's `load` function (multi-instance grouping/sort order).
  evidence: Story 3-2's own bmad-build review (verification-gap layer) confirmed no load-function or action-level test scaffolding exists anywhere in this repo (no Playwright/e2e tooling, no mocked-`locals.supabase` unit tests). Matches this codebase's established convention of relying on RLS-layer tests + human walkthrough for this route; building that scaffolding is disproportionate to a single story.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/4-1-streaks.md`
  summary: `messages/bo.json`'s new streak keys (`student_streak_label`, `student_streak_weeks`, `student_streak_empty`) are verbatim English copies, not real Tibetan translations.
  evidence: Story 4-1's own bmad-build review (blind-hunter and edge-case-hunter layers, both independently) confirmed by diff comparison; verification-gap additionally confirmed 0/289 string values in the entire `bo.json` file contain Tibetan script anywhere, so this is pre-existing and codebase-wide, not specific to this story. Same recurring pattern already logged for Stories 1-1, 1-2, and 3-2's bo.json additions above -- needs a native Tibetan speaker, not more engineering, to resolve.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/4-3-team-leaderboard.md`
  summary: `messages/bo.json`'s new `leaderboard_*` keys (`leaderboard_section_label`, `leaderboard_heading`, `leaderboard_rank_label`, `leaderboard_streak_weeks`, `leaderboard_row_aria_label`, `leaderboard_empty`) are verbatim English copies, not real Tibetan translations.
  evidence: Story 4-3's own bmad-build review (blind-hunter layer) confirmed byte-for-byte identity with the English strings. Same recurring pattern already logged for Stories 1-1, 1-2, 3-2, and 4-1's bo.json additions above -- needs a native Tibetan speaker, not more engineering, to resolve.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/4-3-team-leaderboard.md`
  summary: The installed Supabase CLI's `supabase gen types` regenerates `src/lib/supabase/database.types.ts` in a way that drops hand-maintained trailing type aliases (`SkillArea`, `BadgeType`, `HomeworkStatusValue`, etc.) and downgrades several enum columns to plain `string` -- discovered while implementing Story 4-3 (which hand-patched around it instead of regenerating), but not tracked anywhere a future contributor would see it before blindly re-running the regen command.
  evidence: Story 4-3's own bmad-build review (blind-hunter layer) confirmed this is documented only as prose in that one story's Implementation Notes, with no discoverable warning in CLAUDE.md, the architecture doc, or elsewhere in the repo. Pre-existing CLI-version regression, not caused by Story 4-3, but that is where it was first encountered and worked around.

- source_spec: none
  summary: Student data-deletion request, admin approval gate, and the DB-trigger cascade that hard-deletes a student's records across every table that references them (profiles, attendance_records, skill_status_history, homework_status_history, student_streaks, badges_earned, team_id), leaving a de-identified audit trail on the deletion_requests row.
  evidence: Split from Story 5-1 ("Admin cross-class oversight & data deletion") at bmad-build's multi-goal check -- the dashboard and the deletion flow are independently shippable (different schema, different risk profile, no shared dependency in either direction) and this app's first genuinely destructive/irreversible UI action has no existing confirmation pattern to reuse (per epic-5-context.md's UX & Interaction Patterns section), making it disproportionate to squeeze into the same spec as a read-only aggregate dashboard. User chose to split and build the dashboard first.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/5-1-admin-cross-class-oversight-data-deletion.md`
  summary: The admin dashboard's completion tile reads the entire (paginated) `homework_status_history` table on every `/admin` load just to compute one percentage; as the table keeps growing, this means more sequential round-trips per load, with no follow-up ticket to move to a DB-side aggregate/RPC.
  evidence: Story 5-1's own bmad-build review (blind-hunter and edge-case-hunter layers, both independently) confirmed the table already exceeds `api.max_rows` (1000) in dev. The "no new migration" boundary that forced the pagination approach is a story-level constraint, not something a hard iteration cap can safely patch around -- capping pages would silently re-truncate results, recreating the exact undercount bug the pagination was written to fix. Needs a future story once a migration/RPC is back in scope.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/5-1-admin-cross-class-oversight-data-deletion.md`
  summary: No test independently guards the new `/admin` nav link's admin-only gating beyond its visual nesting inside `+layout.svelte`'s existing `{#if data.profile.role === 'admin'}` block.
  evidence: Story 5-1's own bmad-build review (blind-hunter layer) confirmed this repo has no Svelte-component or e2e test harness for any nav link at all, including the pre-existing teams/classes/teachers links in the same `{#if}` block -- pre-existing, codebase-wide convention (matches the already-logged Story 3-2 deferred entry on load-function/action-level test scaffolding), not a gap introduced by this story specifically.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/5-1-admin-cross-class-oversight-data-deletion.md`
  summary: `admin/+page.server.ts`'s `Promise.all` over its six parallel queries has no `.catch()`, so a rejecting query (a thrown fetch/network error, as opposed to a returned `{error}` tuple) would surface as a raw 500 instead of the intended `loadError` banner.
  evidence: Story 5-1's own bmad-build review (edge-case-hunter layer) confirmed no other loader in this codebase (student, teacher, leaderboard) wraps Supabase calls in try/catch either -- an existing, codebase-wide characteristic of how thrown (not returned) Supabase errors are handled, not something this story introduced or worsened.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/5-1-admin-cross-class-oversight-data-deletion.md`
  summary: Only 1 of the 6 `loadError` OR-chain branches (`historyError`) in `admin/+page.server.ts` is exercised by any test; dropping any of the other five terms would silently suppress that query's error banner without a test failing.
  evidence: Story 5-1's own bmad-build review (verification-gap layer, pre-verified) confirmed the five untested branches are structurally identical one-liners in a single boolean expression -- low risk relative to the story's patched findings, worth revisiting only if this file changes again.

- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-1-class-days-sessions.md`
  summary: Month-grid calendar UI (user decision 2026-09-25) — replace/augment 6-1's month-scoped agenda list with a month grid where each day cell shows its sessions, selecting a day opens its session list with role-gated edit controls, keyboard-navigable and usable at phone width (compact cells, day detail below grid).
  evidence: Split at the step-02 token gate: the 6-1 spec measured ~2,200 tokens (limit 1,600) and the user chose to defer the grid; 6-1 ships the same data, actions and month navigation with a list view, so the grid is purely a presentation layer over 6-1's `?month=` load and can ship independently.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-1-class-days-sessions.md`
  summary: A class created mid-year gets sessions on every past class day; decide in 6-2 whether those count as missed for attendance and streaks.
  evidence: create_sessions_for_class() in 0018 inserts for all existing class_days. Unverified medium: it only harms users if 6-2 treats sessions from before the class existed as missed; settle it when 6-2 defines which sessions count.
  resolved: 0019's schedule_starts_on limits a new class's sessions to its schedule start, and in 6-2 (0021) a session only counts as a session week once it has a mark, so unmarked past sessions are holidays. Weeks before a student's enrollment only end a streak that has already ended, so they need no extra rule.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-1-class-days-sessions.md`
  summary: RLS suites (incl. Story 6-1) are skipped when no local Supabase is running, and there is no CI, so database regressions can pass `npm test`.
  evidence: every block in src/lib/server/rls.spec.ts is describe.skipIf(!reachable); the repo has no .github/ workflow. Repo-wide, pre-existing pattern.

- source_spec: `_bmad-output/implementation-artifacts/spec-47-calendar-month-grid.md`
  summary: The Tibetan (`bo`) message file carries English copies for new calendar dialog strings (and earlier keys); they need real translations.
  evidence: `messages/bo.json` calendar_dialog_close, calendar_time_label, calendar_date_label, calendar_class_day_chip, calendar_day_button_label, calendar_admin_click_hint are identical to `en.json`.

- source_spec: `_bmad-output/implementation-artifacts/spec-50-signup-role.md`
  summary: Public supabase.auth.signUp still sends a "Confirm your email address" mail to any address, even when handle_new_user() refuses the sign-up at commit (forged or no role), so anyone can trigger mails and use up the Auth email rate limit.
  evidence: Reproduced locally 2026-09-26 (forged role admin → 500, Mailpit received the confirmation). Existed before #50 (those sign-ups used to succeed and mail). Closed by moving /join to a server action using the Admin API and disabling public sign-up (spine AD-11), planned with the Parent stories.
- source_spec: `_bmad-output/implementation-artifacts/spec-50-signup-role.md`
  summary: No test runs the admin "create teacher" action (src/routes/admin/teachers/+page.server.ts), so a regression in its createUser payload (e.g. the role moving back to user_metadata, which 0020 refuses) would go unnoticed.
  evidence: The verification-gap review found only comment references to the action in src and e2e; the rls.spec test hand-copies the payload. The action was never tested before #50 either. Fix: pull the createUser options into a $lib/server helper used by both the action and the test, or add an e2e that submits the Teachers form.
- source_spec: `_bmad-output/implementation-artifacts/spec-50-signup-role.md`
  summary: The whole RLS suite, including the #50 sign-up role tests, is skipped silently when local Supabase isn't reachable, so `npm run test` can be green without testing any database rule.
  evidence: rls.spec.ts uses describe.skipIf(!reachable) with a 1.5 s health check; the repo has no CI that guarantees Supabase is up. Project-wide convention, not introduced by #50. Fix: a required test run with Supabase up (CI or a pre-push check), or fail instead of skip when an env flag demands it.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-student-class-visibility-test.md`
  summary: classes_select_own_student (0014, via is_enrolled_in_class since 0016) has no dedicated RLS tests; nothing checks that a pending student with profiles.class_id set sees no classes, or that a student enrolled in two classes sees both but never an unenrolled class.
  evidence: The only student `classes` read in rls.spec.ts is the Story 5-1 regression assertion (single approved enrollment). The gap dates from 0014/0016, which added the policy without tests.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-2-attendance-per-session-calendar-holidays.md`
  summary: The epic's attendance UX (a `<button aria-pressed>` per student, 48px targets, one-handed) isn't built; the roster form still uses ix-checkbox.
  evidence: epic-6-context.md UX section; unchanged by 6-2.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-2-attendance-per-session-calendar-holidays.md`
  summary: Enrolling or unenrolling a student doesn't recompute their streak, although their classes decide which weeks are session weeks.
  evidence: No trigger on class_enrollments calls recompute_student_streak; same before 6-2.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-2-attendance-per-session-calendar-holidays.md`
  summary: RLS tests pick random years and (4-1 via sessionFor) create class days on real recent dates in the shared local DB, which also spawn sessions for real classes.
  evidence: 6-2 review; local dev data only. Fix: derived years per test and cleanup of created class days/sessions.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: Dual role — a signed-in teacher/admin requests parent capability (own pending `parents` row from My Profile), the admin creating a teacher whose email already has a parent-only login promotes it instead of duplicating, and a "Teacher · Parent" / "Admin · Parent" toggle at the top of the menu (remembered in a cookie, one role's items at a time; user choice 2026-09-26).
  evidence: Split from 7-1 at the scope gate (spec ~3,000 tokens vs 1,600 target). Nothing in 7-2..7-6 depends on it; AD-4 already fixes the data model (parents row, RLS unions everything a login holds).
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: Production Auth email (custom SMTP under the org account, provider not chosen) must be configured before parents go live, or confirmation mails won't reach them.
  evidence: 7-1 uses local Mailpit only (user choice 2026-09-26); epic-7-context Conventions and ARCHITECTURE-SPINE hosting decision require custom SMTP for production.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: rls.spec.ts is not re-runnable on the same local DB — Story 4-1's createClass() uses fixed names (`Story 4-1 ${prefix}`) against classes_name_unique_idx, so a second `npm test` without `supabase:reset` fails 33 tests (1-1..4-x blocks).
  evidence: 7-1 verification: second run failed with "duplicate key value violates unique constraint classes_name_unique_idx"; after reset 400/400 pass. Pre-existing, not caused by 7-1.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: A signed-in user (now also a parent) can change their auth email with supabase.auth.updateUser; profiles.email is never re-synced, so the parent duplicate-email lookup and any profile email display go stale.
  evidence: 7-1 review B4. Only email_confirmed_at is mirrored (0006 sync_email_confirmed_at); same gap for teachers since 0001. Fix: block self-service email change or sync auth.users.email to profiles.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: The 7-1 parent strings in messages/bo.json are English copies; they need real Tibetan translations before release.
  evidence: 7-1 review B12; matches the existing practice for newer bo keys.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: Parent registration collects an adult's name and email without a privacy notice or consent link.
  evidence: 7-1 review B13; belongs to the go-live-blocking GDPR open question in SPEC.md.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-1-parent-accounts-admin-approval-my-profile.md`
  summary: A pending or rejected parent can read school-wide team leaderboard totals (team_leaderboard()) and class_days, which are open to any authenticated user.
  evidence: 7-1 review E10/E14; pre-existing policies (0018, leaderboard). Aggregates only, no student personal data; revisit with 7-3's parent read scoping.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-2-parent-first-student-registration-linking.md`
  summary: The teacher approving a student on /requests cannot see which parent (guardian email or parent name) the student is linked to, so a mistyped but valid parent email is approved blind.
  evidence: 7-2 review triage #6; harm begins when 7-3 grants reads through is_parent_of(); 7-6 is the correction path. Consider showing the linked parent on the /requests card in 7-3.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-2-parent-first-student-registration-linking.md`
  summary: The anonymous /join parent pre-check (and /register's emailHasLogin) answers found / not found with no rate limiting, allowing enumeration of approved parent emails.
  evidence: 7-2 review triage #7; the found/not-found response is intent, throttling exists nowhere in the app.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-2-parent-first-student-registration-linking.md`
  summary: handle_new_user() does not require guardian_consent_given_at for a user_metadata student, so a crafted anon signUp() creates a pending student without recorded consent.
  evidence: 7-2 review triage #8; consent has only ever been enforced in the /join server action.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-3-parent-child-overview-details-read-only.md`
  summary: Parent child detail page /parent/children/[id] (read-only homework by status with due dates and links, attendance via child_attendance, skills with history and notes, streak, badges, team and leaderboard, upcoming sessions, teachers via class_people), built on 7-3's parent read access.
  evidence: Split from 7-3 at planning (spec ~2,900 tokens vs 1,600 target); the user chose to split. 7-3 keeps all parent RLS reads and the overview cards; 7-4 adds leave answers to this page.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-3-parent-child-overview-details-read-only.md`
  summary: Student and teacher loaders other than the student dashboard still compute "today" as the UTC date (toISOString), so for 1-2 hours after Berlin midnight their overdue flags disagree with the Berlin-based dashboard tiles and homework_counts.
  evidence: 7-3 review triage #7; switch the remaining loaders to todayInBerlin().

- source_spec: `_bmad-output/implementation-artifacts/spec-51-schedule-interval.md`
  summary: Older RLS test blocks (Stories 1-1 to 5-1) create classes with fixed names ("Class A", "Story 4-1 <prefix>", ...) and fail with classes_name_unique_idx once a previous run's rows remain in the local DB.
  evidence: Full `npm test` on 2026-09-27: 33 failures, all "duplicate key value violates unique constraint classes_name_unique_idx"; local DB holds 667 classes; blocks unchanged by #51. Fix: random suffix in those fixture names (as 6-x blocks do).
- source_spec: `_bmad-output/implementation-artifacts/spec-51-schedule-interval.md`
  summary: Story 6-4 RLS test "schedule edit: past sessions unchanged..." is flaky (2 of 5 runs) because it re-adds past class days (random 1901-1999) that earlier runs left behind, so no session is created for them.
  evidence: Implementation subagent reruns on 2026-09-27; the #51 interval-edit test avoided it by adding class days before inserting the class. Same reorder fixes the old test.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-4-parent-session-leave-planned-vs-short-notice.md`
  summary: Classmate and team UI for session leave answers, via `session_leave_masked` (Sick shown as On leave).
  evidence: 7-4 decision 3A builds and tests the masked function only; no screen uses it yet (SPEC CAP-11 visibility to classmates and team).
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-4-parent-session-leave-planned-vs-short-notice.md`
  summary: Browser-level (Playwright) test of the parent leave flow on `/parent/children/[id]`: On leave shows the Planned/Short-notice preview before anything is saved, and confirming saves.
  evidence: The repo has no component-test setup (vite.config.ts runs the server project only) and one calendar e2e; wiring On leave straight to ?/setLeave would pass every current test (7-4 review triage #5).
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-5-sick-leave-with-teacher-approval.md`
  summary: Add `load` tests for `/requests` (including a failing `sick_leave_queue` setting `loadError`, so a queue failure never looks like an empty queue).
  evidence: `src/routes/requests/page.server.spec.ts` imports only `actions` and `loadSickLeave`; no test calls the route's `load` for any query (7-5 review triage #7).
- source_spec: none
  summary: Guardian email correction — a student requests a guardian email change, the admin approves it, and approval moves the child to the new approved parent (guardian_email + parent_id together, AD-10).
  evidence: Split from story 7-6 on 2026-09-27; it ships independently of the parent deletion request (separate table, trigger and UI). Build it as its own story.
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/7-6-parent-deletion-request.md`
  summary: Run the RLS/trigger suite (rls.spec.ts) in CI against a Supabase service, so the deletion erasure and self-decision guards can't silently go untested.
  evidence: Every RLS block uses `describe.skipIf(!reachable)`; there is no .github/workflows, so without local Supabase the 7-6 erasure tests skip and only mocked route specs run (7-6 review triage #3).
- source_spec: `_bmad-output/implementation-artifacts/spec-7-3-parent-child-detail-page.md`
  summary: Playwright check of the parent child page: leave and deletion posts return to their tab without JS, homework reference anchors carry target=_blank rel="noopener noreferrer", and the active tab has aria-current.
  evidence: Only route data is unit-tested; the repo has one calendar e2e and no parent fixtures (detail-page review triage #10).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-62-64-header-avatar.md`
  summary: Playwright header check: no role text in the header; the avatar menu shows My Account then Sign out; My Account opens /account; Sign out ends the session; a signed-out page has the language picker and no avatar; the avatar button's accessible name.
  evidence: Sign out and My account now exist only in the avatar menu; vitest is node-only and the one e2e is calendar (B2 review triage #5).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-62-64-header-avatar.md`
  summary: Verify at phone width that the signed-in language dropdown, folded into iX's header overflow menu, opens and switches language.
  evidence: maybe-false/medium — nested ix-dropdown-button inside the header overflow dropdown is untested; settle with a phone-width manual or e2e check (B2 review triage #6).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-53-54-class-code-copy.md`
  summary: Teacher class page (`teacher/classes/[id]`, "Code: {code}") and teacher dashboard class cards could use `CopyField` for the class code too.
  evidence: B3 added copy for students and the admin only (#53/#54); teachers are the main people who hand out codes (B3 review).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-53-54-class-code-copy.md`
  summary: "Copy join link" (`/join?code=…`) with `/join` pre-filling the class code from the query string.
  evidence: The copied code alone doesn't tell the recipient where to enter it (B3 review); pairs with #67 (join another class).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-58-parent-calendar.md`
  summary: Playwright parent calendar check: Calendar in the parent menu; picker only with 2+ children; ?child= narrows and survives month navigation; child answer lines link to ?tab=sessions; cancelled sessions list no answers.
  evidence: Only the loader is unit-tested; e2e has no parent login (B4 review triage #5).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-58-parent-calendar.md`
  summary: Integration check (rls.spec) that the parent calendar's leave-history read returns the newest answer per (session, child).
  evidence: maybe-false/medium — the unit fake ignores .order(); same gap as the 7-4 student branch (B4 review triage #6).
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-52-admin-parents.md`
  summary: Admin Playwright check of /admin/parents: Parents in the admin nav; status pills (Approved/Pending/Rejected, Email not confirmed); children with (pending)/(rejected) markers and "—"; the /requests link only when parents are pending.
  evidence: Only the loader is unit-tested; no component tests or admin e2e journey (B6 review triage #8).
- source_spec: none
  summary: B8 — iX form fields, part 2 (#66): admin, teacher, homework, calendar and requests forms moved to ix-input/ix-select/ix-textarea/ix-date-input/ix-radio/ix-checkbox.
  evidence: Split from the batch 4 intent (B7–B10) under the single-goal rule; builds on B7's shared field patterns.
- source_spec: none
  summary: B9 — /join registration as ix-workflow-steps (class code → details → done/waiting) (#63).
  evidence: Split from the batch 4 intent; depends on B7 converting the join fields.
- source_spec: none
  summary: B10 — ix-breadcrumb on nested pages (parent › child › tab, admin classes › class › students, teacher classes › class › homework) (#61).
  evidence: Split from the batch 4 intent; independent of the form-field work.
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-66-b7-ix-form-fields-part1.md`
  summary: B7b — iX form fields on the auth pages (login, register, forgot/reset password, join) and /account; credential fields (email/username/password/confirm/current password) stay native styled to match iX, other fields (display name, class code, registration name, guardian email) become ix-input.
  evidence: Split at the B7 token gate (spec ~1750 tokens). User decision 2026-09-28: option A — keep credential fields native because ix-input hard-codes autocomplete="off" and would break password managers.
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-66-b8a-ix-page-fields.md`
  summary: B8b — iX form fields on the teacher class page (session select; per-student skill level + notes as collapsible student rows whose form loads when expanded) and homework new/edit (ix-radio groups for mode/target, dates, number, textarea, subset ix-checkboxes).
  evidence: Split from B8 (8 page areas, well over the spec-size target), user decision 2026-09-28. Also user decision 2026-09-28: per-student skill fields become collapsible rows, because ~6 iX components per student (~180 for 30 students) risks the /calendar freeze seen in B7.
- source_spec: `_bmad-output/implementation-artifacts/spec-mv-66-b8b-ix-teacher-homework-fields.md`
  summary: Make `npm run test:e2e` (on a freshly reset DB) part of the pre-commit rule or a CI job, so UI-only regressions can't pass reset/test/check/build alone.
  evidence: Vitest only collects src/**/*.spec.ts, there is no .github/workflows, and the B7–B8 UI behaviour is verified only by e2e (B8b review V1).
- source_spec: `_bmad-output/implementation-artifacts/spec-57-b11-date-range-leave.md`
  summary: Test set_leave_range's mid-save refusal path (a session started/cancelled/decided between preview and insert is skipped and the rest saves).
  evidence: Needs two concurrent transactions in rls.spec.ts (B11 review V2); the handler is otherwise only reasoned about.
- source_spec: `_bmad-output/implementation-artifacts/spec-68-b14-request-parent-access.md`
  summary: B14b — H-8 promotion: when the admin creates a teacher whose email already has a parent-only login, promote that login to teacher (keeping its parents row and linked children) instead of failing with `email_exists`.
  evidence: User chose to include H-8 in B14 (2026-09-29); split out because it changes `profiles.role` and the teacher-creation / temp-password flow, a separate shippable goal from the request path (spec ~2,000 tokens vs 1,600 target).
- source_spec: `_bmad-output/implementation-artifacts/spec-68-b14-request-parent-access.md`
  summary: Admin "link child to parent" on /admin/parents, so students registered before their teacher/admin parent was approved (parent_id null) can be linked.
  evidence: User decision 2026-09-29 (B14 Q3): B14a only links children who register at /join after approval.
- source_spec: `_bmad-output/implementation-artifacts/spec-68-b14-request-parent-access.md`
  summary: Admin "reopen" for a rejected staff parent-access request (today a rejected row can only be reset in SQL; the card says "contact the admin").
  evidence: B14a review (blind + edge): RPC refuses hint `rejected`, `stamp_parent_review` refuses rejected→pending, the retry button is hidden for staff rows. User chose no re-request (Q2a) for B14a.
- source_spec: `_bmad-output/implementation-artifacts/spec-68-b14-request-parent-access.md`
  summary: Revoke parent access (staff or admin removes an approved parents row) — no path exists for any login.
  evidence: B14a review (blind); pre-existing for parent-only logins too.
- source_spec: `_bmad-output/implementation-artifacts/spec-68-b14-request-parent-access.md`
  summary: Removing a teacher who is an approved parent with linked children fails with the generic "remove failed" error; show a specific message (unlink children first).
  evidence: B14a review (edge): `profiles.parent_id` references `parents` ON DELETE RESTRICT (0024:41); `admin/teachers` remove → `deleteUser` fails. Blocking is safe, only the message is unclear.
- source_spec: `_bmad-output/implementation-artifacts/spec-68-b14b-parent-to-teacher-promotion.md`
  summary: e2e for the /admin/teachers "Edit classes" flow (Classes updated toast, edit panel closes); only create and (after B14b) remove are exercised in the browser.
  evidence: B14b review (verification-gap): the `$effect` branches for `updated` / `removed` were restructured (untrack) and no e2e runs Edit classes; untested before B14b too.
- source_spec: none
  summary: PDF upload per syllabus section (the app's first file storage): PDF only, at most 1 MB per file (user, 2026-10-08), files private to the class's teachers and enrolled students, with "replace an uploaded file with a newer version" as a Should.
  evidence: Split from "syllabus sections with PDF upload" (user chose Split, sections first, 2026-10-08; brainstorm log `_bmad-output/brainstorming/brainstorm-syllabus-multiple-items-and-pdf-2026-10-08/.memlog.md`). Still open: how many files a section may hold; what happens to a stored file when its section or syllabus is deleted; storage notes in `docs/deployment-and-costs.md` section 4 (backups not confirmed).
- source_spec: none
  summary: Parents of a class's enrolled children can read that class's syllabus and its sections (new access rule and a view on the parent's child page).
  evidence: User decided in the brainstorm that students, parents and teachers of the class see the syllabus, then chose "later, as its own change" (2026-10-08). Parents have no syllabus page and no `class_syllabi` access today.
- source_spec: none
  summary: Search across a syllabus's sections, and archive (hide without deleting) old sections.
  evidence: Ranked Should in the brainstorm's MoSCoW (2026-10-08); left out of the sections spec to keep it to one goal. Deleting a section and ordering sections are in that spec.
- source_spec: `_bmad-output/implementation-artifacts/spec-syllabus-sections.md`
  summary: Keep keyboard focus after a form post: a button that submits (for example a section's move arrow) is disabled while the post runs and can stay disabled afterwards, so focus is dropped.
  evidence: Review of syllabus sections (blind layer): the move arrows disable at the top and bottom. Pre-existing app-wide: every button is disabled through `pending.busy` during a post (72 uses in `src`).
- source_spec: `_bmad-output/implementation-artifacts/spec-syllabus-section-pdf.md`
  summary: Sweep the `syllabus-files` bucket for objects whose row is gone (by folder after a section, syllabus or class delete, or as a scheduled or admin job).
  evidence: Review of section PDF upload (blind and edge layers): cleanup is row-driven, so an object left by a failed cleanup, by an upload racing a section delete, or by a replace whose old object could not be removed is never removed later and stays readable by the class. Needs a storage failure or a same-moment race; the migration header has the query that lists such objects.
- source_spec: `_bmad-output/implementation-artifacts/spec-96-weekly-homework-first-copy.md`
  summary: Decide what a weekly homework series with a start date in the past should do: today it creates one copy per elapsed week (many already overdue), these can trigger "Due soon" and "Overdue" notifications the next morning, and a start date more than 104 weeks back never reaches the current week because the loop restarts at the start date and counts weeks that already exist.
  evidence: Review of #96 (blind, edge and verification layers). Pre-existing in the nightly generator (0016) and the notification rules (0037); #96 only makes the copies appear at once. Options: limit how far back a start date may lie, create only the current week on creation, or exempt backfilled weeks from notifications; fix the loop to count created weeks only.
- source_spec: `_bmad-output/implementation-artifacts/spec-98-one-student-per-parent-and-name.md`
  summary: Before 0042 goes to the hosted database, list students that share a parent and name there and decide by hand which account each child keeps.
  evidence: Review of #98 (blind layer). The local database had no students, so the reported second account exists elsewhere. 0042 stops with a count and a hint query while such rows exist, and blocks later migrations until they are sorted out.
- source_spec: `_bmad-output/implementation-artifacts/spec-98-one-student-per-parent-and-name.md`
  summary: Check whether the hosted database has students with no parent link; the one-account-per-parent-and-name rule does not cover them.
  evidence: Review of #98 (blind layer), unverified, would be medium. 0024 left existing students with `parent_id` null. Settled by `select count(*) from profiles where role = 'student' and parent_id is null` on hosted.
- source_spec: `_bmad-output/implementation-artifacts/spec-98-one-student-per-parent-and-name.md`
  summary: An automated check that a migration's stop-on-bad-data guard fires (0042's guard was tried once by hand).
  evidence: Review of #98 (verification layer). The repository has no harness that runs a migration over seeded rows.
- source_spec: `_bmad-output/implementation-artifacts/spec-99-auto-team-assignment.md`
  summary: Database tests on an empty, isolated database: the `no_teams` refusal of 0043, exact team sizes from empty (3, 2, 2), and that ties are not always filled in the same order.
  evidence: Review of #99 (blind and verification layers). The shared test database always holds teams with students, so these cases were checked by hand with a script that was not kept. Same missing harness as the #98 entry above.
- source_spec: none
  summary: A parent sees each linked child's username and PIN in their own account, pending children included, and can reset the PIN (CAP-15 and the amended CAP-13 in `_bmad-output/specs/spec-class-tracker/SPEC.md`).
  evidence: Split from #100 at the build scope gate (user 2026-10-13): it can be reviewed and merged on its own, and it depends on the open question whether a PIN may be stored so that it can be displayed again.
- source_spec: `_bmad-output/implementation-artifacts/spec-100-credentials-at-registration.md`
  summary: At student registration, email the username and PIN to the parent's address with a link to the login page (CAP-15).
  evidence: Left out of #100 at planning (user 2026-10-13). The app sends no mail of its own; only Supabase Auth does. Needs a sending path (a Resend API key and sender address as Cloudflare secrets, or another route), counts against Resend's 100 mails a day, and must not fail the registration when sending fails.

- source_spec: `_bmad-output/implementation-artifacts/spec-101-guided-page-tours.md`
  summary: No browser test signs in a teacher-and-parent login and checks that the parent tours run while acting as parent and the teacher tours stay unseen (#101).
  evidence: Only `tourFor` is unit-tested with literal roles; `e2e/tours.e2e.ts` creates single-role users. Passing `data.profile.role` instead of the active role to `PageTour` in `src/routes/+layout.svelte` would break it with every test green. Needs a dual-role fixture and the role switch.
- source_spec: `_bmad-output/implementation-artifacts/spec-101-guided-page-tours.md`
  summary: No test asserts that Help's "Show me around this page" closes the side-menu overlay at phone width before the tour starts (#101).
  evidence: `replayTour()` in `src/routes/+layout.svelte` closes the menu below the wide breakpoint; the replay e2e test runs at desktop width only. Checked by hand at 390px during the build.
- source_spec: `_bmad-output/implementation-artifacts/spec-102-attendance-corrections.md`
  summary: `attendance_records.recorded_at` has only a default and no stamping trigger (AD-5), so a caller can set it; the latest-mark rule (`attendance_current`, 0045) depends on it, and an exact tie falls to the random uuid `id`.
  evidence: #102 review B7/E6. 0003 gives the column `default now()` only. Pre-existing; only the class's teachers and the admin can insert. Fix: a BEFORE INSERT trigger that stamps `recorded_at`.
- source_spec: `_bmad-output/implementation-artifacts/spec-102-attendance-corrections.md`
  summary: No index supports `attendance_current`'s sort (`class_id, class_session_id, student_id, recorded_at desc, id desc`); every read of the view sorts the class's (or the student's) marks.
  evidence: #102 review B10. Existing indexes: `(student_id, recorded_at desc)`, `(class_id)`, `(class_session_id)`. Fine at school scale; add the index when the teacher's class page or the streak recompute gets slow.
- source_spec: `_bmad-output/implementation-artifacts/spec-102-attendance-corrections.md`
  summary: The one-time streak recompute in 0045 and its two proofs (no mark changed; stored streak equals `compute_student_streak`) are tested only on an empty table: `supabase db reset` applies the migration before any mark exists.
  evidence: #102 review G4. The data steps were replayed by hand in a rolled-back transaction on a local database with 12 re-marked (session, student) pairs and passed; no automated test applies a migration to existing data.
- source_spec: `_bmad-output/implementation-artifacts/spec-103-ended-series-no-new-copies.md`
  summary: Ending a weekly series leaves the copies students already have, so a teacher who creates a wrong series, ends it and creates a replacement still gives students two homeworks; the end dialog (`homework_series_end_confirm`) does not say so.
  evidence: #103 review. Since #96 a series gets its copy at creation, and ending never touches existing copies (decided in 3-2, kept in #103). The teacher has to archive the copy by hand. Options: say it in the dialog, or offer to archive this week's copy when ending.
- source_spec: `_bmad-output/implementation-artifacts/spec-103-ended-series-no-new-copies.md`
  summary: Homework pages other than the series page still take "today" from UTC, so between 00:00 and 02:00 in Munich a series ended just then shows "Ended" on its own page but still counts as open in the teacher's list and dashboard.
  evidence: #103 review. `new Date().toISOString().slice(0, 10)` in `src/routes/teacher/+page.server.ts:58`, `teacher/classes/[id]/+page.server.ts:228`, `teacher/classes/[id]/homework/+page.server.ts:51` and the four student homework/class loaders; `isOpen` compares `endsOn <= today`. Pre-existing for due dates too. Fix: `todayInBerlin()` in all of them.
- source_spec: `_bmad-output/implementation-artifacts/spec-103-ended-series-no-new-copies.md`
  summary: Teachers can still write `homework_assignments.ends_on` directly through the API (0005 column grant): setting it back to null on an ended series makes the next nightly run catch up every week skipped meanwhile, although the dialog says ending cannot be undone.
  evidence: #103 review. Pre-existing (a null `ends_on` resumed a series before #103 too); the app has no such action. Fix: a trigger that lets `ends_on` be set once, to today or earlier.
- source_spec: `_bmad-output/implementation-artifacts/spec-103-ended-series-no-new-copies.md`
  summary: No test covers the `endSeries` action or the series page's load (the route has no `page.server.spec.ts`), so nothing pins that the end date is Munich's.
  evidence: #103 review. The database rule is tested in `rls.spec.ts`; the action's date is a one-line `todayInBerlin()` call checked by reading.
- source_spec: `_bmad-output/implementation-artifacts/spec-103b-ending-series-existing-copies.md`
  summary: A weekly series that is already ended or paused has no "archive the remaining copies" action; its copies can only be archived one by one, each with its own question.
  evidence: #103b review. The tick and the End button show only while the series is active (`isSeriesInactive` in the series page). Covers series ended before #103b and a ticked end whose archive step failed.
- source_spec: `_bmad-output/implementation-artifacts/spec-103b-ending-series-existing-copies.md`
  summary: Nothing tests the end-series tick box in a browser (tick, which question is asked, which toast) or the student's page after a ticked end; `e2e/` has no weekly-series test.
  evidence: #103b review. The action is tested with a fake client and the update against the local database; both acceptance criteria of the spec are unverified by a test or by hand.
- source_spec: `_bmad-output/implementation-artifacts/spec-103b-ending-series-existing-copies.md`
  summary: Archived copies lose the teacher's Mark done / Mark reviewed buttons and copies a student finished stay in the student's Done list; the archive questions say neither. The Tibetan texts use two words each for "archive" and "series".
  evidence: #103b review. `+page.svelte` hides both forms when `archivedAt` is set (same for a single archive); `bo.json` has "ཡིག་མཛོད་དུ་འཇུག" and "མཛོད་དུ་བཞག", "རིམ་པ" and "ཕྲེང་བ". Needs a Tibetan reader.
- source_spec: `_bmad-output/specs/spec-badge-detail/stories/2-per-subject-badges-and-access.md`
  summary: Add a browser/render test that two badges differing only by subject both render on the Badges tile (each-key includes the subject).
  evidence: No component or e2e test renders StudentProgressTiles; reverting the key to type-milestone would crash on duplicate keys unnoticed. Belongs with badge detail story 3, which replaces the tile.
- source_spec: `_bmad-output/specs/spec-badge-detail/stories/3-badge-icons-detail-and-progress.md`
  summary: Extend e2e badge coverage to the parent child page, the trophy-pill fallback, the top-badge state and closing the dialog with its Close button.
  evidence: e2e/badges.e2e.ts covers only /student, an icon milestone, a non-top badge and Escape; the parent page and those dialog paths have no rendered check.
- source_spec: `_bmad-output/specs/spec-badge-detail/stories/5-new-badge-celebration.md`
  summary: Replace the regex check of 0050's "existing rows count as seen" backfill with a test that applies the migration to pre-existing badge rows.
  evidence: rls.spec.ts only matches the SQL text; a reset DB has no badge rows when 0050 runs, and there is no harness to seed rows before a single migration.

- source_spec: `_bmad-output/specs/spec-navigation-latency/stories/1-local-jwt-verification-with-getclaims.md`
  summary: Callers read the unverified cookie `session.user` (`+layout.svelte:84`, `requests/+page.server.ts:129-212`, `parent/+layout.server.ts:16`, `parent/+page.server.ts:75`, `account/+page.server.ts:41-46`) instead of the verified `user` from `safeGetSession`.
  evidence: Pre-existing; the old `getUser()` code returned the same cookie session object. RLS still scopes queries to the token's `sub`, so a tampered `session.user.id` can mislabel UI or filters but not widen access. Fix: switch these reads to `user.id` / `user.email`, or rebuild `session.user` from the claims.

- source_spec: `_bmad-output/specs/spec-navigation-latency/stories/3-parallel-root-layout-and-one-query-parents-list.md`
  summary: `/admin/parents` reads parents and children unpaged, so past `max_rows = 1000` (local config.toml; also the hosted default) rows are dropped without a load error.
  evidence: Pre-existing: the old parents read was unpaged and the old `parent_id IN (...)` children read had the same cap. Fix: page with `.range()`, or read `count: 'exact'` and flag truncation. Only matters past 1 000 parents or 1 000 children with a parent.

- source_spec: `_bmad-output/specs/spec-navigation-latency/stories/5-rls-helpers-evaluated-once-per-query.md`
  summary: No automated check keeps the hot-table RLS policies in the once-per-query `(select auth.uid())` / `(select public.is_admin())` form; a later migration that copies an old bare definition would bring the per-row cost back with every test green.
  evidence: Verified: `rls.spec.ts` tests access only, and nothing in src, e2e or supabase reads `pg_policies` or `EXPLAIN`. Tests reach the DB only through supabase-js, which cannot see policy text. Cheapest fix: a service-role-only RPC returning `qual` / `with_check` for the hot tables, with an `rls.spec.ts` assertion that none contains a bare `auth.uid()` or `is_admin()`.

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/1-foundation-tailwind-shadcn-theme-isolation.md`
  summary: The scoped reset in `src/lib/ui/reset.css` (`[data-ui='new'] *:not(#__)`) would zero margins/padding and override fonts on any iX element placed inside a `data-ui="new"` root; story 2's new shell must not wrap still-iX page content in that root.
  evidence: Unverified (medium if true): not reachable in story 1, since no iX component sits inside a root. Settle it in story 2 by keeping `data-ui="new"` on the shell's own header/nav only, or by an `ix-visual` run after the shell lands.

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/1-foundation-tailwind-shadcn-theme-isolation.md`
  summary: The rules for new UI code (style with Tailwind utilities, since scoped Svelte `<style>` loses to the reset; add an `@source` line per migrated folder) live only in CSS comments; add them to the project's agent instructions (AGENTS.md / CLAUDE.md).
  evidence: Verified: the rule is in `reset.css` and `tailwind.css` headers only; an agent migrating a page would not read those before writing a `<style>` block. Agent-context edit, so deferred rather than patched.

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/2-new-app-shell.md`
  summary: Replace iX toasts with svelte-sonner behind the unchanged `showToast(type, message)` signature (`src/lib/ix.ts:266`), top-center below 80em and top-right from 80em, and move the 53 `page.locator('ix-toast')` e2e checks in 11 files to a `toasts(page)` fixture helper.
  evidence: Split from story 2 at checkpoint 1 (spec ~1,970 tokens); the shell works with iX toasts meanwhile. Belongs in spec-mobile-ux stories.yaml as its own story before story 3 (bmad-spec is the writer).

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/2-new-app-shell.md`
  summary: When Help is opened from a closing popup (avatar menu "Help", admin More sheet "Help"), the closing Bits UI popup restores focus to its trigger while the Help dialog's focus trap takes focus; keyboard focus may land outside the dialog.
  evidence: Unverified (medium if true): plausible from Bits UI's close-auto-focus behaviour, not checked in a browser. Settle it with a keyboard test (open Help from each entry point, assert `document.activeElement` is inside the dialog); fix with `onCloseAutoFocus={(e) => e.preventDefault()}` on the closing popup when Help was chosen.

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/3-parent-pages-pilot.md`
  summary: Regenerate all Help guide screenshots (`npm run help:screenshots`, `HELP_SCREENSHOTS=1`, images under `static/help`) once every role is migrated, in story 10.
  evidence: User decision at story 3 checkpoint 1: the Help guides keep showing the old iX pages until then; parent pages are the first to diverge.

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/3-parent-pages-pilot.md`
  summary: No test covers where focus goes for a leave-range `answer` error (`errorFieldId('answer')` → `range-answer-<value>`) or a no-field error (fallback `range-preview`) on `/parent/children/[id]`.
  evidence: Verified gap: no e2e posts an invalid answer or triggers `rangeField: null` (`+page.server.ts:538, 614, 645`). Reaching it needs a forged radio value; add it next to the existing forged-class case in `leave-range.e2e.ts`.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/4-student-pages.md`
  summary: The student homework detail page ignores `data.loadError`, so a failed status-history read shows "Not done yet" and offers Mark done for homework that may already be done.
  evidence: `+page.server.ts:70` sets `loadError` from `historyError`; neither the old iX page nor the new one reads it (pre-existing).
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/4-student-pages.md`
  summary: Without JavaScript, the sticky bottom tab bar covers the last control on a page (e.g. the dashboard's join Send button).
  evidence: The shell measures `--bottom-nav-height` with JS only (story 2); `student-mobile.e2e.ts` no-JS join test submits with Enter to work around it.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/4-student-pages.md`
  summary: No test checks that the New badge dialog returns focus to a mid-session opener (or leaves focus alone when leaving via the see-all link).
  evidence: All dialog tests open it right after sign-in/reload (focus on body); needs a fixture that earns a badge mid-session.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/5-shared-pages.md`
  summary: Migrate `/calendar` (session and day dialogs as phone bottom sheets, native date/time/number fields, @event-calendar/core restyle) off iX as story 5b, deciding there whether `ScheduleFields` moves with it or stays for story 8.
  evidence: Split at the story 5 scope gate (user chose Split): the calendar alone is 1320 lines with 36 iX elements and fragile dialog focus/stale-error logic, pushing the spec to ~2300 tokens.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/5-shared-pages.md`
  summary: Mark the viewer's own team row on `/leaderboard` (a student's team, a parent's child's team).
  evidence: Planned in story 5's matrix but the load (`leaderboard/+page.server.ts`) returns no own-team flag and story 5 forbids load changes; the old iX page never marked it either. User chose Defer at the step-3 matrix audit.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/5b-calendar.md`
  summary: Calendar action-error toasts (e.g. move day to its own date) may not be announced while the modal sheet/dialog makes the rest of the page inert.
  evidence: Unverified (medium if true). Pre-existing with the old iX modal; settle with a VoiceOver/NVDA check, or render action errors inline in the dialog.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/5b-calendar.md`
  summary: When the day that opened the calendar's day dialog is moved or deleted, focus falls to the body on close instead of a sensible fallback.
  evidence: Old `onClosed` and new `returnFocus` both give up when neither opener nor selector matches (phone list view drops the day); medium for keyboard and screen-reader users.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/5b-calendar.md`
  summary: Calendar focus return retries only tick + one animation frame before the re-rendered chip may exist.
  evidence: Unverified (medium if true). e2e `toBeFocused()` passes locally; settle with a CPU-throttled trace on a slow device.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/5b-calendar.md`
  summary: `createCalendarFixture` picks a random year and its cleanup deletes every class day in that year, so it fails (attendance FK) when another test left data in the same year.
  evidence: Story 5b verification rerun hit `attendance_records_class_session_fkey` in year 4405 ("7-4 Mixed" leftovers); ~49 of 6000 years are taken, so rare but real. Related: `src/lib/server/rls.spec.ts` leaves a "Dup 1" class that leaks into e2e runs after `npm test`.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6-auth-pages.md`
  summary: Migrate the join flow (join, join/pending, JoinSteps stepper, guardian consent checkbox) to the new UI as story 6b.
  evidence: Story 6's spec was ~2,400 tokens at the scope gate (limit 1,600); the user chose to split, and the join flow is the largest and riskiest independent part. Tracked as story 6b in spec-mobile-ux/stories.yaml.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6-auth-pages.md`
  summary: New-UI page headings (`ui.heading` and AuthCard's h1) use `leading-tight`, which overrides Tibetan's `line-height: 2`, so bo headings are cramped.
  evidence: tailwind.css's Tibetan rule says a `leading-*` utility still wins; `ui.heading` (classes.ts:16) carries `leading-tight` on every migrated page since story 3. Medium for bo users; fix once (e.g. a `:lang(bo)` override) rather than per page.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6-auth-pages.md`
  summary: Register's submit button in-flight state (disabled + aria-busy) is not covered by any e2e test.
  evidence: Unverified (medium if it regressed: double sign-up posts). Needs `page.route` delaying `?/register`; the old iX `loading` state was untested too.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6-auth-pages.md`
  summary: A double tap on auth/confirm's button may post the one-time token twice and land a confirmed user on `/login?error=confirm`.
  evidence: Unverified (medium if true); pre-existing with the old ix-button. Settle with an e2e that submits twice quickly; fix with a submit guard.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6b-join-flow.md`
  summary: On /join, focus falls to the page body after Continue, while sending, and after a server error toast; the guardian email gets no inline error.
  evidence: Pre-existing (the iX page never moved focus forward either; story 6b kept "no change"). Medium for keyboard and screen-reader users.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6b-join-flow.md`
  summary: Join step 2 (name) is not a form, so Enter / the phone keyboard's Go key does nothing there.
  evidence: Pre-existing; steps 1 and 3 are forms. Low.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6b-join-flow.md`
  summary: The join class code keeps surrounding spaces in the step-2 badge and the posted hidden `classCode`; only the RPC call trims it.
  evidence: Pre-existing; trim once the code is accepted. Low.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/6b-join-flow.md`
  summary: The class-code field stays editable while `validate_class_code` runs, so step 2 could show the old class with a newly typed code.
  evidence: Unverified (medium if true); pre-existing. Settle with an e2e that edits the code while the RPC is held.
- source_spec: none
  summary: Migrate the teacher homework list to the new UI as story 7b.
  evidence: Split from story 7 at its multi-goal check (user chose Split); independently shippable. Tracked in spec-mobile-ux/stories.yaml.
- source_spec: none
  summary: Migrate teacher homework create and review (with LinkRows, ContentLanguageSelect and RichTextEditor) to the new UI as story 7c.
  evidence: Split from story 7 at its multi-goal check (user chose Split); RichTextEditor moved here from story 8 by user decision. Tracked in spec-mobile-ux/stories.yaml.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7-teacher-class-pages.md`
  summary: `e2e/teacher-mobile.e2e.ts` builds its sessions on real dates (Berlin today ±7 days) and deletes its class days in cleanup, unlike teacher.e2e's random past year.
  evidence: Unverified (medium if it bites): could collide with other tests' class days or break on a run across Berlin midnight; the suite runs with one worker, so not seen yet.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7-teacher-class-pages.md`
  summary: `tours.e2e.ts:374` once saw a tour popover on the teacher class page although the teacher's tours were marked seen.
  evidence: Unverified flake: reproduced twice in story 7's step-3 checks, never again after the `/calendar` hydration fix (2 fresh-reset runs, 8/8). Keep the trace if it recurs; may relate to the real-date fixture.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7-teacher-class-pages.md`
  summary: `src/lib/server/rls.spec.ts` 7-4/7-5 "Read: …" tests can time out at vitest's 5000ms default on a loaded machine.
  evidence: Seen once in story 7's full verification (2 timeouts), then 1558/1558 after a fresh reset; story 7 changed no server code. Also: rls.spec is not re-runnable without a reset (streak tests fail on leftover data).

- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7b-teacher-homework-list.md`
  summary: The teacher homework list ignores `data.loadError`, so a failed load shows the normal empty text ("No open homework.") instead of an error.
  evidence: `src/routes/teacher/classes/[id]/homework/+page.server.ts:106` returns `loadError`; neither the pre-7b page nor the rebuilt one renders it (pre-existing). A teacher may think there is no homework and create duplicates.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7c-teacher-homework-create-and-review.md`
  summary: LinkRows labels every row's label field "Label (optional)" without the row number, so screen readers hear identical fields.
  evidence: The URL field and Remove button carry `{i + 1}`, the label field does not; the iX version had the same gap (pre-existing).
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7c-teacher-homework-create-and-review.md`
  summary: The `createPending` doc comment in `src/lib/pending.svelte.ts` still describes iX `loading` and `confirmWith`.
  evidence: Migrated pages use `aria-busy`, a LoaderCircle spinner and `confirm.with`/`confirm.ask`; the doc predates story 5.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7c-teacher-homework-create-and-review.md`
  summary: Choosing "Specific students" in a class with no students shows an empty checklist with no explanation.
  evidence: `homework/new/+page.svelte` renders `data.students` with no empty branch; the iX page did the same (pre-existing).
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/7c-teacher-homework-create-and-review.md`
  summary: A homework copy with no students that is not whole-class opens an empty Student status list with no text.
  evidence: The empty text shows only `&& assignment.wholeClass`, carried over unchanged from the iX page.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/8-syllabus-enrollment-and-schedule-components.md`
  summary: `PageTour.svelte`'s comment still says the pages' dialogs are `<ix-modal>`; the teacher class page now uses ConfirmDialog.
  evidence: Pre-existing wording; story 8 moved EnrollmentPanel's confirms to ConfirmDialog (see also the 7c `pending.svelte.ts` entry).
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/9-admin-pages.md`
  summary: Migrate `/admin/teachers` to the new UI (story 9b): native fields and class checkbox list, promote/reset/remove confirms, one-time password outcome box.
  evidence: Split at story 9's token gate (~2,400 tokens); teachers shares no code with the other admin pages and has its own e2e (`forms.e2e.ts` teachers, `parent-access.e2e.ts:166-235`).
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/9-admin-pages.md`
  summary: Admin class and team rows give every Edit and Delete button the same accessible name, so screen-reader users can't tell rows apart.
  evidence: Pre-existing in the iX pages; a row-named sr-only label (e.g. "Delete {name}") needs new message keys.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/9-admin-pages.md`
  summary: The inline edit rows on /admin/classes and /admin/teams don't move focus in on open or back to Edit on Cancel/Save.
  evidence: Pre-existing in the iX pages; focus drops to body when the edit row unmounts.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/9-admin-pages.md`
  summary: No test covers the empty-roster state on /admin/classes/[id]/students.
  evidence: No spec or e2e searches for `roster_empty`; the admin-students visits all use classes with students.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/9b-admin-teachers-page.md`
  summary: The inline Edit classes row on /admin/teachers doesn't move focus in on open or back to the button on Cancel/Save.
  evidence: Pre-existing in the iX page; same gap already deferred for /admin/classes and /admin/teams (story 9).
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/9b-admin-teachers-page.md`
  summary: The rename rows on /admin/classes and /admin/teams flash their name fields to empty after a successful save, before the row closes.
  evidence: SvelteKit's enhance resets the form before invalidateAll (`forms.js:100-105`) and the client-rendered edit row has empty defaultValues; story 9b fixed the same on /admin/teachers with `{ reset: false }`.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/10-remove-ix-and-final-regression.md`
  summary: Extract the five copies of the admin card/table constants and `cardLabel` (admin classes, teams, parents, teachers and the class pages migrated in story 9) into one shared `$lib/ui` module.
  evidence: Story 9b's design note left this to story 10's cleanup; on 2026-10-22 the user chose to defer it so story 10 stays an iX-only removal.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/10-remove-ix-and-final-regression.md`
  summary: Unwind the `data-ui="new"` coexistence isolation (scoped `reset.css`, `important` utilities, per-file `@source` list) now that iX is gone, using Tailwind's normal preflight and automatic source detection.
  evidence: The isolation only existed to keep iX and the new UI apart; removing it touches all 82 `data-ui="new"` roots, so story 10 keeps it to stay an iX-only removal.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/10-remove-ix-and-final-regression.md`
  summary: Tibetan characters outside a `lang="bo"` element (en/de interface, e.g. Tibetan class and team names under the English name, Tibetan text in toasts) render in the system font instead of Atisha; consider putting 'Atisha' first in `--sherab-font-sans` (its unicode-range limits it to Tibetan).
  evidence: #78 gave Tibetan characters Atisha in any interface language via a `Siemens Sans` alias; the new UI's sans stack never named that family (`src/lib/ui/tailwind.css:117`), so migrated pages lost it in stories 1-9, and story 10 removed the alias with iX's toast.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/10-remove-ix-and-final-regression.md`
  summary: Drop the iX-era content padding: `<main>` keeps iX's 2rem side padding and `ui.page` gives 1rem back with `-mx-4`.
  evidence: Both exist only to keep migrated pages identical to iX's content area (`src/routes/+layout.svelte`, `src/lib/ui/classes.ts`); story 10 forbids layout changes.
- source_spec: `_bmad-output/specs/spec-mobile-ux/stories/11-navigation-loading-bar-and-busy-screen.md`
  summary: No e2e covers the loading bar and busy `<main>` in the signed-out public shell, or at desktop width with the side nav staying usable while `<main>` is inert.
  evidence: Every test in `e2e/nav-progress.e2e.ts` signs in as a teacher at 375px; deleting the public `<main>`'s `aria-busy`/`inert`/fade bindings, or moving `NavProgress` into the signed-in branch, fails no test.
- source_spec: `_bmad-output/implementation-artifacts/spec-atisha-tibetan-font-fallback.md`
  summary: Tibetan text without `lang="bo"` in the en/de interface (a class or team name, a button or badge label) is now drawn in Atisha at 1.36x inside a 1.5 line height, and may clip in `truncate`/`overflow-hidden` rows.
  evidence: Unverified (maybe-false, medium if true): it was #78's behaviour before the redesign, but no test checks clipping outside a Tibetan root. To settle it, screenshot a class list, team list and badge with a Tibetan name at 375px in en and check `scrollHeight <= clientHeight` on truncated rows.
- source_spec: `_bmad-output/implementation-artifacts/spec-atisha-tibetan-font-fallback.md`
  summary: Tibetan class and team names rendered in the en/de interface carry no `lang="bo"`, so screen readers read them with English or German pronunciation.
  evidence: Pre-existing markup (names are rendered as plain text next to the English name); the font fix makes the text look right but does not mark its language.
- source_spec: `_bmad-output/implementation-artifacts/spec-108-teacher-tabs-classes-more.md`
  summary: Page-header count badges (`<Badge>{num(n)}</Badge>` on /teacher/classes, /student/classes and similar) have no accessible name, so screen readers announce a bare number.
  evidence: The pattern predates #108 (`src/routes/student/classes/+page.svelte:35`); fix it once for every page header, e.g. visually hidden "n classes" text.
- source_spec: `_bmad-output/implementation-artifacts/spec-109-pending-button-focus.md`
  summary: After Enter-to-save in a text field, #109 returns focus to the field, which on Android may reopen the soft keyboard after every save.
  evidence: Unverified (maybe-false, medium if true): desktop Chromium e2e cannot show virtual-keyboard behaviour. Settle on an Android phone: My account, edit the name, press Enter/Go, and check whether the keyboard reopens after "Name updated."; if it does, restore to the submitter instead of a text field on coarse-pointer devices.

- source_spec: `_bmad-output/implementation-artifacts/spec-110-homework-pdf-attachments.md`
  summary: Add load tests for a failed homework-files read (parent `filesError`, student and teacher `loadError`).
  evidence: Review 2026-10-22 (V4): the parent spec's assignment ids are not uuids so the files read never runs, and the student and teacher detail routes have no load spec; only the success path is covered (e2e).

- source_spec: `_bmad-output/implementation-artifacts/spec-110-homework-pdf-attachments.md`
  summary: Fix the hydration crash when the teacher's homework list (or a syllabus list) is loaded directly with toast params (#111).
  evidence: Found by the #110 e2e step: a direct load of `/teacher/classes/<id>/homework?created=0` throws "Cannot call replaceState(...) before router is initialized"; the `$effect` predates #110 and `SyllabusList.svelte` shares it.

- source_spec: `_bmad-output/implementation-artifacts/spec-110-homework-pdf-attachments.md`
  summary: A PIN reset no longer ends the student's open session at once (#112); the "Reset PIN" browser test fails on main.
  evidence: `e2e/teacher.e2e.ts:1291` fails on a477766 after a reset (student stays on /student); likely from local JWT verification with getClaims (#104 story 1).

- source_spec: `_bmad-output/implementation-artifacts/spec-113-join-class-in-classes-tab.md`
  summary: The student Classes page counts to-do homework against a UTC "today" while the Dashboard uses Berlin's date.
  evidence: Review 2026-10-23 (B11): `src/routes/student/classes/+page.server.ts` uses `new Date().toISOString().slice(0, 10)`; `/student` uses `todayInBerlin()`, so counts can differ around midnight. Pre-existing.

- source_spec: none
  summary: Add a translated root error page with a way back to the role's home (#115).
  evidence: Split from the UI/UX fix batch #114-#119 (user, 2026-10-24: one spec per goal, in order); independently shippable, no `+error.svelte` exists in `src/`.

- source_spec: none
  summary: Requests shows "Nothing waiting" only when nothing at all is pending, with pending sections before history (#116).
  evidence: Split from the UI/UX fix batch #114-#119 (user, 2026-10-24); independent of the others, touches only `src/routes/requests/+page.svelte`.

- source_spec: none
  summary: Auth and admin forms show errors next to the field with `aria-invalid`, and the sign-in forms show a pending state (#117, #118).
  evidence: Split from the UI/UX fix batch #114-#119 (user, 2026-10-24); #117 and #118 share the auth form pages, so they go in one spec.

- source_spec: none
  summary: Destructive button text and hover reach 4.5:1 contrast (#119).
  evidence: Split from the UI/UX fix batch #114-#119 (user, 2026-10-24); independent token or variant change, related to #124 (Reject buttons as outline).

- source_spec: `_bmad-output/implementation-artifacts/spec-114-tibetan-line-height.md`
  summary: `src/lib/server/rls.spec.ts` fails intermittently on a freshly reset database (a duplicate random class day, or a 5-second timeout).
  evidence: Gate runs 2026-10-24: run 1 failed `#105 class day move and delete … CD002` ("duplicate key … class_days_day_unique" for 4094-10-10; days are drawn from `3000 + Math.random() * 6000` years); run 2 failed `7-5 sick leave decisions … Read` with "Test timed out in 5000ms"; run 3 passed 1667/1667. The #114 change is CSS only.

- source_spec: `_bmad-output/implementation-artifacts/spec-115-error-page.md`
  summary: Add a static `src/error.html` (all three languages) for errors the root layout's own load throws, and for file routes, which `+error.svelte` does not render.
  evidence: Review 2026-10-24 (BH7): without it SvelteKit's bare English fallback still shows, e.g. on a Supabase outage in `src/routes/+layout.server.ts`, and `/files/...` 404s show "File not found." (`e2e/syllabus-files.e2e.ts:434`).

- source_spec: `_bmad-output/implementation-artifacts/spec-115-error-page.md`
  summary: Give unexpected errors an id via a `handleError` hook and show it on the error page, so a report can be matched to the log.
  evidence: Review 2026-10-24 (BH8): no `handleError` in `src/hooks*.ts`; a 500 shows only "Error 500". Idea, not a defect.
- source_spec: `_bmad-output/implementation-artifacts/spec-116-requests-pending-first.md`
  summary: Requests shows no inline error when the admin's deletion or parent pending query fails; only the generic load-error toast reports it.
  evidence: `+page.server.ts` maps the failed list to `[]` and sets only `loadError`; the join card has its own inline `requests_join_load_failed`, the others have none (pre-existing before #116).
- source_spec: `_bmad-output/implementation-artifacts/spec-116-requests-pending-first.md`
  summary: The Requests header subtitles (`requests_teacher_subtitle`, `requests_admin_subtitle`) still describe only registrations.
  evidence: The page also lists Sick leave, class join, deletion and parent requests; the spec kept the subtitles out of scope.
- source_spec: `_bmad-output/implementation-artifacts/spec-116-requests-pending-first.md`
  summary: The help screenshots of `/requests` (`e2e/help-screenshots.e2e.ts`, `static/help/<locale>/teacher-3.png`) show the layout before #116.
  evidence: The page now leads with waiting cards and folds the decided lists into History.
