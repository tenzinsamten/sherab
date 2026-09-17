---
title: 'Team leaderboard'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '14f4f3c97fa8705c3ba072ed011ea733953030e6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Streaks (4-1) and badges (4-2) give individual students a sense of progress, but nothing gives the school's fixed-for-the-year teams a shared, visible sense of collective progress — the SPEC's team concept exists in the data model (`teams`, `profiles.team_id`) but has no ranking or display.

**Approach:** Add a read-time `team_leaderboard()` aggregate (SUM of `student_streaks.current_streak` per team, scoped to approved students) and render it as a simple ranked list. Team assignment plumbing (Story 1-2) is not touched — this story is the ranking read and its display only.

## Boundaries & Constraints

**Always:** Aggregate at read time via a `SECURITY DEFINER` SQL function (`language sql security definer stable`, mirroring `is_targeted_for_homework_instance`, `supabase/migrations/0004_homework.sql:135-148`) — never a stored/materialized sum, per epic-4-context's explicit decision to avoid keeping a sync'd total. Scope the sum to `profiles.role = 'student' AND profiles.status = 'approved' AND profiles.team_id IS NOT NULL` (same approved-student gate as `teacher/classes/[id]/+page.server.ts:64-65`), left-joined from `teams` so every team appears even with a zero total (`COALESCE(SUM(...), 0)`), ordered `total_streak DESC, team_name ASC` for a deterministic tie-break. Access is controlled by `GRANT EXECUTE ... TO authenticated` only (SECURITY DEFINER bypasses table RLS by design, same precedent as `validate_class_code`) — no team-scoped restriction, since the leaderboard is meant to be visible to every authenticated role within the school. Reuse `.card`/`.section-label`/`.stat-tile-value` for display (no new visual system). Paraglide keys in all three locales (`en`/`de`/`bo`), following the `<scope>_leaderboard_<element>` naming already used for `student_streak_*`/`teams_*` keys. The leaderboard lives at a standalone `/leaderboard` route, reachable via a nav entry from the student, teacher, and admin dashboards (**decision**, resolved 2026-09-17: standalone route over embedding a card on each dashboard, for consistent placement across every role).

