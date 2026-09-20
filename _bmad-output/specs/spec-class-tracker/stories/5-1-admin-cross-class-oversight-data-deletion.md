---
title: 'Admin cross-class dashboard'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '87dc07108ba63041ab08aaa88ea9980aa000abdc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin is the only cross-class role in this app, but has no single view of the whole school — no aggregate sense of how many classes/teachers/students exist, how much homework is outstanding, or how many approvals are waiting. Visiting `/admin` today 404s; the admin's only entry points are the individual `/admin/classes`, `/admin/teachers`, `/admin/teams` management screens.

**Approach:** Add a new `/admin` route showing read-only aggregate stat tiles (classes, teachers, students, pending requests, homework assignments, overall homework completion), each linking into its existing management screen where one exists. No new schema or RLS — every source table is already admin-readable.

**Scope note:** This story was split from the original "Admin cross-class oversight & data deletion" story at the bmad-build multi-goal check. The student data-deletion request/approval/cascade-erasure flow is deferred as a separate future story (see `deferred-work.md`) — this spec covers the dashboard only.

## Boundaries & Constraints

**Always:** Query only tables that already have an admin-readable RLS policy (`profiles_select_admin`, `classes_select_admin_or_assigned_teacher`, `homework_assignments_select_admin_teacher_or_targeted_student`, `homework_status_history_select_admin_teacher_or_own` — all confirmed present, `0001_init.sql`/`0004_homework.sql`) — no new RLS, no new migration. Reuse `.card`/`.stat-tile-value`/`.section-label` for every tile (no new visual system). A zero-value tile still renders (never hidden) with its number shown in `var(--color-muted-foreground)` instead of the normal ink color — no existing "de-emphasized tile" convention exists yet, so this is a **decision** (resolved 2026-09-17): mute the number color only, keep the tile/label otherwise identical, rather than inventing opacity or a separate empty-state layout. Tiles that link into an existing management screen (classes/teachers/pending requests) are wrapped in an `<a>`; tiles with no destination screen (students, homework assignments, completion %) render as plain (non-linked) tiles. Paraglide keys in all three locales (`en`/`de`/`bo`), following the `<domain>_section_label`/`_heading`/`_tile_*` naming already used for `classes_*`/`teams_*` (e.g. `dashboard_section_label: "05 / Dashboard"`).

**Never:** Do not touch the deferred data-deletion flow, `deletion_requests`, or any deletion UI. Do not add a new RLS policy or migration — if a query needs one that doesn't exist, that's an Open Question, not something to add silently. Do not build a per-class breakdown table — this is aggregate-only, per the epic's cross-class-summary framing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal load | Classes, teachers, students, assignments, and some homework history exist | All six tiles show their real counts/percentage | N/A |
| Fresh school with zero of something | e.g. zero pending requests | That tile shows `0`, muted-color number, not hidden | N/A |
| No homework history at all yet | `homework_status_history` empty | Completion tile shows `0%`, not `NaN%` or a crash | N/A |
| Any one query fails | DB/network error on one of the parallel queries | Page shows the existing `loadError` messaging pattern | Falls into existing `loadError` OR-chain |
| Non-admin visits `/admin` | Signed-in teacher or student | `+layout.server.ts`'s existing 403 gate applies unchanged | Already handled, unaffected by this story |

</frozen-after-approval>

## Code Map

