# Deferred Work

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
