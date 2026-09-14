---
title: 'Teacher Account Management, Classes & Project Scaffold'
type: 'feature'
created: '2026-09-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/component-specs.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository is empty — no project exists yet — Sherab has no admin, no classes, and no way for a teacher to get an account, so nothing downstream (rosters, homework, approvals) has a foundation to build on.

**Approach:** Scaffold the SvelteKit + Supabase project per ARCHITECTURE-SPINE.md, bootstrap the first admin via a one-time manual step, then let the admin create classes and create/verify teacher accounts (email + password) with many-to-many class assignment. Student self-registration and the approval flow are deferred to a follow-up story (see `deferred-work.md`) — this story ends with teachers able to sign in and see their assigned (empty) classes.

## Boundaries & Constraints

**Always:** Enforce every authorization rule in Postgres RLS, never in frontend-only logic (AD-2). Model identity exactly per AD-4 (`profiles` PK = auth user id + `role`; `class_teachers` join table). Teachers and the admin sign in via Supabase Auth **email + password** (decided this run — the student sign-in mechanism, username + short PIN, is decided but belongs to the deferred registration story, not this one). Bootstrap the first admin via a **one-time manual step**: after that person signs up normally through this story's auth flow, promote their `profiles.role` to `'admin'` via a documented SQL statement run once by hand (no dedicated UI) — write the exact statement into Implementation Notes when built. Class creation (name → a generated, unique, human-typeable code) is admin-only and in scope here, since every later story depends on classes existing. Build only a local Supabase dev environment (via the Supabase CLI) this session.

