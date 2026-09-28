---
title: 'Manual-verification B5: parent shared homework page'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '940afad60d8289149d371cef0a686f491046cd0b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parents see homework only one child at a time, on each child's Homework tab (#59). Homework is the key focus, so it should be easy to follow across all children in one place.

**Approach:** A new `/parent/homework` page, in the parent menu, lists all approved children's homework together, with the same child picker as the calendar (#58).

## Boundaries & Constraints

**Always:**
- **Scope and guard:** parent-only logins (dual-role is B13). The route sits under `src/routes/parent/`, so the existing parent guard applies: approved parents only, and others see the existing states.
- **Nav:** the parent menu is Dashboard, Homework, Calendar.
- **Data:**
  - Approved children come from `linked_children()`.
  - For each child, `loadStudentHomework(supabase, childId, { filter: 'todo', enrolledClassIds: that child's enrollments, today })`. This is the same Open rule as the child card and the child's Homework tab, so the numbers match.
  - Every read uses the child's id. There is no migration.
- **Open list:**
  - All children's open items merged into one list: overdue first, then by due date ascending, then by title.
  - Each row shows the child's name, homework title, class, due date (formatted like the child page), an Overdue pill, and reference links opening externally (`target="_blank" rel="noopener noreferrer"`).
  - Each row links to that child's page on the Homework tab (`/parent/children/[id]?tab=homework`).
- **Child picker:** `?child=<approved child id>` narrows the page to one child. Anything else shows all children. The picker is shown only with 2 or more children. It uses the calendar's pill styling, including the #70 visited-link fix.
- **Decision 1 — open only:** the page lists open homework only. Done and Reviewed stay on each child's Homework tab (paged there). Each child's name in the picker area, or the page, links to that child's Homework tab for history.
- **No write controls:** no mark-done, and no links into `/student/**`.
- **Empty and error states:** no approved children → a hint. No open homework → an empty line. A read error for one child → a section error line, and the other children still show.
- **i18n:** new strings in en, de and bo; reuse the `student_homework_*` and `parent_card_*` keys where they fit.

**Never:**
- Other students' data.
- Pending children.
- Editing.
- A migration.
- Changing the child page's Homework tab.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two children | A: 1 overdue + 1 due Fri; B: 1 due Wed | order: A overdue, B Wed, A Fri; each row names its child | N/A |
| Picker | `?child=B` | only B's items; picker marks B | N/A |
| Invalid child | `?child=<other or pending>` | all children | N/A |
| One child | one approved child | no picker; that child's items | N/A |
| Matches card | child card says Open 2 | the page lists exactly 2 open items for that child | N/A |
| No homework | children with nothing open | empty line | N/A |
| No children | none approved | hint line | N/A |
| One child's read fails | B's history read errors | A's items shown; error line for B | N/A |
| Links | item with reference links | external anchors with rel noopener | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/parent/+layout.server.ts` -- the parent guard (reuse; the new route sits under it).
- `src/routes/parent/+page.server.ts` -- `linked_children` + enrollments per child pattern.
- `src/routes/parent/children/[id]/+page.server.ts:268` -- `loadStudentHomework` todo call with `enrolledClassIds` (the pattern to copy); its homework row markup in `+page.svelte` (read-only rows, `formatDay`, Overdue pill, `TextWithLinks`).
- `src/lib/server/student-homework.ts` -- `loadStudentHomework` (to-do not paged; done paged at 10); items carry `dueDate`, `overdue`, `referenceLinks`, `className`.
- `src/routes/calendar/+page.svelte` `.child-picker` / `.child-pick` styles with the #70 rules -- reuse the look (move to a shared component or global class if simplest).
- `src/routes/+layout.svelte` parent nav (`role === 'parent'`).

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/parent/homework/+page.server.ts` (+ `page.server.spec.ts`) -- children, per-child open homework, merge and sort, picker, per-child errors.
- [x] `src/routes/parent/homework/+page.svelte` -- picker, merged list, empty and error states.
- [x] `src/routes/+layout.svelte` -- the Homework nav item.
- [x] `messages/{en,de,bo}.json`.

**Acceptance Criteria:**
- Given a parent with two children who have open homework, when they open Homework, then they see one list sorted overdue first then by due date, each row naming its child and linking to that child's Homework tab.
- `npm run supabase:reset`, `npm test`, `npm run check` and `npm run build` pass.

## Implementation Notes

- Picker moved to `src/lib/components/ChildPicker.svelte` (styles incl. the #70 visited-link rules); the calendar now uses it too, so both pages share one look.
- Not-approved or unconfirmed parents are redirected (303) to `/parent`, which shows the existing state.
- Rows are keyed `childId:instanceId` (two children in one class share an instance). Ties after overdue/due/title fall back to child name, then instance id.
- A child whose read fails still contributes any items that did load (as on the child page) plus an error line; the Open count is hidden while any child failed.
- New keys: `nav_homework`, `parent_homework_{intro,picker_label,no_children,child_error,history_label,row_label}`; bo uses English fallbacks like the other recent keys.

## Spec Change Log

## Review Triage Log

Review note: the three reviewer subagents could not be launched (the permission classifier returned no verdict on repeated attempts); the lead session reviewed the diff directly (server load, page, `ChildPicker`, calendar refactor). The user checked the page in the app and confirmed it (2026-09-28).

- The Open rule matches the card and child tab (the same `loadStudentHomework` todo call with the child's enrollments) — verified, no finding.
- A per-child read failure is isolated; the no-children hint is hidden on a `linked_children` error; the count is hidden while any child failed — verified.
- The calendar refactor to `ChildPicker` keeps `monthHref` month and child links and the #70 visited-link rules — verified; calendar spec passes.
- The Open count "(n)" is concatenated outside the message (not localisable) — low, rejected: digits and brackets read the same in en/de/bo.
- `loadStudentHomework` reads the parent's full visible history once per child — low, rejected: school scale.
- No browser test of the page — low, deferred with the existing parent-page e2e entries (deferred-work.md).

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npm run build` -- expected: pass.