**Never:** Do not touch `teams`, `profiles.team_id`, or the set-once trigger (Story 1-2, done). Do not expose any individual student's streak value through this feature — only team-level sums. Do not add admin controls for anything (no configurable value exists in this story). Do not rank or display anything beyond the school's own teams (no cross-school/public exposure).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal ranking | Two teams with approved students holding streaks of 5 and 3 | List shows the 5-streak team ranked above the 3-streak team | N/A |
| Team with no approved students / no streak rows | Team exists, zero qualifying students | Team appears with total 0, ranked last (or tied) | N/A |
| Tied totals | Two teams both sum to 4 | Order is deterministic (team name ascending) across repeated loads | N/A |
| Student with a streak but `team_id IS NULL` | Approved student, no team assigned | Excluded from every team's sum (not counted anywhere) | N/A |
| No teams exist at all | Empty `teams` table | Empty-state message, not an error | N/A |
| RPC call fails | Network/DB error on `.rpc('team_leaderboard')` | Page shows the existing `loadError` messaging, matching `student/+page.svelte`'s pattern | Falls into existing `loadError` OR-chain |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0009_leaderboard.sql` (new) -- `team_leaderboard()`: `language sql security definer stable`, `returns table(team_id uuid, team_name text, total_streak bigint)`; `SELECT t.id, t.name, COALESCE(SUM(ss.current_streak), 0) FROM teams t LEFT JOIN profiles p ON p.team_id = t.id AND p.role = 'student' AND p.status = 'approved' LEFT JOIN student_streaks ss ON ss.student_id = p.id GROUP BY t.id, t.name ORDER BY total_streak DESC, t.name ASC`; `grant execute on function team_leaderboard() to authenticated` (mirrors `validate_class_code`, `0002_student_registration.sql:183-197` and `0004_homework.sql:135-148`'s grant shape).
- `src/lib/server/leaderboard.ts` (new) -- `TeamRankRow` (snake_case raw row: `team_id`, `team_name`, `total_streak`), `TeamRank` (camelCase view-model: `teamId`, `teamName`, `totalStreak`), `shapeTeamLeaderboard(rows: TeamRankRow[] | null): TeamRank[]` -- pure function mirroring `src/lib/server/streak.ts`'s `shapeStudentStreak` shape (explicit null/empty handling, not conflated with a load error).
- `src/lib/server/leaderboard.spec.ts` (new) -- unit tests mirroring `streak.spec.ts`'s three-case shape (empty list, populated list, mapping assertion incl. zero-total team).
- `src/routes/leaderboard/+page.server.ts` (new) -- `locals.supabase.rpc('team_leaderboard')`, shape via `shapeTeamLeaderboard`, return `{teams, loadError}` following the existing `loadError` OR-chain pattern (`src/routes/student/+page.server.ts:165-183`); reachable by any authenticated role (student/teacher/admin), no role gate beyond being signed in.
- `src/routes/leaderboard/+page.svelte` (new) -- ranked list inside `.card`, reusing `.section-label`/`.stat-tile-value`; each row shows rank ordinal, team name, combined streak, with an `aria-label` announcing all three per row (WCAG 2.2 AA, mirroring `student/+page.svelte`'s streak `aria-label`); three-way loadError/empty/populated branch matching `student/+page.svelte:33-51`.
- `src/routes/student/+page.svelte`, `src/routes/teacher/+page.svelte`, and the admin section's nav (exact admin nav file to be located at implementation time) -- add a nav link/entry to `/leaderboard`.
- `src/lib/server/rls.spec.ts` -- new `describe.skipIf(!reachable)('Story 4-3 leaderboard (requires local Supabase)', ...)` block after the Story 4-2 block (line ~3865), mirroring its `admin`/`teacherA`/`createStudent` setup shape; assert the RPC sums correctly across teams and excludes unapproved/unassigned students.
- `messages/{en,de,bo}.json` -- new `*_leaderboard_*` keys (section label, column/row labels, empty state, aria-label), matching the terse existing convention.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0009_leaderboard.sql` -- create `team_leaderboard()` SECURITY DEFINER function + grant -- per Code Map
- [x] `src/lib/server/leaderboard.ts` + `leaderboard.spec.ts` -- row-shaping helper and unit tests
- [x] `src/routes/leaderboard/+page.server.ts` + `+page.svelte` -- load and render the ranked list
- [x] Nav wiring from student/teacher/admin entry points
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- new Story 4-3 block covering every I/O matrix row reachable against a live Supabase instance (all but "No teams exist at all" -- safely simulating a globally-empty `teams` table isn't feasible in the shared test DB, so that row is instead covered at the unit level: `shapeTeamLeaderboard([])` in `leaderboard.spec.ts` and the RPC-succeeds-with-zero-teams case in `leaderboard/page.server.spec.ts`)

**Acceptance Criteria:**
- Given two teams with different combined approved-student streak totals, when the leaderboard loads, then the higher-total team is ranked above the lower one.
- Given a team with no approved students holding a streak, when the leaderboard loads, then that team still appears, with a total of 0.
- Given a student with a streak but no team assignment, when the leaderboard computes totals, then that student's streak is not counted toward any team.
- Given any authenticated user regardless of role, when they view the leaderboard, then they see the same team-level totals (no individual student streak is exposed).

## Implementation Notes

- `team_leaderboard()` grants `EXECUTE` to `authenticated` only, matching every other function in this codebase's grant shape (Boundaries), but this project's local default privileges already grant `EXECUTE` on every new public-schema function to `anon` too (confirmed against pre-existing `is_admin()`/`recompute_student_streak()`, neither of which grants `anon` anything explicitly either) -- so the grant line documents intent/precedent rather than being the actual anon-blocking mechanism. The real barrier for an unauthenticated visitor is the route's own `redirect(303, '/login')` when `safeGetSession()` has no user; the function itself leaks no PII regardless (team-level sums only). Noted directly in the migration's comments so it isn't re-litigated later.
- Nav wiring landed as a single edit to `src/routes/+layout.svelte` (one `nav_leaderboard` link added to each of the admin/teacher/student branches), since this codebase's nav is unified in the root layout rather than duplicated per-route -- that's the actual file the spec's "student/+page.svelte, teacher/+page.svelte, admin nav" Code Map line resolved to.
- `src/lib/supabase/database.types.ts` was hand-patched with just the new `team_leaderboard` RPC entry (8-line diff) rather than a full `supabase gen types` regen, because the installed CLI's regen output dropped hand-maintained trailing type aliases (`SkillArea`, `BadgeType`, `HomeworkStatusValue`, etc.) and downgraded several enum columns to plain `string` -- an unrelated regression from a newer CLI version, out of this story's scope to fix.
- Matrix Test Audit (step-03): the diff as first implemented left the I/O matrix's "RPC call fails" row uncovered -- `+page.server.ts`'s `loadError: Boolean(rpcError)` branch had no test anywhere. Added `src/routes/leaderboard/page.server.spec.ts`, calling `load()` directly with a mocked `locals` (no SvelteKit test harness needed, since `load` is a plain async function) to assert `loadError: true` on RPC failure and `loadError: false` + correctly shaped rows on success. This is the first load-function-level test in the repo; every other route still relies solely on RLS-layer tests + human walkthrough (an accepted codebase-wide gap already logged in prior stories' reviews), so this precedent is scoped narrowly to closing this story's own matrix row, not a mandate to retrofit the rest.
- An initial RLS test asserting an anonymous caller is rejected by the `authenticated`-only grant was written and then removed: Supabase's local default privileges grant `EXECUTE` to `anon` on every new function regardless of explicit grants (see first bullet above), so the assertion was testing a boundary that doesn't exist at the DB layer in this project; the finding is documented in the migration comments instead.
- Verified: `npm run check` (0 errors/warnings), `npx eslint src` (clean), `npm run test` (151/151 passing, including all seven new Story 4-3 test files/blocks against live local Supabase), plus `npx prettier --check` and a production `vite build` (both clean, beyond the spec's own Verification list).

## Spec Change Log

None yet.

## Review Triage Log

Reviewed by blind-hunter, edge-case-hunter, and verification-gap against the diff since `14f4f3c97fa8705c3ba072ed011ea733953030e6`.

| # | Verdict | Route | Finding | Evidence |
|---|---------|-------|---------|----------|
| 1 | low | patch | Blind-hunter: `total_streak` is `bigint` in SQL (`SUM(integer)`'s default result type) but typed `number` in `database.types.ts`/`leaderboard.ts`. | No realistic overflow given `current_streak`'s `integer` bound and this app's scale, but the SQL/TS contract genuinely disagrees -- cast the `SUM` to `::integer` to remove the mismatch cleanly. |
| 2 | low | defer | Blind-hunter: `messages/bo.json`'s new `leaderboard_*` keys are byte-for-byte identical to the English strings, not real Tibetan translations. | Same recurring, already-logged pattern as every prior story's `bo.json` additions (1-1, 1-2, 3-2, 4-1, 4-2) -- native-speaker translation remains a separate, deferred, file-wide task. |
| 3 | low | reject | Blind-hunter: `## Review Triage Log` was left empty despite Implementation Notes describing self-caught findings. | Fix is to edit this build's own spec (populate this section) -- rejected per the "reject any finding whose fix is to edit this build's spec" rule; also self-resolving, since this table is that fix. |
| 4 | low | patch | Blind-hunter: `sprint-status.yaml`'s diff has no `# REFRESHED 2026-09-17: Story 4-3 ...` narrative comment, unlike every prior story (3-1, 3-2, 4-1, 4-2). | Confirmed: the file's header comments show this convention for every prior status change; this diff only flips the status value and bumps `last_updated`. |
| 5 | low | patch | Blind-hunter: the `/leaderboard` nav link (`{@const leaderboardHref}` + 5-line `<a>` block) is duplicated byte-for-byte three times in `+layout.svelte`, once per role branch. | Confirmed identical across all three branches; nothing differs by role, so it can be hoisted once above the `{#if}` chain. |
| 6 | low | patch | Blind-hunter: `page.server.spec.ts` never tests the RPC-success-with-empty-array case (`data: [], error: null`). | Only RPC-failure and populated-success are tested; the "No teams exist at all" row reaching `load()` itself (not just the pure `shapeTeamLeaderboard([])` unit test) is unverified. |
| 7 | low | defer | Blind-hunter: the Supabase CLI's `gen types` regression (drops hand-maintained type aliases, downgrades enums to `string`) is documented only in this story's own Implementation Notes, nowhere a future contributor would see it before re-running the regen. | Confirmed no warning exists in CLAUDE.md, the architecture doc, or elsewhere. Pre-existing CLI-version issue, not caused by this story -- this story is only where it was first encountered and worked around. |
| 8 | low | reject | Blind-hunter: Code Map still lists `student/+page.svelte`/`teacher/+page.svelte` as nav-wiring files, but the diff only touched `+layout.svelte`. | Fix is to edit this build's own spec's Code Map -- rejected per the "reject any finding whose fix is to edit this build's spec" rule. |
| 9 | false | reject | Blind-hunter: no test covers multiple all-zero-streak teams tie-breaking by name. | The existing "tied totals are ordered deterministically" test already exercises `ORDER BY total_streak DESC, team_name ASC` at a nonzero value; SQL's sort has no special case for zero vs. nonzero, so the same code path already proves the zero case behaves identically. |
| 10 | medium | patch | Verification-gap (pre-verified): the unauthenticated branch (`if (!user) throw redirect(303, '/login')`, `+page.server.ts:7-9`) has zero test coverage -- both existing tests hardcode a signed-in user, and this story's own notes confirm the DB grant doesn't block `anon` locally, making this redirect the route's only real access gate. | Filed disposition: patch -- add a third `page.server.spec.ts` case with `safeGetSession` returning `{ user: null }`, asserting the redirect throws. |
| 11 | low | patch | Verification-gap (other finding): `+page.server.ts`'s comment claims the DB grant is "the real barrier... this is UX-only," directly contradicting the migration's comment and this story's own Implementation Notes (grant doesn't block `anon` locally; the redirect is the real barrier). | Confirmed textual contradiction between the two comments; direct correction to align `+page.server.ts`'s comment with the more accurate migration one. |
| 12 | low | patch | Edge-case-hunter (claim): the Tasks checklist's "`rls.spec.ts` -- new Story 4-3 block covering every I/O matrix row" overclaims -- the "No teams exist at all" row is only unit-tested via `shapeTeamLeaderboard([])`, never via a live-Supabase RLS test. | Confirmed: no RLS test simulates a globally-empty `teams` table (infeasible to isolate safely in the shared test DB across concurrent tests); checklist wording should say so rather than claim full RLS-layer coverage. |

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including the new live-Supabase RLS case (requires `npm run supabase:start` first)
