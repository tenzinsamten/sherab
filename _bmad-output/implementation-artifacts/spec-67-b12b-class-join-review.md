---
title: 'B12b — Class join requests on /requests and in the nav count (#67)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '011cea876644087a69cd8ac6f77af88d916c77c4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-67-b12a-class-join-requests.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since B12a, students can send class join requests, but nobody can approve or reject them in the app (#67).

**Approach:** Add a "Class join requests" section to /requests for the admin and each class's teachers, using the existing, tested database functions (`list_class_join_requests`, `decide_class_join`), and count pending requests in the nav pill. No database change.

**Decisions (user, 2026-09-29):** requests are decided on /requests and counted in the nav pill; nobody decides for their own child (AD-4 — B12a enforces this for teachers and the admin alike); the student sees Pending / Rejected on their dashboard (B12a).

## Boundaries & Constraints

**Always:** The section shows only what `list_class_join_requests` returns for the caller. Approve and Reject go through `confirmAction`, then `decide_class_join`; errors map through `classJoinDecisionErrorMessage` (`src/lib/server/class-join.ts`). An own-child row is shown but has no Approve/Reject, with a note that someone else decides. The nav pill adds pending join requests the caller can decide (own-child rows excluded), like the sick-leave count. A load failure affects only this section and the count, not the page.

**Never:** No migration or change to the B12a functions. No change to the other /requests sections. Don't edit `_bmad-output/manual-verification-issues.md` (the user has an uncommitted entry there).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teacher sees request | a pending request for a class they teach | row: student name, their current classes, class asked for, request date; Approve / Reject | N/A |
| Approve | teacher approves after confirming | toast; row gone; student enrolled; class appears in the student's My classes; nav count −1 | mapped error toast |
| Reject | teacher rejects after confirming | toast; row gone; student's dashboard shows Rejected | mapped error toast |
| Other class | request for a class the teacher doesn't teach | not shown, not counted | N/A |
| Own child | teacher (or admin) is the student's parent | row shown with "decided by another teacher or the admin", no buttons; not counted for them | N/A |
| Already decided | decided in another tab | "no longer pending" message; row gone after reload | `join_not_pending` |
| Admin | any class's pending request (not own child) | shown and decidable | N/A |
| Nothing pending | no requests | section says there are none (or is hidden like the other empty sections) | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/requests/+page.server.ts` -- load (pending students 138, admin-only sections 167, `loadSickLeave` pattern with `ownChild`); actions (`approve` 229, `decideSick` 443, `approveParent` 484, …). Add the join-request list to the load and `approveJoin` / `rejectJoin` actions (`requestId` UUID) calling `decide_class_join(p_request_id, p_decision 'approved'|'rejected')`.
- `src/routes/requests/+page.svelte` -- existing sections and `confirmAction` usage (sick-leave section is the closest pattern, incl. its own-child note); add the "Class join requests" section.
- `src/routes/+layout.server.ts` -- `pendingRequestsCount` (28-47): add `list_class_join_requests()` rows with `!own_child`; set `countError` on failure.
- `src/lib/server/class-join.ts` -- `classJoinDecisionErrorMessage` (42501, `join_not_pending`, `join_decision_invalid`, `join_student_not_approved`) and message keys `class_join_error_*`.
- `supabase/migrations/0031_class_join_requests.sql` -- `list_class_join_requests()` columns: request id, student id, student name, current class names, class id/name, requested_at, own_child.
- `src/routes/requests/page.server.spec.ts`, `src/routes/layout.server.spec.ts` (if present) -- extend.
- `e2e/class-join.e2e.ts` (B12a) -- student side; `e2e/fixtures.ts` teacher/class fixtures.
- Messages en/de/bo: `requests_join_*`.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/requests/+page.server.ts` -- load join requests; `approveJoin`, `rejectJoin`
- [x] `src/routes/requests/+page.svelte` -- "Class join requests" section with confirm + toasts, own-child note
- [x] `src/routes/+layout.server.ts` -- add decidable pending join requests to the nav count
- [x] `messages/*.json` -- `requests_join_*` keys
- [x] `src/routes/requests/page.server.spec.ts` + layout count spec -- load mapping, actions, error mapping, count excludes own-child
- [x] `e2e/class-join.e2e.ts` -- student requests with a code → teacher sees it (nav count includes it) → approves → class in the student's My classes; a second request rejected → student's dashboard shows Rejected; own-child row has no buttons

**Acceptance Criteria:**
- Given a teacher with no join requests, when /requests loads, then the page and nav count are unchanged from before B12b.
- Given the full verification, then no existing test changes except the nav-count expectations that now include join requests.

## Implementation Notes

- `loadClassJoinRequests()` in `src/lib/server/class-join.ts` wraps `list_class_join_requests()` for both the /requests load and the layout count (as `loadSickLeave`); a missing student name falls back to "Unnamed student".
- /requests returns `joinPending` and a separate `joinLoadError` (not part of `loadError`): a failed queue shows an inline message in the section only. The section is hidden when there are no rows and no load error, like the other empty sections. The layout count sets `countError`; its three teacher/admin queries run in `Promise.all`.
- Approve and Reject both confirm first, then post one shared hidden form (`?/approveJoin` / `?/rejectJoin`, field `requestId` only). The success toast takes the names from the clicked row (`joinTarget`), not from the server. Actions: 401 signed out, 400 malformed id (no call), 403 on 42501, else 400; messages via `classJoinDecisionErrorMessage`. On `join_not_pending` the action returns `joinStale: true` and the page calls `invalidateAll()` so the stale row goes.
- Request dates use `Intl.DateTimeFormat(getLocale(), …)` in the school time zone (no SSR/hydration mismatch).
- The header pill on /requests also adds the decidable join requests (unchanged when there are none).
- `layout.server.spec.ts`: the fake `rpc` now answers `list_class_join_requests` separately (it used to answer every rpc with the Sick queue); existing expectations unchanged.

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | B3 + E3: after `join_not_pending` (decided elsewhere) the stale row keeps its buttons and every retry fails | medium | SvelteKit doesn't reload data after `fail()`; matrix says the row goes | patch |
| 2 | E6: the section always renders (heading + "none waiting") for every teacher/admin, against the AC "page unchanged with no join requests" | medium | matrix allows "hidden like the other empty sections" | patch |
| 3 | B1 + E1: request date uses `toLocaleDateString()` (runtime locale, SSR/hydration mismatch) | medium | the page's `formatDay` uses `getLocale()` | patch |
| 4 | V2: the /requests header pill now counts join requests, untested | medium | only the nav badge is asserted | patch |
| 5 | B2 + E4: success toast shows names posted by the client | low | direct fix: toast from the clicked row on the client | patch |
| 6 | B4: "enrol" vs the app's "enroll" | low | ~16 existing uses of "enroll" | patch |
| 7 | B6: nav count awaits three queries in sequence | low | direct: `Promise.all` | patch |
| 8 | B7: hidden column header says "Approve" | low | the column holds Approve, Reject or a note | patch |
| 9 | B8: `join_decision_invalid` untested; 401/400 only check status | low | direct | patch |
| 10 | B10: own-child e2e passes on `countError` too; relies on test order | low | direct: compare a known count, note the order | patch |
| 11 | E5: e2e cleanup can fail on `parent_id` FK | low | direct | patch |
| 12 | E2: null student name → blank cell/confirm | low | direct fallback | patch |
| 13 | E7: a join RPC failure raises the app-wide load error | low | same behaviour as the sick-leave count (`loadSickLeave`) | rejected |
| 14 | V1: e2e not in the gate | low | carried (deferred in B8b) | rejected |
| 15 | V3: the load-error branch isn't rendered in a test | low | flag is unit-tested; thin template branch | rejected |
| 16 | B5: bo strings English | low | existing practice | rejected |
| 17 | B9: admin / other-class / already-decided / empty e2e | low | other class and admin rules tested at DB level (B12a); already-decided and empty covered by #1, #2 | rejected |
| 18 | B11: no component tests | low | Vitest runs in node | rejected |
| 19 | B12 + B13: unused `studentId`/`classId`; class list separator | low | cosmetic | rejected |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
