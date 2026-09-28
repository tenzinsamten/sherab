---
title: 'Manual-verification B4: parent shared calendar with each child's leave answers'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'feba8aca3e9a177037dbbcbd9778cb4812dfd898'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parents have no calendar (#58): their menu has only Dashboard, and `/calendar` shows them nothing child-specific. Decided: use the shared `/calendar`, covering all linked children, with each child's current leave answer on their sessions.

**Approach:**
- Add Calendar to the parent menu.
- For a parent, `/calendar` shows the class sessions of their approved children, with a child picker and each child's leave answer on the sessions they're enrolled in.

## Boundaries & Constraints

**Always:**
- **Scope:** parent-only logins (`profile.role === 'parent'`). Dual-role logins are B13 (#68); their calendar is unchanged here.
- **Nav:** the parent menu becomes Dashboard (`/parent`) and Calendar (`/calendar`).
- **Data** (loader, parent branch):
  - Children: `linked_children()`, approved only.
  - Each child's classes: `class_enrollments` with an explicit `student_id`.
  - Current answer per (session, child): `session_leave_history` for those children and the month's session ids, newest first per pair. Parents may read these rows under 7-4 RLS.
  - Parents read sessions through the existing RLS (`is_parent_in_class`), so no migration.
- **Child picker:** `?child=<id>` (a valid approved child) shows only that child's classes' sessions. With no parameter, or an invalid one, the calendar shows all children ("All children"). Month navigation keeps `child`. The picker is shown only when there are 2 or more approved children.
- **On each non-cancelled session:**
  - Every enrolled child in view is listed with their current answer: Coming, On leave, Sick or Not answered. The parent sees Sick as Sick.
  - This appears in both the day list and the session dialog.
  - Each child's line links to that child's Sessions tab (`/parent/children/[id]?tab=sessions`) to change the answer. No leave editing on the calendar itself.
- **Parents never see editing controls:** `canEdit` stays false.
- **Empty and error states:** no approved children → the normal empty calendar with a short line. A read error sets `loadError` (existing banner).
- **i18n:** new strings in en, de and bo; reuse the `leave_answer_*` keys.

**Never:**
- Leave editing on the calendar.
- Showing other students.
- Pending children's classes.
- A migration.
- Changing the student, teacher or admin calendar behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two children, same class | both enrolled in Yaks; A On leave, B no answer | that session lists A: On leave, B: Not answered | N/A |
| Two children, different classes | A in Yaks, B in Snow Lions | all children: both classes' sessions; `?child=A` only Yaks | N/A |
| Invalid child param | `?child=<other student>` | All children view | N/A |
| One child | one approved child | no picker; that child's sessions and answers | N/A |
| Pending child | one approved, one pending | the pending child's classes and name not shown | N/A |
| No children | parent with none approved | empty calendar + hint line | N/A |
| Cancelled session | cancelled day/session | shown as cancelled; no answers listed | N/A |
| Read failure | leave history query errors | calendar renders; `loadError` true | banner |
| Nav | parent-only login | menu shows Dashboard + Calendar | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/calendar/+page.server.ts`:
  - `:50-140` the load: `role`, `canEdit`, sessions from `class_sessions_effective` (`:73`, the `class_id` column), the student leave block `:92-108` (the pattern to mirror per child), `shapeMonth` at return.
  - Add a parent branch: children, enrollments, answers, the child filter.
- `src/routes/calendar/+page.svelte:62` `leaveLabel`; `:492-494` dialog answer; `:622-623` day-list answer (student only today). Add the parent rendering and picker (links or a select, preserving `month`).
- `src/routes/calendar/page.server.spec.ts` -- add parent-branch tests per matrix row.
- `src/lib/server/calendar.ts` `shapeMonth` -- see whether sessions carry `class_id`; filter before shaping.
- `src/routes/+layout.svelte:119-123` -- parent nav.
- Reuse: `rpc('linked_children')` (`parent/+page.server.ts`), the 7-4 answer dedupe.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/calendar/+page.server.ts` (+ spec) -- the parent branch.
- [x] `src/routes/calendar/+page.svelte` -- the child picker and per-child answers with links.
- [x] `src/routes/+layout.svelte` -- parent Calendar nav item.
- [x] `messages/{en,de,bo}.json`.

**Acceptance Criteria:**
- Given a parent with two approved children in different classes, when they open Calendar, then they see both classes' sessions, each with that child's answer, and picking one child narrows the view.
- `npm test`, `npm run check` and `npm run build` pass (fresh DB).

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind, edge | A `linked_children` failure shows "No approved children yet" beside the error banner | medium | patch | The hint's `children.length === 0` is also true on error. |
| 2 | vgap, blind, edge | `linked_children` and `class_enrollments` read failures are untested as `loadError` | medium | patch | `runParent` always passes a successful rpc; no enrollments error case. |
| 3 | vgap | `childAnswers` is built for cancelled sessions; the "cancelled" test checks only status | low | patch | Hiding relies only on the page guard; the loader now skips them and the test asserts it. |
| 4 | blind | The answer is read twice by screen readers (link aria-label plus visible span) | low | patch | A direct markup fix. |
| 5 | vgap, blind | No browser/e2e test of the picker, `child=` across months, answer lines, cancelled UI, nav item | medium | defer | Node-only vitest; parent e2e fixtures don't exist (same as the earlier parent-page deferrals). |
| 6 | vgap, blind | Newest-answer-first depends on query order the fake ignores | maybe-false (medium) | defer | Same mock-only pattern as the 7-4 student branch; settle with an rls.spec integration read as a parent. |
| 7 | blind | No message when children have no sessions this month | low | reject | A blank month is the normal calendar state for every role. |
| 8 | blind | The "change" link doesn't carry the session or month | low | reject | Enhancement; the Sessions tab lists the next 12 weeks by date. |
| 9 | blind | bo strings are English | false | reject | Project convention. |
| 10 | edge | `max_rows` truncation of leave history | low | reject | Bounded to one month × one family's children. |
| 11 | edge | With one child and `?child=`, there's no picker to go back | low | reject | Only reachable by hand-typing the URL; the view is still correct. |
| 12 | blind | Wasted queries when there are no children or an error | low | reject | Rare paths; the fix restructures the load. |
| 13 | blind | The `childrenByClass` loop could be simpler | low | reject | Style. |
| 14 | blind | Hand-built query strings; `aria-current="page"` on filter links | low | reject | Style; the links work and the current filter is marked. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npm run build` -- expected: pass.
