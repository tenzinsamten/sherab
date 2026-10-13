---
title: '#103b Weekly homework: ending a series can also archive the copies students have'
type: 'bugfix'
created: '2026-10-13'
status: 'done'
route: 'dispatch'
baseline_commit: 'a2edf0b68721cfaa3529ab3bd5ee54980c53b419'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ending a weekly homework series stops new copies (#103) but leaves the copies
students already have. A teacher who creates a wrong series, ends it and creates a
replacement still gives students two homeworks, and the end dialog ("End this series? No new
homework is created from it. This cannot be undone.") does not say so.

**Approach:** A choice when ending (user decision, 2026-10-13): next to "End series" the
teacher can tick "also archive the homework students already have from this series". Not
ticked by default, so a series ended normally keeps its last week for the students. Ticked,
ending archives every copy of the series that is not archived yet. The confirm dialog says
which of the two will happen.

## Boundaries & Constraints

**Always:** Archiving stays the only way a copy leaves the students' pages
(`archived_at`/`archived_by`, never a delete); students' done/reviewed history is kept. Every
text change is made in `messages/en.json`, `de.json` and `bo.json`. The series is ended
first; copies are archived only after that succeeded.

**Never:** No change to the generator rule of #103. No resume/un-end action. No migration.
The hosted database is not touched.

## I/O & Edge-Case Matrix

| Scenario             | Input / State                        | Expected Output / Behavior                                                                                                                                               | Error Handling                                                          |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| End, not ticked      | series with open copies              | `ends_on` set; copies untouched; "Series ended."                                                                                                                         | N/A                                                                     |
| End, ticked          | series with open and archived copies | `ends_on` set; every copy with `archived_at` null gets `archived_at`/`archived_by`; already archived copies keep their values; "Series ended and its homework archived." | N/A                                                                     |
| End fails            | stale id, already ended              | nothing archived                                                                                                                                                         | existing "Could not end this series"                                    |
| Ended, archive fails | update of copies errors              | series stays ended                                                                                                                                                       | error says the series was ended and the homework must be archived below |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.server.ts` -- `endSeries`
  (sets `ends_on`, Munich's today) and `archiveInstance` (sets `archived_at`, `archived_by` on
  one `homework_instances` row, scoped by `class_id`). Reuse the archive update, filtered by
  `assignment_id`, `class_id` and `archived_at is null`.
- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.svelte` -- end form at
  `action="?/endSeries"` with `confirmWith(m.homework_series_end_confirm(), ...)`; success
  toasts in the `$effect` switch. `ix-checkbox` usage: `src/routes/admin/teachers/+page.svelte`.
- `messages/{en,de,bo}.json` -- `homework_series_end_confirm`, `homework_series_ended_success`.
- `src/lib/server/student-homework.ts:146` -- a copy is open for a student only while
  `archived_at` is null: archiving is what removes it from the student's page.
- `supabase/migrations/0005_recurring_homework.sql` -- teachers may update only
  `archived_at`/`archived_by` on `homework_instances`, by RLS for their classes only.
- `src/routes/teacher/classes/[id]/homework/new/page.server.spec.ts` -- the pattern for an
  action test with a fake client.

## Tasks & Acceptance

**Execution:**

- [x] `messages/en.json`, `de.json`, `bo.json` -- reword `homework_series_end_confirm` (copies stay); add the tick label, the ticked confirm text, the ticked success text and the "ended, not archived" error
- [x] `.../[assignmentId]/+page.server.ts` -- `endSeries` reads `archiveCopies`, archives the open copies after ending, returns `archived` -- the behaviour
- [x] `.../[assignmentId]/+page.svelte` -- the tick in the end form, the confirm text and toast that follow it
- [x] `.../[assignmentId]/page.server.spec.ts` -- the four matrix rows
- [x] `src/lib/server/rls.spec.ts` -- a teacher of the class archives all open copies of a series in one update; a teacher of another class changes none

**Acceptance Criteria:**

- Given a weekly series whose copy a student sees, when the teacher ends it with the tick, then the student's open homework no longer shows that copy and the series page shows it as archived.
- Given the same series, when the teacher ends it without the tick, then the student still sees the copy.

## Implementation Notes

- `endSeries` ends the series first, then, only for `archiveCopies=on`, archives every copy of
  the series with `archived_at` null (one update, filtered by series and class). It returns
  `archived` (at least one copy was archived) and `archiveFailed`.
- The page keeps the tick in state and sends it as a hidden field of the end form; the confirm
  text and the toast follow it. Label: "When ending, also archive the homework students
  already have from this series".
- Texts in en, de, bo: `homework_series_end_confirm` reworded (existing homework stays), four
  new keys. The Tibetan was written by the assistant and needs a reader's check; it uses
  "ཡིག་མཛོད་དུ་འཇུག" for archive as the existing confirm does, while the Archive button says
  "མཛོད་དུ་བཞག".
- Tests: `page.server.spec.ts` (new) covers the four matrix rows, the exact tick value, a
  series with no open copy and a missing id; `rls.spec.ts` covers the update against the
  database (own class: open copies only; other teacher: none).
- Verified on a reset local database: `npm test` (1332 passed), `npm run build`,
  `npm run check` exit 0. Not checked by hand in a browser: the tick box, the dialog and the
  toast were not clicked through, and neither acceptance criterion has an automated test.
- No migration; nothing pushed.

## Spec Change Log

- Review: with the matrix row "Ended, archive fails" returned as a failure, the page did not
  reload and still showed the series as active. The action now returns a success with
  `archiveFailed`, and the page shows the same message as a warning. The frozen row's intent
  (series stays ended, the teacher is told to archive below) is unchanged.

## Review Triage Log

- medium, patched: ended-but-archive-failed left a stale page / partial success looked like a
  failure -- real (`update()` reloads only on success); success with `archiveFailed`.
- low, patched: comment above said instances are never touched -- reworded.
- low, patched: no row check, "archived" toast with nothing archived -- `archived` is true only
  when a row came back.
- medium, patched: any value of `archiveCopies` counted as ticked -- only `on` does; tested.
- low, patched: the tick was not tied to ending -- label starts "When ending, ...".
- low, patched: RLS test could not see `archived_by` of the earlier copy change -- archived by
  the admin and asserted; action test now pins the recurrence guard, `select` and the no-id
  branch.
- low, patched: spec did not show the state of the work -- updated.
- low, deferred: archived copies lose the teacher's Mark done/Mark reviewed buttons, and
  copies a student finished stay in the student's Done list, which the dialog does not say --
  same as archiving one copy today.
- medium, deferred: a series that is already ended or paused has no "archive the remaining
  copies" action -- out of scope here; copies are archived one by one.
- medium, deferred: no test of the tick box, dialog and toast, or of the student's page after
  a ticked end (no series e2e exists).
- low, deferred: Tibetan uses two words each for "archive" and "series" -- pre-existing; needs
  a reader.
- false: "header says Munich while the helper is todayInBerlin" -- the same time zone, and the
  code base's wording throughout.

## Verification

**Commands:**

- `npx supabase db reset && npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
