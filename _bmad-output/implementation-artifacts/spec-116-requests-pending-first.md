---
title: 'Requests shows what waits first, history below (#116)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
baseline_commit: 'f07c794e7cf7a3d8961d4f7fa8bab638faf0e1d7'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On `/requests` the first card covers only self-registrations and shows "Nothing waiting" when there are none, even while Sick leave, class join, deletion or parent requests wait further down, mixed between "Decided" history cards. A teacher sees the count in the nav, reads "Nothing waiting" and stops.

**Approach:** Put every card that holds pending requests first (registrations, Sick leave, class join, then the admin's deletion and parent requests), then Upcoming leave, then the decided history below. Show the one "Nothing waiting" empty state only when no pending list has a row; its line names requests in general, not only self-registrations. The registrations card gets its own visible heading.

**Decisions (2026-10-24):**
- A pending card with no rows is hidden while anything else waits (as the class join card already is). When nothing waits, only the one empty state shows in their place.
- The history is one collapsed "History" group (`<details>`, closed on load) at the bottom, holding all decided lists: registrations, Sick leave, and for the admin deletion and parent decisions.

## Boundaries & Constraints

**Always:** Same data, actions, forms, confirm dialogs, count pill and row markup (`data-request-row`, `data-tour`, `data-testid` on each section stay). Focus after a decision still goes to the next row, the section heading, or the page `h1` (`refocus`). New and changed texts in en, de and bo; the Tibetan texts are the assistant's draft for the user to review.

**Never:** No change to `+page.server.ts`, the queries, the nav badge or the tours registry. The header subtitles stay as they are. No new component; reuse `EmptyState` and the existing `<details>`/`summary` pattern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Only other kinds wait | 0 registrations, 1 Sick leave pending | No "Nothing waiting", no registrations card; the Sick leave card is first | N/A |
| Nothing waits | Every pending list empty | One "Nothing waiting" empty state at the top, Upcoming leave, closed History | N/A |
| Own child only | Only a Sick row for the viewer's own child | Sick card with the row (as today), no empty state; count pill hidden as today | N/A |
| Join load failed | `joinLoadError`, nothing else pending | Join card with its error line; no "Nothing waiting" | Existing `requests_join_load_failed` |
| Last row decided | One registration pending, approved | Card and row leave; empty state shows; focus goes to the page `h1` | Error keeps row and focus (as today) |

</frozen-after-approval>

## Code Map

- `src/routes/requests/+page.svelte` -- the whole change. Sections in today's order: registrations `:371` (aria-label only, `EmptyState` `:376-383` wrapped in a `data-section-heading` div), decided `:482`, sick `:543`, sick-decided `:637`, upcoming leave `:673`, join `:716` (rendered only with rows or `joinLoadError`), admin block `:801`: deletion, deletion-decided, parents, parents-decided. `refocus` `:101-119` finds `[data-section-heading]` inside the row's `section`, else `main h1`, so a hidden card falls back to `h1` with no change. `pendingTotal` `:274` counts only actionable rows (not own child), so it is not the empty-state test: use the list lengths. The deletion approve form (`:887`) sits inside the deletion section: keep such hidden forms rendered when their card is hidden (move them outside the `{#if}`), or only hide the card when the form cannot be in use. `sectionCard`/`sectionHeading` `:299-300`.
- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.svelte:131-134,212` -- `<details>` with a `summary` class (≥44px target, focus ring) to copy.
- `messages/{en,de,bo}.json:576-579` -- `requests_pending_heading`, `requests_empty_heading`, `requests_empty_body` (says "self-registrations", must change).
- `src/routes/requests/page.render.spec.ts` -- server-render tests; the first expects the empty state inside `requests-registrations` and every pending empty line.
- `e2e/shared-mobile.e2e.ts:446,500,505,775-830` -- section testids, focus after reject, a decided row, the admin 1440px layout of all ten sections (decided tables now inside the closed History).
- `src/lib/tours.ts:210-229`, `PageTour.svelte:84` -- tour steps target rows, and steps with no row on the page drop out; unaffected.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/requests/+page.svelte` -- reorder into pending cards, Upcoming leave, History; add a `nothingWaiting` derived value from the pending list lengths and `joinLoadError`; render each pending card only with rows (join also on its error); one empty state (with `data-section-heading`) at the top when `nothingWaiting`; a visible `h2` with `data-section-heading` on the registrations card; the four decided cards inside one `<details>` with a `summary` "History"; keep the hidden action forms outside any `{#if}` that can remove them while in use; update the doc comment -- the fix itself.
- [x] `messages/en.json`, `de.json`, `bo.json` -- add `requests_registrations_heading` and `requests_history_heading`; reword `requests_empty_body` to cover all requests; drop the pending empty-line keys that no longer render -- texts for the new layout.
- [x] `src/routes/requests/page.render.spec.ts` -- empty state only when every pending list is empty; absent when only Sick, join error or (admin) parent requests wait; empty pending cards absent; pending cards before Upcoming leave before History in the markup; History is a closed `<details>` holding the decided testids; the registrations heading -- the matrix rows.
- [x] `e2e/shared-mobile.e2e.ts` -- open History before checking decided rows and the 1440px decided tables; keep the focus check after a decision -- the browser checks still hold.

**Acceptance Criteria:**
- Given a teacher with one class join request and no registrations, when they open `/requests`, then the first card is the join card and "Nothing waiting" is not on the page.
- Given an admin with pending requests of every kind, when they read the page top to bottom, then all pending cards come before Upcoming leave and the closed History.
- Given the page under Tibetan, when it renders, then the new headings and empty line are in Tibetan.

## Implementation Notes

- The empty state has its own section (`data-testid="requests-empty"`, aria-label `requests_pending_heading`); the own-child rows count as waiting (they are on the page), so `nothingWaiting` uses the list lengths, not `pendingTotal`.
- The join and deletion hidden forms moved after the grid (the deletion one stays admin-only), so a card leaving with its last row does not take its form with it.
- Dropped keys: `requests_sick_empty`, `requests_deletion_empty`, `requests_parents_empty`. The decided empty lines stay (they render inside History).
- Tibetan drafts for review: `requests_registrations_heading` "ཐོ་འགོད།", `requests_history_heading` "ལོ་རྒྱུས།" (as `roster_col_history`), `requests_empty_body` "ཁྱེད་ཀྱིས་ཐག་གཅོད་དགོས་པའི་རེ་སྐུལ་གསར་པ་ཚོ་འདིར་མངོན་འོང་།".
- Verification additions (orchestrator): e2e `the last request decided at 375px (#116)` with a second teacher of class J and one registration covers the matrix row "Last row decided" (card leaves, empty state, focus on `h1`); `pendingRegistration` takes an optional `classId`. Render tests added for AC 1 (only a join request waits: join card first) and AC 3 (under Tibetan, via `overwriteGetLocale`).

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | edge | `nothingWaiting` ignores `loadError` | medium | `+page.server.ts` maps failed pending/sick/deletion/parents queries to `[]` and sets only `loadError`; the page would say "Nothing waiting" beside the error toast | patch |
| 2 | edge | Deletion/parents card has no inline load error | low | Real, but pre-existing: before #116 a failed query showed the false empty line, still no inline error; an inline alert needs new texts | defer |
| 3 | verification-gap | Admin deletion-only empty state untested | medium | Filed evidence: no render isolates the `deletionPending` clause | patch |
| 4 | verification-gap | Deletion form move not seen by its assertion | medium | Filed evidence: the assertion renders with the card present | patch |
| 5 | blind | Header subtitles still name only registrations | low | Real, pre-existing (Sick and join sections predate #116); the spec kept subtitles out | defer |
| 6 | blind | Section subtitles leave with their cards | low | Real, but the decided Sick marker reads "Approved automatically"; moving explanations is more than a direct fix | reject |
| 7 | blind | History `<summary>` is not a heading | low | Heading navigation cannot reach "History"; an `h2` in the summary fixes it directly | patch |
| 8 | blind | Closed History gives no count | low | Design preference; the user chose one closed group | reject |
| 9 | blind | History open state not remembered | low | Needs storage and new state; not met in everyday use enough to justify | reject |
| 10 | blind | Empty card aria-label "Pending" vs "Nothing waiting" | false | A "Pending" region reading "Nothing waiting" is coherent; label unchanged from before | reject |
| 11 | blind | Focus to `h1` when other cards remain | false | The frozen matrix row sets `h1`; behaviour matches | reject |
| 12 | blind | Help screenshot of `/requests` stale | low | Real; refreshed as docs work, as in earlier issues | defer |
| 13 | blind | New e2e cannot survive a retry | false | `playwright.config.ts` sets no retries; other tests in the file mutate seeded rows the same way | reject |
| 14 | blind | Render coverage gaps (deletion-only, own-child join, join-first check) | low | Deletion-only folded into #3; the join-first check (no `</section>` before the join card) does prove it is first; own-child join counts like own-child Sick, which is tested | reject |
| 15 | blind | Tibetan test barely tests Tibetan | low | Only the history heading checked against English; one-line additions | patch |
| 16 | blind | Tibetan "ལོ་རྒྱུས།" may read as "historical account" | maybe-false | Needs a native speaker; already listed for the user's review | reject |
| 17 | blind | Hidden join form unconditional without a comment | false | The comment above the forms says they sit outside the cards so a leaving card keeps them | reject |