- `src/routes/admin/+page.server.ts` (new) -- parallel queries mirroring `admin/teachers/+page.server.ts:7-20`'s shape: `classes` count, `profiles` count where `role='teacher'`, `profiles` count where `role='student' AND status='approved'`, pending-requests count (reuse the exact query already at `src/routes/+layout.server.ts:17-31`, do not reimplement), `homework_assignments` count, and a school-wide completion percentage. For completion, check whether `buildHomeworkProgress()` (`src/lib/server/homework-status.ts:33-64`) is reusable at a global (non-class-scoped) grain; if not directly reusable, compute inline following its same distinct `(instance, student)` done-or-reviewed counting discipline (never raw `homework_status_history` row counts, per the codebase-wide dedup convention already established in Stories 4-1/4-2/4-3) -- total assigned instance-rows as the denominator, distinct done-or-reviewed pairs as the numerator, `0` (not `NaN`) when the denominator is `0`. Return all six values plus `loadError` following the existing OR-chain pattern (`src/routes/student/+page.server.ts:165-183`).
- `src/routes/admin/+page.svelte` (new) -- six `.card` stat tiles (classes, teachers, students, pending requests, homework assignments, completion %), reusing `.stat-tile-value`/`.section-label`; classes/teachers/pending-requests tiles link to `/admin/classes`, `/admin/teachers`, `/requests` respectively; students/assignments/completion tiles are plain (no destination screen exists). loadError branch matches `student/+page.svelte:32-33`'s pattern.
- `src/routes/+layout.svelte` -- add one new nav link to `/admin` as the first entry in the admin branch (currently starts at `classes/+page.server.ts` link, ~line 50 per Story 4-3's hoist fix) -- no `/admin` landing link exists today.
- `messages/{en,de,bo}.json` -- new `dashboard_*` keys (section label, heading, one label per tile, empty/zero phrasing where distinct from the number itself), following the `<domain>_section_label`/`_heading`/`_col_*` convention (`classes_section_label`, `teams_section_label` precedent).
- `src/lib/server/rls.spec.ts` -- new `describe.skipIf(!reachable)('Story 5-1 admin dashboard (requires local Supabase)', ...)` block, verifying the aggregate queries return correct counts for a known fixture and that a non-admin (teacher/student) cannot read admin-scoped aggregates beyond what their own existing RLS already permits (this is a read-only regression check, not new authorization -- no new policy is being tested).

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/admin/+page.server.ts` -- parallel aggregate queries + completion calculation -- per Code Map
- [x] `src/routes/admin/+page.svelte` -- six stat tiles, three linked, three plain
- [x] `src/routes/+layout.svelte` -- add `/admin` nav link
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- new Story 5-1 block covering the Normal load, Fresh school zero, No homework history, and Non-admin visits I/O matrix rows; `page.server.spec.ts` covers the Any-one-query-fails row

**Acceptance Criteria:**
- Given a school with existing classes, teachers, and students, when the admin visits `/admin`, then all six tiles show accurate counts matching direct queries against the same tables.
- Given zero pending requests, when the dashboard loads, then the pending-requests tile shows `0` with muted styling, not a hidden tile.
- Given no homework history exists yet, when the dashboard loads, then the completion tile shows `0%`, never `NaN%`.
- Given a non-admin role, when they visit `/admin`, then the existing layout gate's 403 behavior is unchanged by this story.

## Implementation Notes

- `src/routes/admin/page.server.spec.ts` (new during Matrix Test Audit): the I/O matrix's "Any one query fails" row had no test -- `load()` is a plain async function taking `locals`, so no SvelteKit harness is needed, just a mocked `locals.supabase.from()` chain. Two cases: all-succeed defaults, and one-query-fails sets `loadError: true`.
- **Real bug found and fixed during the Matrix Test Audit, not just a test-coverage gap:** the RLS "completion math" test failed (`expected 2 to be 4`) against a real local Supabase instance. Root cause: PostgREST caps every unfiltered `.select()` at `api.max_rows` (1000, `supabase/config.toml:18`), and this dev database's `homework_status_history` table already holds 1091 rows (accumulated across every prior story's RLS specs) -- so the original unpaged `.select()` in `+page.server.ts` silently truncated and undercounted, the same query shape the test copied. This violates the spec's own Acceptance Criteria ("accurate counts... matching direct queries"), not a hypothetical future-scale concern. Fixed by paginating the fetch (`fetchAllHistoryRows()`, `.range()` in a loop until a page comes back short) rather than adding a migration/RPC, keeping the Boundaries' "no new migration" constraint intact. The RLS test itself was also changed to scope server-side via `.in('instance_id', [...])` instead of an unfiltered select, so it stays correct as the shared test database keeps growing across future story runs.
- Verified (after the pagination fix, run twice for stability): `npm run check` (0 errors/warnings), `npx eslint src` (clean), `npx prettier --check` (clean), `npm run test` (160/160 passing both runs, including all 5 Story 5-1 RLS tests and both `page.server.spec.ts` cases against live local Supabase).

## Spec Change Log

## Review Triage Log

Reviewed by blind-hunter, edge-case-hunter, and verification-gap against the diff since `87dc07108ba63041ab08aaa88ea9980aa000abdc`.

| # | Verdict | Route | Finding | Evidence |
|---|---------|-------|---------|----------|
| 1 | medium | patch | Blind-hunter: `fetchAllHistoryRows()`'s `.range()` pagination has no `.order()` clause, so Postgres/PostgREST gives no cross-page ordering guarantee under concurrent inserts. | Confirmed at `+page.server.ts:24-27`: `.select(...).range(from, from+pageSize-1)` with no `.order()`. Without a stable sort, rows can shift between page boundaries as new history rows are inserted between requests, reintroducing the same undercount/overcount class of bug the pagination fix itself was written to close. |
| 2 | low | reject | Blind-hunter: the pending-requests query duplicates `+layout.server.ts`'s identical filter instead of a shared helper. | The Code Map explicitly asked to "reuse the exact query... do not reimplement," which this diff followed literally (verbatim copy, documented in a comment); extracting a shared helper is a nontrivial cross-file refactor the spec never asked for, and drift risk on a two-line filter is low in everyday use. |
| 3 | medium | patch | Blind-hunter: `page.server.spec.ts`'s `fakeLocals` keys results by table name, so all three `profiles` queries (teachers/approved-students/pending) collapse onto one mock result and can't be independently failed or filter-checked. | Confirmed at `page.server.spec.ts:24-38`; same root cause as Verification-gap's row 17 below, which demonstrates the concrete consequence — one merged fix covers both. |
| 4 | medium | patch | Blind-hunter: the `rls.spec.ts` cross-role scoping test (`readAggregateCounts`) omits the sixth aggregate — the paginated full-table `homework_status_history` read backing the completion tile. | Confirmed at `rls.spec.ts:4872-4895`: only classes/teachers/students/pending/assignments are compared; the one unfiltered, highest-risk read of the six has no scoping assertion, unlike the other five which this same test already proves. |
| 5 | low | defer | Blind-hunter: no test independently guards the new `/admin` nav link's admin-only gating beyond visual nesting in the existing `{#if role === 'admin'}` block. | Confirmed: this repo has no Svelte-component or e2e test harness for any nav link, including the pre-existing teams/classes/teachers links directly above it — pre-existing, codebase-wide convention, not a gap this story introduced. |
| 6 | false | reject | Blind-hunter: the muted zero-value color (`var(--color-muted-foreground)`) isn't verified against the `.card` background for WCAG AA contrast. | `--color-muted-foreground` (`app.css:40`) is already used this same way (text color on card/page backgrounds) in over a dozen existing files codebase-wide, with no dedicated contrast check anywhere; this diff applies an already-pervasive, already-accepted token, not a new unverified risk. |
| 7 | false | reject | Blind-hunter: the new data-deletion `deferred-work.md` entry lacks an owner/epic/backlog reference, unlike the entry above it. | Checked every existing entry in `deferred-work.md`: all use only `source_spec`/`summary`/`evidence`, including the Story 4-3 entry cited as the counterexample — no entry in the file has an owner or epic field, so this entry matches the file's actual established format exactly. |
| 8 | low | patch | Blind-hunter: `text-decoration:none; color:inherit;` is repeated identically on all three linked `<a class="card">` tiles instead of one shared class. | Confirmed at `+page.svelte:31,38,45`; trivial to extract into one CSS class, so future styling changes to linked tiles touch one place. |
| 9 | low | reject | Blind-hunter: no `aria-label`/role/text distinguishes the three linked tiles from the three plain tiles for assistive-tech users. | Native `<a href>` vs. `<div>` semantics already convey "link" vs. "static" correctly to screen readers; the residual gap (no visual affordance for sighted non-AT users) needs a design decision, not a direct correction, and this dashboard's only audience is the single admin role. |
| 10 | medium | defer | Blind-hunter: the completion tile pulls the entire (paginated) `homework_status_history` table on every `/admin` load with no follow-up ticket to move to a DB-side aggregate. | Same root cause as Edge-case-hunter's iteration-cap finding (row 13); the "no new migration" boundary that forced this approach is a story-level constraint, not something to patch within this story — logged as future work instead. |
| 11 | medium | patch | Edge-case-hunter: same missing-`.order()` pagination-ordering gap as Blind-hunter's row 1. | See row 1's evidence; a single fix covers both. |
| 12 | medium | defer | Edge-case-hunter: `Promise.all` in `load()` has no `.catch()`, so a rejecting query (as opposed to a returned `{error}`) would surface as a raw 500 instead of the `loadError` banner. | Confirmed no other loader in this codebase (`student`, `teacher`, `leaderboard`) wraps Supabase calls in try/catch either — this is an existing, codebase-wide characteristic of how thrown (not returned) Supabase errors are handled, not something this story introduced or worsened. |
| 13 | medium | defer | Edge-case-hunter: the `.range()` loop has no iteration cap, so continued growth of `homework_status_history` means more sequential round-trips per `/admin` load. | Same root cause as Blind-hunter's row 10; a hard iteration cap would silently re-truncate results (recreating the exact undercount bug this pagination was written to fix), so the real fix is a future DB-side aggregate, not a cap — logged as deferred work rather than patched. |
| 14 | low | patch | Edge-case-hunter: `homeworkCompletionPercent` has no upper clamp, so a `(instance, student)` pair with `doneAt`/`reviewedAt` set but no corresponding `assignedAt` row would push the percentage above 100%. | Confirmed at `+page.server.ts:107-108`: no `Math.min(100, ...)`; verified no other consumer of `buildHomeworkProgress` (`student`, `teacher/classes/[id]/homework`) computes this ratio, so there is no existing precedent clamp to fall back on. Real if history data ever contains such an anomaly; trivial fix. |
| 15 | low | patch | Edge-case-hunter (claim): the Tasks checklist's "`rls.spec.ts` -- new Story 5-1 block covering every I/O matrix row" overclaims — the "Any one query fails" row is actually covered by `page.server.spec.ts`, not `rls.spec.ts`. | Confirmed: `rls.spec.ts`'s Story 5-1 block covers the other four I/O matrix rows only; reword the checklist line to name both files, following the same precedent as Story 4-3's row 12. |
| 16 | medium | patch | Verification-gap (pre-verified): `page.server.spec.ts`'s `.range()` mock always returns the same result regardless of call count, so the multi-page continuation branch (`if (page.length < pageSize) break;`) is never exercised by any test. | Filed disposition: patch — make the mock's `.range()` stateful (a full page then a short page) so both the continuation and termination paths are actually driven. |
| 17 | medium | patch | Verification-gap (pre-verified): the same mock's `.eq()` is a no-op and results are keyed by table name only, so the three separately-filtered `profiles` queries can't be told apart by any test that calls the real `load()`. | Filed disposition: patch — same fix as rows 3/16's mock rework; assert per-call filter arguments so a wrong role/status filter would fail a test. |
| 18 | low | defer | Verification-gap (pre-verified): only 1 of the 6 `loadError` OR-chain branches (`historyError`) is exercised by any test; dropping any of the other five terms would silently suppress that query's error banner without a test failing. | Filed disposition: defer — the five untested branches are structurally identical one-liners in a single boolean expression; low risk relative to the two patched findings above, worth revisiting only if this file changes again. |

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including the new live-Supabase RLS case (requires `npm run supabase:start` first)