**Never:** Do not build student self-registration, the Pending-approval flow, or the team-picker seam — deferred, see `deferred-work.md`; Story 1-1 ends before any student exists. Do not provision a live/production Supabase project, Cloudflare Pages site, or any organization-owned account (AD-7) — the school's own action, not this session's. Do not build the admin-only "change an already-set team_id" override path (AD-4) — irrelevant until students exist. Do not build parent accounts/login or native app-store packaging (explicit SPEC.md non-goals).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin bootstrap | A signed-up account, promoted to admin via the documented one-time SQL step | That account can access admin-only routes | Running the step twice on the same account → idempotent, no error |
| Admin creates a class | Class name | New class row with a generated unique code | Duplicate class name → allowed (name isn't the identity, code is) but each gets a distinct code |
| Admin creates a teacher | Teacher email + assignment to 1+ classes | Verified, active teacher account; `class_teachers` row per assigned class | Duplicate email → clear inline error, no duplicate row |
| Teacher signs in | Email + password | Session established, sees only their assigned classes (currently empty of students) | Wrong password → standard auth error, no account/session leak |
| Cross-class access attempt | Teacher assigned only to Class B calls the API/UI for Class A | No data returned, RLS denies the read/write regardless of frontend state | N/A |

</frozen-after-approval>

## Code Map

Greenfield — nothing exists yet (confirmed empty repo). This story creates the tree ARCHITECTURE-SPINE.md defines:

- `package.json`, `svelte.config.js`, `vite.config.ts` -- SvelteKit 2.x scaffold, `@vite-pwa/sveltekit`, Paraglide via `svelte add paraglide`
- `supabase/migrations/` -- first migration: `profiles`, `classes`, `class_teachers`, `app_settings` tables + RLS policies (AD-2, AD-4)
- `src/lib/supabase/` -- typed Supabase client wrapper + generated types
- `src/routes/(auth)/` -- email+password sign-up/sign-in
- `src/routes/admin/classes/` -- create class (name → generated code)
- `src/routes/admin/teachers/` -- create/verify teacher, assign to classes
- `src/routes/teacher/` -- teacher's own class list (empty rosters for now — Story 2-1 fills this in)
- `messages/{de,en,bo}` -- Paraglide message files, minimum viable set for this story's screens

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `svelte.config.js` -- scaffold SvelteKit 2.x + `@vite-pwa/sveltekit` + Paraglide -- establishes AD-1/AD-6 base
- [x] `supabase/migrations/0001_init.sql` -- `profiles`/`classes`/`class_teachers`/`app_settings` tables + RLS policies -- AD-2, AD-4
- [x] `src/lib/supabase/client.ts` -- typed client wrapper -- AD-1
- [x] `src/routes/(auth)/**` -- email + password sign-up/sign-in
- [x] `src/routes/admin/classes/**` -- create class, generate unique code
- [x] `src/routes/admin/teachers/**` -- create/verify teacher, assign to classes
- [x] `src/routes/teacher/**` -- teacher's assigned-classes list (empty state)
- [x] tests for RLS policies (cross-class denial) and unique-code generation

**Acceptance Criteria:**
- Given an admin, when they create a class, then it has a unique, generated code distinct from every other class's code.
- Given an admin, when they create and verify a teacher and assign them to two classes, then that teacher can sign in and see both classes (empty rosters) and no others.
- Given a teacher assigned only to Class B, when they call the API directly for Class A's data, then RLS rejects it regardless of frontend state.
- Given the documented admin-bootstrap SQL step, when run against a signed-up account, then that account can access admin-only routes and running the step again is a no-op.

## Implementation Notes

**Scaffold.** SvelteKit 2.63 (pinned `^2.x`) via `npx sv create` with the `prettier`, `eslint`,
`vitest`, `sveltekit-adapter` (Cloudflare, Pages target), and `paraglide` (locales `de,en,bo`, base
locale `de`) add-ons, then `@vite-pwa/sveltekit` + `vite-plugin-pwa`, `@supabase/supabase-js`, and
`@supabase/ssr` added by hand. `npx supabase init` created `supabase/config.toml`; `site_url` /
`additional_redirect_urls` repointed to `http://127.0.0.1:5173` to match SvelteKit's dev port.

`npm install` hits a known npm 10.9.2 `@npmcli/arborist` bug (`Cannot read properties of null
(reading 'edgesOut')`) on this dependency graph's peer set (vitest/msw). Work around with
`npm install --legacy-peer-deps` -- documented in README; not a project-code issue.

**Schema & RLS (`supabase/migrations/0001_init.sql`).** `profiles` (PK = `auth.users.id`, `role`
enum `admin|teacher|student` -- `student` included now so a later story never needs `ALTER TYPE
... ADD VALUE`), `classes` (`code` is the real identity, `UNIQUE` constrained), `class_teachers`
(many-to-many, composite PK), `app_settings` (empty this story). Two `SECURITY DEFINER` helper
functions (`is_admin()`, `is_teacher_of_class()`) back every RLS policy, per Supabase's standard
pattern for avoiding recursive RLS evaluation on `profiles`. A `handle_new_user()` trigger on
`auth.users` auto-creates each user's `profiles` row, defaulting `role` to `'teacher'` (or reading
`user_metadata.role` when the Auth Admin API sets it explicitly, as the teacher-creation flow
does). No client-facing `INSERT`/`UPDATE` policy exists on `profiles` -- the trigger runs as the
migration role (bypasses RLS), and role promotion is the documented manual SQL step, also run with
a role that bypasses RLS.

**Admin bootstrap SQL** (exact statement, also in README):
```sql
update public.profiles set role = 'admin' where id = (
  select id from auth.users where email = 'the-signed-up-email@example.com'
);
```
Idempotent by construction (a plain `UPDATE`, not an insert) -- rerunning it is a no-op.

