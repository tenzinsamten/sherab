---
title: 'Marked-by labels'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '9abdfa0a24a8ef8802414c0f11a02838f9bffdb4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-managed-homework/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Now that a child, either parent or a teacher can mark homework done, parents can't tell who marked a done item.

**Approach:** Show parents a "Marked done by …" label on done items: on the child page's Homework tab Done list, and in the status line of the story 3 detail page. This is SPEC CAP-4.

## Boundaries & Constraints

**Always:**
- **Which mark:** the label uses the `recorded_by` of the item's **earliest** `done` row, the same row `buildHomeworkProgress` already picks for `doneAt`.
- **Label rules:**

| Who recorded the earliest `done` | Label shown |
|---|---|
| the viewing parent | "Marked done by you" |
| the child | "Marked done by {child's name}" |
| the other parent | "Marked done by {their name}", via `actorLabels` / `actor_display_name` |
| anyone else (a teacher), an unknown name, or a failed lookup | no label |

- **Reviewed items:** a reviewed item with a done row gets the same label.
- **Shared progress:** `HomeworkStudentProgress` gains `doneBy`. `StudentHomeworkItem` gains an **optional** `doneBy`, so existing fixtures and student pages are unchanged.
- **Name lookups:** one lookup per distinct other-parent id per page load, never one per row.
- **Text:** new strings go in `child_homework_done_by_you` and `child_homework_done_by({name})` in en, de and bo.

**Never:**
- No database or migration change.
- No label on student, teacher or admin pages.
- No label on `/parent/homework`, which only lists open items.
- No change to how `doneAt` or the status is computed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Marked by viewer | earliest done `recorded_by` = viewer | "Marked done by you" | N/A |
| Marked by child | `recorded_by` = child id | "Marked done by {child}" | N/A |
| Marked by other parent | `recorded_by` = linked parent B | "Marked done by {B's name}" | N/A |
| Marked by teacher | `recorded_by` = teacher | no label | N/A |
| Several done rows | child at 10:00, then A at 11:00 | label for the child (earliest) | N/A |
| Reviewed after done | done by A, reviewed by teacher | "Marked done by you" for A | N/A |
| Name lookup fails | `actor_display_name` error | no label; page renders | logged by `actorLabels` |
| Open item | no done row | no label | N/A |
| Detail page, done item | as above | label in the status line | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/server/homework-status.ts:12-63` -- `HomeworkStudentProgress` and `buildHomeworkProgress`. Add `doneBy` alongside `doneAt`, taking `recordedBy` from the earliest done row. `HomeworkHistoryRow.recordedBy` already exists (filled by `history-rows.ts:28,43`).
- `src/lib/server/student-homework.ts:38-53` (`StudentHomeworkItem`), `:96` `toItem(instance, assignment, entry, today)` -- set the optional `doneBy` from the entry.
- `src/lib/server/actor-labels.ts` -- `actorLabels(supabase, studentId, actorIds, viewerId)` returns `Map<id, ActorLabel>`. `ActorLabel` is `{self:true} | {self:false, name}`. Reuse it; handle the child id before calling it.
- `src/routes/parent/children/[id]/+page.server.ts`:
  - The leave pattern to copy is at :222-276 (`answeredBy` through `actorLabels`).
  - `toChildItem` and `ChildHomeworkItem` (:114-117, ~:431-440) gain `doneBy`.
  - The Done list comes from `loadStudentHomework(…{filter:'done'})`.
- `src/routes/parent/children/[id]/+page.svelte` -- the `homeworkList` snippet (~:1361-1410) renders done items. Show the label on done rows, following the `answeredBy` rendering at :1054-1059.
- `src/routes/parent/children/[id]/homework/[instanceId]/+page.server.ts` and `+page.svelte` -- the story 3 detail page. Add the label to the status line.
- `messages/{en,de,bo}.json` -- `leave_set_by_you` (en :904) is the wording model.
- Tests:
  - `src/lib/server/homework-status.spec.ts`;
  - `src/routes/parent/children/[id]/page.server.spec.ts` (`fakeSupabase` `rpc` serves `actor_display_name`);
  - the detail page's `page.server.spec.ts` and `page.render.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/homework-status.ts` -- `doneBy` from the earliest done row.
- [x] `src/lib/server/student-homework.ts` -- optional `doneBy` on items.
- [x] `src/routes/parent/children/[id]/+page.server.ts` + `+page.svelte` -- the done-by label on the Done list.
- [x] `src/routes/parent/children/[id]/homework/[instanceId]/+page.server.ts` + `+page.svelte` -- the label in the status line.
- [x] `messages/{en,de,bo}.json` -- the two keys.
- [x] Specs -- `homework-status.spec.ts` (earliest done's `recordedBy`, row order irrelevant); the child page and detail page server specs for every matrix row; a render assertion for the label.
- [x] `e2e/parent-managed-homework.e2e.ts` -- after A marks an item done, A sees "Marked done by you" and B sees A's name.

**Acceptance Criteria:**
- Given the student and teacher pages, when their tests run, then they pass unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31). verification-gap: no gaps.

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge-case | The raw `recorded_by` UUID now reaches student page payloads and the parent detail page payload | medium | `toItem` always sets `doneBy`, and the student detail and `loadStudentHomework` return it; the Never rule says student pages are unchanged | patch: set `doneBy` only on parent paths; don't ship the raw id to the client |
| 2 | edge-case | A blank child name gives "Marked done by " | low | `doneByLabels` sets the child label without a name check, unlike `actorLabels`; one-line guard | patch |
| 3 | blind, edge-case | Teacher ids are still sent to `actor_display_name`, and the comments say "one lookup per other parent" | low | The comments overstate it (an extra RPC per teacher id); correcting them is direct; filtering by parent ids adds logic | patch: correct the comments |
| 4 | edge-case | Detail page with no session user | false | The parent layout gate guarantees a user for this route | rejected |
| 5 | blind | The other parent can be looked up twice (leave plus done) | low | One extra RPC in a rare case | rejected |
| 6 | blind, edge-case | A removed, or once-linked, parent is still named | low | Same `actor_display_name` contract as the leave labels (AD-12) | rejected |
| 7 | blind | Teacher and child rules are tested only against mocks | low | `rls.spec.ts:18460` covers teacher → null; the child is named from loaded data | rejected |
| 8 | blind | Equal-`recordedAt` ties depend on row order | low | Needs two marks in the same microsecond | rejected |
| 9 | blind | The child page Done-list label has no render spec | low | Covered by the e2e with exact text; the page has no render spec file | rejected |
| 10 | blind | Label markup is duplicated in two pages; the guard is checked twice | low | Small duplication; no named drift harm | rejected |
| 11 | blind | Serial round-trips | low | One await, only when labels are needed | rejected |
| 12 | blind | The e2e checks one direction only | low | Unit tests cover the other-parent case both ways | rejected |
| 13 | blind | Spec `doneBy` types looser than `ActorLabel` | low | Assertion-only typing | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/parent-managed-homework.e2e.ts` -- expected: pass.
