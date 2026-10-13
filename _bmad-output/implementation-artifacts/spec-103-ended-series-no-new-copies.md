---
title: '#103 Weekly homework: an ended series makes no new copies'
type: 'bugfix'
created: '2026-10-13'
status: 'done'
route: 'oneshot'
baseline_commit: '3d44519defe8ae414c9327118458cbaa082e2204'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ending a weekly homework series sets `ends_on` to today, but the generator still
makes every week whose start is on or before `ends_on`, including weeks not yet made when the
series was ended. A series created and ended on 2026-10-12 got its copy from the nightly job
on 2026-10-13, so students of Senior Dance class saw the same homework twice (#103).

**Approach:** Ending means "no new copies from the moment it is ended" (user decision,
2026-10-13, option 1): once a series' end date is today or earlier, neither the nightly job
nor the copies-on-creation call makes any further copy for it, catch-up weeks included.
Copies that already exist are never touched. The end date is taken from Munich time, like the
rest of the app. The stray copy in the hosted database is not part of this change.

</frozen-after-approval>

## Implementation Notes

- Rule: a series whose `ends_on` is the given day or earlier makes nothing, in
  `generate_recurring_homework_for_series()` (migration `0046_ended_series_no_new_copies.sql`).
  The nightly function and `create_weekly_homework_first_copies()` both go through it and are
  not redefined. The per-week `period <= ends_on` test was dropped: with `ends_on` after the
  given day it can never be false.
- Changed boundary: a week starting exactly on `ends_on` used to be made and is no longer.
  Accepted with option 1: weeks missed (job not run, project paused) are never made for a
  series that was ended afterwards.
- `endSeries` and the series page's load (`teacher/classes/[id]/homework/[assignmentId]/
+page.server.ts`) take today from `todayInBerlin()`, so the page shows "Ended" for the date
  the action wrote.
- First draft also moved the nightly function to Munich's date; taken back after review (it
  broke two #96 tests between 00:00 and 02:00 Munich, and the job runs at 03:00 UTC, when both
  dates are the same).
- Tests (`src/lib/server/rls.spec.ts`): the old "weeks at or before ends_on still generate"
  test now asserts none is made; new tests for created-and-ended-the-same-day, a series with
  one copy and a missed week, and an `ends_on` still ahead; the #96 ended-series case expects
  0 copies.
- Verified on a reset local database: `npm test`, `npm run check`, `npm run build` exit 0.
- Not pushed to the hosted database. The stray copy there (series `87204993…`, due
  2026-10-19) is untouched: the teacher archives it in the app, or it is deleted by hand.

## Review Triage Log

- medium, patched: two #96 tests fail 00:00-02:00 Munich with the nightly function on
  Munich's date -- real (they pin the UTC date); the nightly change was taken back.
- low, deferred: ending leaves existing copies / end dialog text does not say so -- by design
  (3-2), a product choice.
- low, deferred: other homework loaders still use UTC "today" -- real, pre-existing.
- low, patched: issue log said "logged, not built" -- updated.
- low, patched: spec had no notes or verification record -- written above.
- low, patched: stray hosted copy had no owner -- recorded above and in the issue log.
- low, patched: comment on `create_weekly_homework_first_copies` omitted the ended case --
  rewritten in 0046. Old story/epic documents are history and stay.
- low, patched: no test for a series with copies and a missed week; one new test used the
  nightly function with Munich's date -- test added, the other now calls the per-series
  function with an explicit date.
- low, deferred: no test for the `endSeries` action's date; `ends_on` writable directly by
  teachers (null revives a series) -- pre-existing.
- false: "the nightly function's Munich today is unpinned" -- no longer applies, the nightly
  function is unchanged.