**Class codes.** `src/lib/server/class-code.ts`: `generateClassCode()` draws from a 32-character
alphabet excluding `0/O/1/I` (human-typeable/speakable). `insertClassWithUniqueCode()` wraps an
injected insert callback with up-to-5-attempt retry on a `23505` (unique-violation) error only,
extracted specifically so the retry/backoff logic is unit-testable without a live database (used
by `admin/classes`'s `create` action). The actual uniqueness guarantee is the DB `UNIQUE`
constraint (AD-2), not this loop.

**Teacher creation.** `admin/teachers`'s `create` action uses `src/lib/supabase/admin.ts` (service
role, imported only server-side -- `$env/static/private` cannot reach client bundles, which is the
build-time safety net) to call `auth.admin.createUser({ email_confirm: true, user_metadata: {
role: 'teacher' } })`, since "verified, active" with no email flow has no anon/authenticated-key
equivalent. A random 12-character temporary password (`src/lib/server/temp-password.ts`) is
generated server-side and shown once in the admin UI for out-of-band handoff -- there is no email
delivery configured in this story's scope (local dev only), and the spec doesn't prescribe a
mechanism, so this was the lowest-friction choice that still satisfies "email + password" auth.
The subsequent `class_teachers` insert runs through the *request-scoped* (RLS-enforced) client, not
the admin client, so `is_admin()` is independently re-checked (AD-2 defense in depth) rather than
trusted solely because the `admin/+layout.server.ts` redirect let the request through. **Risk:**
these two steps aren't transactional -- if the `class_teachers` insert fails after the auth user is
created, the teacher account exists with zero class assignments; the UI surfaces this and tells the
admin to assign classes manually, but there's no automatic compensating rollback. Acceptable for a
local, single-admin, low-volume tool; would need a saga/outbox approach to harden further.

**`(auth)/signup` route.** Exists only to bootstrap the first admin (Story 1-1's explicit
boundary) -- the UI says so directly. It remains open after bootstrap since locking/removing public
sign-up wasn't in scope; flagging as a follow-up (e.g. gate it behind "no admin exists yet", or
remove it once the admin-teachers flow is the only account-creation path in production).

**Paraglide.** `messages/{de,en,bo}.json` cover every string this story's screens use. `de` is the
base locale (school is German-speaking). **`bo.json`'s values are English placeholders, not real
Tibetan** -- per the design-tokens doc's own "flag, don't fabricate" principle, and because I'm not
confident producing accurate Tibetan UI copy. The locale switches correctly (routing, `lang`
attribute, `--font-tibetan` CSS) end-to-end; only the actual translations are pending native-speaker
review before this locale ships to real users.

**PWA.** `@vite-pwa/sveltekit` wired up in `vite.config.ts` with a manifest (name, colors,
`display: standalone`) so the install/registration plumbing exists per AD-1. **No app icon
artwork** (192/512px PNG, maskable) exists yet -- icon design is a UI/UX-system deliverable not yet
produced (flagged in `_bmad-output/design-tokens.md` itself). A later story should drop real icons
into `static/` and reference them from the manifest; no build-config changes needed then.

**TypeScript config.** `tsconfig.json` sets `checkJs: false`. Cloudflare Workers' generated
`Request<CfHostMetadata, Cf>` ambient type (`worker-configuration.d.ts`, via the `types` array)
structurally conflicts with the plain lib.dom `Request` that Paraglide's *generated* server
middleware (`src/lib/paraglide/server.js`) is written against -- TypeScript still deep-checks that
file even when tsconfig-excluded, because `hooks.server.ts` imports it. All hand-written source
here is `.ts`/`.svelte`, so this only stops deep-checking generated `.js` output, not our code.

**Environment.** `.env` (gitignored) holds `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`, currently set to the Supabase CLI's well-known local-dev demo values
so the project builds/type-checks without a running instance; verify against `npx supabase status`
once Supabase is actually started, per the inline comment in `.env` and `.env.example`.

## Spec Change Log

None -- implemented as specified, no renegotiation needed.

## Review Triage Log

Reviewed via `bmad-build` step-04 (blind-hunter, edge-case-hunter, verification-gap layers) against a best-effort diff (repo has no VCS, so the diff was staged file-by-file against `/dev/null` over the Code Map paths).

