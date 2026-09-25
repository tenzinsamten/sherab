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
- source_spec: `_bmad-output/specs/spec-class-tracker/stories/6-1-class-days-sessions.md`
  summary: RLS suites (incl. Story 6-1) are skipped when no local Supabase is running, and there is no CI, so database regressions can pass `npm test`.
  evidence: every block in src/lib/server/rls.spec.ts is describe.skipIf(!reachable); the repo has no .github/ workflow. Repo-wide, pre-existing pattern.
