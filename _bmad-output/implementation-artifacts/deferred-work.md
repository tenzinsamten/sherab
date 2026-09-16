# Deferred Work

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