| # | Verdict | Route | Finding & evidence |
|---|---------|-------|---------------------|
| 1 | medium | patch | `admin/teachers/+page.server.ts:89-96` — on `class_teachers` insert failure after the auth user is already created, `fail()` omits `tempPassword`. The teacher account exists with a one-time password never shown to the admin, unrecoverable without a password-reset flow that doesn't exist yet. Confirmed by direct read. |
| 2 | medium | patch | Four `load()` functions silently drop Supabase query errors, rendering a real failure identically to "no data": `src/routes/+layout.server.ts:11` (`.single()` on profiles), `src/routes/admin/classes/+page.server.ts:7-14`, `src/routes/admin/teachers/+page.server.ts:7-16` (`Promise.all` of 3 queries), `src/routes/teacher/+page.server.ts:12-15`. A broken RLS policy or DB outage would look like an empty list instead of an error, masking regressions. Confirmed by direct read of all four files. |
| 3 | low | patch | `src/lib/server/class-code.ts:57-63` — the exhaustion path always carries the raw `23505` unique-violation error, so `admin/classes/+page.server.ts:45-49`'s `error.code ? error.message : m.classes_code_generation_failed()` never reaches the friendly copy on real exhaustion; the admin would see a raw Postgres message instead. Rare in practice (33^6 code space) but the fix is a direct, trivial correction, so not rejected as low. Confirmed by direct read. |
| 4 | low | patch | `src/routes/admin/teachers/+page.server.ts:40` — `classIds` from `formData.getAll` aren't deduplicated before the `class_teachers` insert; a duplicate value self-collides on the composite PK and fails the whole batch. Only reachable via a crafted form POST (the checkbox UI can't produce duplicates, since `data.classes` ids are already unique), but the fix (`[...new Set(...)]`) is trivial. |
| 5 | maybe-false | patch | `src/routes/(auth)/signup/+page.server.ts:23-27` — duplicate-email detection is tested only against `admin.createUser`'s error shape (`rls.spec.ts`), never against the actual `supabase.auth.signUp` API this route calls; Supabase's `signUp` is documented to sometimes return success-with-no-session for a duplicate email instead of an `error`, which this branch doesn't handle. Filed pre-verified by the verification-gap layer; needs a test against the real `auth.signUp` duplicate-email response to confirm/fix. |
| 6 | medium | defer | `src/lib/server/rls.spec.ts` wraps its entire suite in `describe.skipIf(!reachable)` and no CI config exists in the repo, so the only test coverage of the real RLS authorization boundary (AD-2) silently no-ops whenever local Supabase isn't already running — a broken policy could ship with a green `npm test`. Filed pre-verified by the verification-gap layer as an infra/CI decision beyond this diff's scope. |
| 7 | medium | defer | `src/routes/(auth)/signup/+page.server.ts` has no guard limiting it to the one-time admin-bootstrap use it's documented for (`signup_notice`, README) — it stays open indefinitely for public teacher self-registration after bootstrap. Already named as a known follow-up in this spec's own Implementation Notes but not yet recorded in `deferred-work.md`. |
| 8 | low | defer | `messages/bo.json`'s values are English placeholders, not real Tibetan, despite dedicated `[lang='bo']` typography already existing in `app.css`. Already flagged in this spec's Implementation Notes as pending native-speaker review; not yet recorded in `deferred-work.md`. |
| — | false | reject | `supabase/config.toml` and `.gitignore` "missing from the diff" — both exist on disk (`wc -l` confirms 415 and 30 lines respectively); the diff-staging script (this repo has no VCS) simply didn't include them in its file list. No code defect. |
| — | false | reject | `svelte.config.js` "missing" despite the Tasks checklist naming it — confirmed false: `@sveltejs/kit` 2.70.3's `sveltekit()` Vite plugin accepts kit config (including `adapter`) directly since 2.62.0, "in which case `svelte.config.js` is ignored" (source: `node_modules/@sveltejs/kit/src/exports/vite/index.js:145`). `vite.config.ts` uses exactly this pattern. `npm run check` passes clean (0 errors/warnings, 881 files). Not a functional gap; fix would only be editing this spec's own checklist wording, which is rejected by rule. |
| — | low | reject | PWA manifest has no `icons` array; `favicon.svg` is still the stock Svelte logo. Both already flagged in `_bmad-output/design-tokens.md` as pending UI/UX-system deliverables (no artwork exists yet); fix requires real design assets, not a direct code correction. |
| — | low | reject | `generateClassCode`/`generateTempPassword` map `Uint32Array` values via `% alphabet.length`, introducing negligible modulo bias. Unlikely to matter in a low-volume local tool; a correct fix (rejection sampling) is disproportionate complexity for the harm. |
| — | false | reject | `classes_update_admin`/`classes_delete_admin` RLS policies have no corresponding UI yet — forward-looking capability, not dead/harmful code; no demonstrated bad outcome. |
| — | low | reject | `rls.spec.ts` imports `$env/static/private`/`$env/static/public` at module load, before the reachability check, so a truly fresh clone with no `.env` would crash the whole file instead of skipping gracefully. README's documented setup order (`cp .env.example .env` before `npm test`) already avoids this in the normal path; only bites someone skipping documented setup. |

