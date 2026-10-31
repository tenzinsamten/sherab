---
title: 'Parent homework detail page'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: '1d8e30d2f5ef40701275a3125a39cea2c53d4e44'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-managed-homework/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The parent child page lists homework only as a title and a due date. A young child working on the parent's phone can't read the full task, its files, or its class details without logging in as themselves.

**Approach:** Add `/parent/children/[id]/homework/[instanceId]`. It shows everything the student detail page shows for that item, plus Mark done when the child is parent-managed and the item is open. Each homework title on the child page's Homework tab links to it. This is SPEC CAP-3.

## Boundaries & Constraints

**Always:**
- **Guard:** `parent()` → `loadLinkedChild` (404 for a child who isn't linked).
- **Child's own item:** it is the item of *this* child. If the child has no `homework_status_history` row for the instance, return 404, because RLS also lets parents read a sibling's instances.
- **Status:** status and progress come from the child's rows (`student_id = child.id`), never `user.id`.
- **Content shown:**
  - class name (plain text; no parent class route);
  - title in its content language;
  - recurring badge, skill, due date, overdue badge;
  - rich-text body, reference links, files;
  - status badge.
- **Mark done:**
  - It shows only when `parentManaged`, the item is `assigned`, and it isn't archived.
  - It uses `MarkDoneForm` with `onfailure={invalidateAll}`.
  - The page's own `markDone` action calls `markHomeworkDone({..., studentId: params.id})`.
- **Breadcrumb:** dashboard → child (links to `?tab=homework`) → title.
- **Text:** new strings go in `child_homework_*` keys in en, de and bo, reusing existing `student_homework_*` and `child_*` keys where they fit.

**Never:**
- No database or migration change.
- No change to student pages or their tests.
- No change to `/parent/homework` (story 4).
- No "marked by" labels (story 5).
- No link to `/student/...` routes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Linked child's open item, flag on | valid ids | full details; Mark done shown | N/A |
| Same, flag off | valid ids | full details; no Mark done | N/A |
| Done or reviewed item | flag on | status badge; no Mark done | N/A |
| Archived instance | flag on, assigned | no Mark done | N/A |
| Child not linked | any instance | 404 | `loadLinkedChild` |
| Sibling's instance | instance readable, but no history row for this child | 404 | `error(404)` |
| Unknown or bad instance id | — | 404 | `rowOr404` |
| Query error on instance or assignment | DB error | 500 | `rowOr404` |
| Files load error | files error | page renders, `loadError` true | same as the student page |
| Mark done | flag on | inserts the child's `done` row; success toast; status shows done | refusal → 403 message (story 2 mapping), page data reloaded |
| Child page Homework tab | any item | title links to the detail page | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/student/homework/[instanceId]/+page.server.ts:10-80` -- the load to mirror:
  - instance read through `rowOr404(result, HOMEWORK_MESSAGES)` (`src/lib/server/class-access.ts:13,32`);
  - then a `Promise.all` of the assignment (`STUDENT_ASSIGNMENT_COLUMNS`, `student-homework.ts:64`), the history (`.eq('student_id', user.id)`, which becomes the child), `classes` name columns, and `loadHomeworkFiles` (`homework-files.ts:331`);
  - then `buildHomeworkProgress` (`homework-status.ts:33`), keyed `${instanceId}:${studentId}`, and `toItem` (`student-homework.ts:96`).
  - Return shape: `{item, className, files, archived, loadError}`.
- `src/routes/student/homework/[instanceId]/+page.svelte` (144 lines) -- markup to mirror, inline: kicker, h1 with recurring badge, meta line, card (`RichText`, `TextWithLinks`, `HomeworkFiles`), status, `MarkDoneForm` at :134. Its class link becomes plain text.
- `src/routes/parent/children/[id]/badges/+page.server.ts` -- the sub-route pattern: `parent()` → `loadLinkedChild`. `badges/+page.svelte:25-28` is the breadcrumb example.
- `src/routes/parent/children/[id]/+page.server.ts`:
  - `parent_managed` read at :412 (copy it).
  - `markDone` action at :845-852 (copy it into the new route).
- `src/routes/parent/children/[id]/+page.svelte:1361-1410` -- the `homeworkList` title at :1365 (`<strong>`) becomes a link with `resolve('/parent/children/[id]/homework/[instanceId]', …)`.
- `src/lib/components/MarkDoneForm.svelte:25-42` -- props `action`, `onfailure`, `focusAfter`. On the detail page the default `?/markDone` is correct.
- `src/routes/parent/children/[id]/page.server.spec.ts:18-130` -- `fakeSupabase` to copy for the new server spec.
- `src/routes/student/homework/[instanceId]/page.render.spec.ts` -- the render-spec pattern (`svelte/server`, mocked `$app/state`).
- `e2e/parent-managed-homework.e2e.ts` -- fixture with parents A/B, the child, and `instanceId` (beforeAll :78). Extend it.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/parent/children/[id]/homework/[instanceId]/+page.server.ts` -- load per the matrix (404 rules, child-keyed history, `parentManaged`); `markDone` action.
- [x] `src/routes/parent/children/[id]/homework/[instanceId]/+page.svelte` -- detail markup, breadcrumb, `<title>`, Mark done gate, success toast.
- [x] `src/routes/parent/children/[id]/+page.svelte` -- the homework title links to the detail page.
- [x] `messages/{en,de,bo}.json` -- any new `child_homework_*` keys.
- [x] `src/routes/parent/children/[id]/homework/[instanceId]/page.server.spec.ts` -- every load and action row of the matrix.
- [x] `src/routes/parent/children/[id]/homework/[instanceId]/page.render.spec.ts` -- Mark done shown only for flag on + assigned + not archived; the class name isn't a link.
- [x] `e2e/parent-managed-homework.e2e.ts` -- from the Homework tab, open the item's detail page, see its body, mark it done there, status shows done.

**Acceptance Criteria:**
- Given parent B (also linked), when B opens the same detail URL, then B sees the same details.
- Given the student's own detail page, when its existing tests run, then they pass unchanged.

## Implementation Notes

- 2026-10-31: after the review fixes, `npx playwright test e2e/parent-managed-homework.e2e.ts` could not run on this machine (four attempts: sign-in hang, web server start timeout, Chromium launch timeout after 180s; load average 7-9). The same file passed 3/3 before the review fixes. Committed without a fresh e2e run at the user's choice; DB reset, `npm test` (1953), `npm run check` and `npm run build` all exit 0. Rerun the e2e file before relying on it.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-30).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge-case, verification-gap | "Today" is UTC; the Homework tab and `/parent/homework` use `todayInBerlin()` | low | Overdue badge differs between tab and detail near midnight; direct correction | patch |
| 2 | blind | The e2e test relies on the previous test leaving the flag off, and leaves it on | low | A failure in the earlier test cascades with a misleading error; reset via `service` | patch |
| 3 | blind | The e2e `openDetail` waits for `networkidle` | low | Flake source; the hydration marker is already awaited; deletion | patch |
| 4 | blind | `UUID_PATTERN` is defined again | low | Not exported from `linked-child.ts` or `student-pin.ts`; reuse needs a new export (public surface), and the copy is the existing pattern | rejected |
| 5 | verification-gap | No test that a refused mark reloads the page (`onfailure={invalidateAll}`) | medium (gap) | Filed evidence: no spec or e2e exercises it; the story 2 child page has the same gap | defer |
| 6 | blind, verification-gap | `loadError` isn't rendered | low | Same as the student detail page, which the matrix row says to mirror | rejected |
| 7 | blind, edge-case | `profiles` and `classes` read errors are dropped | low | Needs a DB error; fix adds branches | rejected |
| 8 | blind, edge-case | The action accepts another `instanceId`, and archived items | low | Any posted instance is still the child's, gated by the same RLS a click would pass; archived handling matches the student action | rejected |
| 9 | edge-case | The action skips `loadLinkedChild` | low | The spec makes RLS the barrier; same as story 2 | rejected |
| 10 | blind | Data is fetched before the ownership 404 | low | Only data RLS already lets the parent read; four extra reads on a rare path | rejected |
| 11 | blind | Breadcrumb and `<title>` lack `lang` | low | Same as the student page; fix widens `PageBreadcrumb` | rejected |
| 12 | blind | The render spec doesn't cover every content element | low | Markup copied from the student page; e2e checks the body | rejected |
| 13 | blind | e2e doesn't check B's Mark done or the real-RLS 404s | low | Covered by unit tests and story 1 RLS tests | rejected |
| 14 | blind | `skillLabel` copies, one-use `statusClass` | low | The existing pattern across eight components | rejected |
| 15 | blind | The ticked messages task doesn't match an unchanged messages diff | low | No keys were needed; fix would edit this spec | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/parent-managed-homework.e2e.ts` -- expected: pass.
