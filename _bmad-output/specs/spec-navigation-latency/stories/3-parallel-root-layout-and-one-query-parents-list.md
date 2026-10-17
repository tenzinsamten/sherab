---
title: 'Parallel root layout and one-query parents list'
type: 'refactor'
created: '2026-10-17'
status: 'done'
baseline_commit: '5af4c2f10193c0735f0563fc53da2ff9bceb4b5c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/latency-findings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The root layout load runs up to five rounds of queries one after another: the profile, then `getCapabilities`, then a count batch, then the `parents` count, then the `deletion_requests` count. It also reads `profiles select('*')`. `/admin/parents` reads the parents first and then their children, with every parent id in the URL. That adds a round trip, and it fails once there are a few hundred parents (SPEC CAP-3, CAP-5).

**Approach:**
- The root layout makes at most two rounds. Round 1 reads the profile and the capabilities together. Round 2 is one `Promise.all` of every count, plus the new-badge read.
- The layout reads an explicit profile column list instead of `*`.
- `/admin/parents` runs its parents and children reads concurrently, without an id list.

## Boundaries & Constraints

**Always:**
- Same returned data and the same `loadError` semantics as today for every role: signed out, unapproved student, student, parent, teacher, admin, and multi-role logins.
- Round 1 may read the capabilities for a parent-only login and then ignore them, which matches today's result. Whether a later read happens still depends on the profile role and the active role, as today.
- The profile column list covers every field any consumer of the layout's `profile` reads, at least `id, role, status, display_name, email, email_confirmed_at, tours_seen`. Narrow `App.PageData.profile` to it, so `npm run check` flags anything missed.
- `/admin/parents` reads the children as `role = 'student'` with a non-null `parent_id`, and maps them onto the listed parents. RLS still limits rows to the admin.

**Never:**
- No change to the URL-dependency comments or behaviour (`void url.pathname`, the multi-role `url` read). They decide when the layout re-runs.
- No new RPC, view or migration.
- No change to `getCapabilities`, `loadSickLeave` or `loadClassJoinRequests` themselves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin | admin login | Same `pendingRequestsCount` as today (students, sick, join, parents, deletions); counts read in one batch | Any failed count sets `loadError` |
| Parent-only | parent login | `roles = ['parent']`; no counts read; same data as today | A capabilities failure has no effect, as today |
| Unapproved student | pending student | No menu data, `void url.pathname` still read, no badge read | N/A |
| Approved student | student, active role student | `newBadges` read in round 2 | A badge-read failure shows no dialog and no error, as today |
| Many parents | 1 000 parents rows | Children read with no `in(...)` id list; every parent lists its children | A failed children read gives `loadError`, as today |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.server.ts:39-141` -- the five rounds. The profile is at `:39-43` (`select('*')`), capabilities at `:57-60` (run only when `role !== 'parent'`), the batch at `:82-91`, the admin counts at `:98-118` (serial), and badges at `:125-141` (need `active`).
- `src/lib/server/capabilities.ts` -- `getCapabilities(supabase, userId)`, which runs its own two parallel reads. Reuse it unchanged.
- `src/app.d.ts` -- `PageData.profile` is the full `profiles` Row. Narrow it to the column list.
- `src/routes/+layout.svelte` -- reads `data.profile` `id, role, status, display_name, email, tours_seen`. Pages that take `profile` from `await parent()` also read `email_confirmed_at` and `role`. Let `npm run check` find the rest.
- `src/routes/layout.server.spec.ts` -- existing tests and mock style (`safeGetSession`, `supabase.from` mocks). Extend them for the matrix, and assert round counts with a deferred-resolution mock where it helps.
- `src/routes/admin/parents/+page.server.ts:43-98` -- serial parents → children with `.in('parent_id', ids)`. Replace them with a `Promise.all` of both reads, children `.not('parent_id', 'is', null)`.
- `src/routes/admin/parents/page.server.spec.ts` -- existing spec. Extend it in its own mock style.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/+layout.server.ts` -- Restructure into two rounds as in the Intent; explicit profile columns. -- Saves ~100–200 ms per layout run.
- [x] `src/app.d.ts` -- Narrow `PageData.profile` to the selected columns. -- The compiler then catches consumers.
- [x] `src/routes/layout.server.spec.ts` -- Cover the four layout matrix rows plus a check that the admin counts all start before any resolves. -- Locks in both behaviour and parallelism.
- [x] `src/routes/admin/parents/+page.server.ts` -- Concurrent parents and children reads, no id list. -- One round trip, no URL-length failure.
- [x] `src/routes/admin/parents/page.server.spec.ts` -- With 1 000 mocked parents, children map correctly and the children query has no `in` filter; a failed read gives `loadError`. -- The regression guard for CAP-5.