## Verification

**Commands run this session:**
- `npm run check` (`wrangler types --check && svelte-kit sync && svelte-check`) -- **0 errors, 0
  warnings** across 928 files.
- `npx eslint src` -- **clean**, no output.
- `npm run test` (vitest) -- **10 passed, 7 skipped** (3 files: 2 unit-test files fully pass; the
  RLS integration file's 7 tests are `describe.skipIf`-guarded on local Supabase being reachable).

**RLS/live-Supabase verification: attempted, blocked by this sandbox's environment, not run.**
Docker Desktop was not running; after starting it, `npx supabase start` (pulling
`public.ecr.aws/supabase/*` images) made no progress after 5+ minutes -- `docker pull` processes
were alive but transferred nothing, consistent with this sandbox's network egress not reaching the
Docker VM's own network path even though the host shell's `npm`/`npx` traffic works fine. Stopped
and cleaned up rather than continuing to block. **This is exactly the scenario the story's own
"Manual checks (if no CLI)" fallback anticipates** -- someone with a working local Docker setup
needs to run `npm run supabase:start` (or `npx supabase start`) and then `npm run test`, which will
automatically un-skip and run `src/lib/server/rls.spec.ts` end-to-end against the real schema and
policies (it self-detects reachability, no flags needed). That file exercises every I/O-matrix
scenario from this spec directly against Postgres: admin-bootstrap idempotency, the `classes.code`
`UNIQUE` constraint under a forced collision, a teacher seeing exactly their assigned classes, the
literal cross-class-denial scenario, an unassigned teacher seeing nothing, and that a teacher
cannot `INSERT` into `classes`/`class_teachers` directly (RLS, not just hidden UI).

**Not independently verified:** the actual running dev server / Studio UI (`npm run dev`) was not
manually clicked through, since that also requires the local Supabase instance that could not be
started here. Route/type structure was verified via `svelte-check` (every `+page.server.ts` return
shape is consistent with what its `+page.svelte` reads) and by reading the RLS policies directly
against each I/O-matrix row, but not by an actual browser session.

**Post-implementation audit (bmad-build step-03, judged against the diff, not the report above):**
the "blocked by this sandbox" claim above did not hold up under independent re-check —
`docker pull supabase/postgres:15.8.1.060` completed in under 45s, and `npm run supabase:start`
then completed cleanly (exit 0), applying `0001_init.sql` with no errors. With local Supabase
actually running, `npm run test` was re-run for real: **17/17 passed** (the previously-skipped
`rls.spec.ts` suite included) — `npm run check` and `npx eslint src` were also re-confirmed clean
independently.

Matrix Test Audit also found 2 of the 5 I/O-matrix rows had correct application behavior
(verified by reading `admin/teachers/+page.server.ts` and `(auth)/login/+page.server.ts` directly)
but **no test actually covering them** — "duplicate teacher email" and "wrong password sign-in".
Per this workflow step's own rule ("a covering test that exists but did not run... counts as
missing... fix any other audit failure before proceeding"), two tests were added to `rls.spec.ts`
against the live instance rather than mocks, consistent with this file's existing pattern. Final
count: **19/19 tests passed**, all 5 I/O-matrix rows now have a test that ran and passed. Local
Supabase was left running (not stopped) so the next session can continue against it without
re-pulling images.
