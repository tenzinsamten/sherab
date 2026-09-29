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
  summary: The attendance session picker doesn't preselect the students' current marks or show which sessions are already marked, so correcting an earlier session re-marks every unticked student absent.
  evidence: 6-2 review. The form was always blank (pre-6-2 date input too); now that sessions are explicit, loading the latest mark per student for the chosen session is cheap.
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
- source_spec: `_bmad-output/implementation-artifacts/spec-7-3-parent-child-detail-page.md`
  summary: `child_attendance` (0025) returns every append-only attendance mark, so a re-marked session appears twice for the parent; it should return the current mark per session.
  evidence: attendance_records has no uniqueness and marks are append-only (AD-5); the page only de-duplicates render keys (detail-page review triage #2). Needs a migration.
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