**Acceptance Criteria:**
- Given an admin, when the root layout runs, then it awaits at most two rounds of queries and returns the same data as before.
- Given the full suite after `supabase db reset`, when `npm run test` runs, then every existing test passes unchanged.

## Implementation Notes

- Root layout: round 1 is `Promise.all([profile (LAYOUT_PROFILE_COLUMNS), getCapabilities])`. Round 2 is `Promise.all([staff batch | null, admin counts | null, badges | null])`, with each slot gated by the same role and active-role conditions as before.
- `App.PageData.profile` is a `Pick` of the 7 columns; `npm run check` found no consumer that needs another.
- `/admin/parents`: parents and children in one `Promise.all`; children `.eq('role','student').not('parent_id','is',null)`, mapped onto listed parents. A failed children read is a load error only when there is at least one parent (review #3).
- Two existing parents-spec tests changed because they asserted the replaced id-list behaviour (`inArgs`, and "skips the children query when there are no parents"). The stale layout test "never reads the parents row of a parent-only login" was removed (review #1); the CAP-3 parent test covers the new contract.
- New tests: 8 round tests in `layout.server.spec.ts` (6 fail against the old serial code), a teacher round test, a parents-count failure, a 1 000-parent test, and a zero-parent children failure.
- Verification: DB reset, then `npm run test` (1 459 passed), `check` and `build`, all exit 0.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | `layout.server.spec.ts:243` "never reads the parents row of a parent-only login" passes only because it checks `calls` before awaiting; it contradicts the new behaviour | medium | Real: no `await result`, and capabilities are now read for every login. Other "never…" tests await their result | patch |
| 2 | No test fails the pending `parents` count, so dropping `parentCountErr` would go unnoticed | medium | Verification-gap, pre-verified: both fakes only error the `deletion_requests` count | patch |
| 3 | With zero parents, a failed children read now gives `loadError` (it was skipped before) | low | Real deviation from "same `loadError` semantics as today"; the fix is a one-condition guard | patch |
| 4 | Round tests miss a teacher login, a multi-role login and a failed profile read | low | Teacher and teacher-parent are covered by older `runLoad` tests (`:151-285`), but not for round count; a teacher round test is cheap. Profile failure → `loadError` is unchanged code | patch (teacher round test only) |
| 5 | Unpaged reads hit `max_rows = 1000`; children past the cap are dropped without an error | medium | Real but pre-existing: the old parents read was unpaged, and the old children `IN` read had the same cap | defer |
| 6 | `getCapabilities` can reject and fail the layout for every role | false | postgrest-js turns fetch failures, aborts included, into `{ error }` (`index.mjs:416` `res.catch`); `getCapabilities` returns null on error | reject |
| 7 | Round 1 re-reads the own profile (inside `getCapabilities`); parent-only logins now make two discarded reads | low | Real but small: a single-role layout runs once per full load (no URL dependency). The spec forbids changing `getCapabilities` | reject |
| 8 | A parents-read failure now logs from `getCapabilities` for parent-only logins | low | Real log noise, rare, and the fix adds a branch | reject |
| 9 | Column list kept in step by hand across the select string and the `Pick` | low | A typed select would drift into a compile error only with a refactor; comments link both | reject |
| 10 | "Every admin count started" test duplicates the exact-rounds test | low | Cosmetic | reject |
| 11 | The `PageData` comment overstates that `npm run check` catches every consumer | low | Untyped `page.data` reads exist nowhere in `src` (grep); cosmetic | reject |
| 12 | Story record and verification evidence not in the diff | false | The spec is the claims file, and verification ran (reset, 1 457 tests, check, build) | reject |
| 13 | "Every existing test passes unchanged" while two parents tests changed | low | They checked the replaced id-list behaviour; recorded in Implementation Notes. The fix would edit the spec | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm run test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0

**Manual checks:**
- After deploy, a root-layout re-run (`x-sveltekit-invalidated=1…`) takes under 200 ms of server wait for an admin (it was ~300 ms).
