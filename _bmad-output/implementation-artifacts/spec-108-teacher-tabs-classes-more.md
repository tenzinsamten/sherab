---
title: '#108 Teacher tab bar: Classes tab and a More menu'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
baseline_commit: '13d2c39fa16213b8ea1500d80a2a5c5cb644ab94'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Below 80em the teacher's bottom bar is Dashboard, Calendar, Requests, Leaderboard, Help. The user (2026-10-21, #108) wants Dashboard, Classes, Calendar and Requests as the main tabs, with Leaderboard and Help moved into an overflow menu. Teachers reach their classes most often, but today there is no Classes tab and no classes page.

**Approach:**
- Below 80em, the teacher's bar becomes Dashboard, Classes, Calendar, Requests (count pill), and More. More is a sheet holding Leaderboard and Help, reusing the admin's More sheet.
- Classes opens a teacher classes list.
- `stack.md`'s teacher row is updated to match.

## Boundaries & Constraints

**Always:**
- Reuse `NavMore` and `BottomNav`'s existing sheet. More is active when its page (Leaderboard) is open. Help in the sheet opens the Help sheet, so the Help sheet's "Show me around" replay still works.
- The Requests count pill stays on the Requests tab.
- The Classes tab is active on the classes list and on every `/teacher/classes/...` page. The Dashboard tab stays active only on `/teacher` (exact).
- Labels fit in en, de and bo at 375px (the shell's long-labels test).
- No change to admin, parent or student navigation.
- User decision (2026-10-22): Classes opens a new `/teacher/classes` page listing the teacher's class cards (name, code, Open). It uses one card component shared with the dashboard, and the dashboard keeps its cards.
- User decision (2026-10-22): the desktop side nav (≥80em) lists all six items in order: Dashboard, Classes, Calendar, Requests, Leaderboard, Help. Only the bar below 80em uses More.

**Never:**
- No change to the dashboard's tiles, its class cards or its `teacher-home` tour.
- No new permissions: a teacher sees only their assigned classes (the existing `class_teachers` query under RLS).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Phone bar | Teacher at 375px | Tabs: Dashboard, Classes, Calendar, Requests, More | — |
| More sheet | Tap More | Sheet lists Leaderboard, Help; Leaderboard navigates, Help opens the Help sheet | — |
| On Leaderboard | `/leaderboard` | More tab shows active | — |
| Class page | `/teacher/classes/<id>` | Classes tab active, Dashboard not | — |
| Count | 3 pending requests | Pill "3" on Requests, not on More | — |
| No classes | Teacher with no assignment | Classes page shows the dashboard's empty state | Load error → load-error toast, empty list |

</frozen-after-approval>

## Code Map

- `src/lib/nav.ts:116` (`teacher` destinations):
  - Add `classes` (`/teacher/classes`, `m.nav_classes()`, icon `classes`).
  - `tabItems`: teacher gets `[dashboard, classes, calendar, requests].map(short)` plus a `NavMore` with `[leaderboard, help]`, built like the admin branch (`:181-195`).
  - `navItems`: teacher gets all six in the new order, with Classes added.
- `src/lib/nav.spec.ts` (if present, else new): teacher `tabItems`/`navItems` order, the More contents, and `isActive` for `/teacher/classes/x` and `/leaderboard`.
- `src/lib/components/shell/BottomNav.svelte`: already renders `NavMore` as a sheet. No change is expected; verify that a teacher More with a `help` entry opens Help.
- The classes page:
  - New `src/routes/teacher/classes/+page.server.ts`: the `class_teachers` → `classes(id, name, name_bo, name_de, code)` query from `src/routes/teacher/+page.server.ts:22-34`, with the same localized-name mapping and `loadError` handling. Extract a shared loader in `$lib/server` rather than copy it.
  - New `src/routes/teacher/classes/+page.svelte`: header plus the dashboard's class-card list (`src/routes/teacher/+page.svelte:104-131`). Move the card list into a component used by both pages, keeping the `data-tour` attributes on the dashboard's copy. Add the page to `src/lib/ui/tailwind.css`'s `@source` list (`:84-86`).
- `_bmad-output/specs/spec-mobile-ux/stack.md`: Primary nav per role, teacher row.
- `e2e/shell.e2e.ts`:
  - `:120` teacher phone-bar test: the new tab list and the More contents.
  - `:397` "the Help tab" becomes Help through More; the replay still closes the Help sheet first.
  - Long-labels test: add teacher at 375px in en, de and bo.
- Leave alone: `src/lib/tours.ts`, `src/routes/teacher/+page.svelte`'s tiles and tour targets, and the class page's breadcrumb (it still leads to the dashboard).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/nav.ts` + unit tests: teacher destinations, tab bar with More, side nav order.
- [x] The shared class list component and loader, the `/teacher/classes` page, the `@source` entry, and a `page.server` unit test in the style of `src/routes/teacher/page.server.spec.ts`.
- [x] `stack.md`: the teacher row.
- [x] `e2e/shell.e2e.ts`: the updated teacher bar and Help tests, plus long labels for teacher. Add a teacher Classes e2e: tap Classes, then open a class; the Classes tab stays active.

**Acceptance Criteria:**
- Given a teacher at 375px, when they tap More and then Help, then the Help sheet opens on "For teachers" and replaying the tour still closes it first.
- Given a teacher at 1440px, when the page loads, then the side nav shows Dashboard, Classes, Calendar, Requests, Leaderboard, Help and every item is reachable.
- Given the existing e2e suite, when it runs, then the tours, breadcrumbs and teacher tests pass.

## Implementation Notes

- Shared loader: `src/lib/server/teacher-class-list.ts` (`loadTeacherClasses`), used by `/teacher` and `/teacher/classes`. Shared cards: `src/lib/components/TeacherClassCards.svelte`; `tourTargets` puts the `teacher-home` tour's `data-tour` attributes on the dashboard's copy only, `headingLevel` keeps the heading order right under each page's headings.
- `/teacher/classes` reuses existing messages (kicker `requests_kicker_teacher` "Teacher", heading `teacher_my_classes_heading`, empty state `teacher_no_classes`), so no new translations.
- `e2e/fixtures.ts` `openHelp` now opens Help through the More sheet when the bar has More (teacher and admin below 80em); its other callers keep working unchanged.
- `e2e/nav-progress.e2e.ts` used the teacher's bar Leaderboard tab as "another tab"; it now uses Classes (same intent, Leaderboard moved into More).
- Step-03 audit (orchestrator): the matrix row 'No classes' had no test rendering the empty state, so I added `e2e/shell.e2e.ts` 'teacher with no classes (#108)', using `teacherParent`, who teaches no class. It passes.
- Verification after the review patches (2026-10-22), after `npm run supabase:reset`: `npm test` exit 0 (1595/1595); `npm run check` 0/0; `npm run build` exit 0. e2e `shell`, `tours`, `breadcrumbs`, `teacher-mobile`, `nav-progress` and `shared-mobile` passed 142/142.

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Load error on `/teacher/classes` shows "not assigned to any classes" and a 0 badge (blind, edge) | medium | Load forces `classes: []` on error; the template only checks the length. `student/classes/+page.svelte:41` already switches the header on `loadError`. | patch |
| 2 | Kicker reuses `requests_kicker_teacher` (blind) | low | "Teacher" is accurate; the numbered section labels would clash ("02 / Roster"), so the wording is a product choice and a new key adds translations. | reject |
| 3 | No tour on `/teacher/classes` (blind) | low | `tourFor` returns none, so the layout passes `hasTour=false` and Help hides "Show me around"; nothing breaks. | reject |
| 4 | Class page breadcrumb leads to Dashboard while the Classes tab is active (blind, edge) | low | The spec's Code Map chose to leave it; both pages show the class cards; changing it touches every class sub-page and the breadcrumbs e2e. Raised with the user as a possible follow-up. | reject |
| 5 | Count badge has no accessible name (blind) | low | Same `<Badge>{num(...)}</Badge>` pattern as `student/classes/+page.svelte:35`, so it predates this change. | defer |
| 6 | No component test for `TeacherClassCards` (blind) | low | Covered by the shell e2e (cards, link) and the tours e2e (dashboard targets); `tourTargets=false` is unobservable because the tour only runs on `/teacher`. | reject |
| 7 | `openHelp` fixture matches English labels only (blind, edge) | false | Every e2e fixture targets the English locale by role name (e.g. `mainNav(...).getByRole('link', { name: 'Calendar' })`); no non-English caller exists. | reject |
| 8 | Requests pill on Requests, not on More, not e2e-checked (blind) | low | `nav.spec.ts` asserts `count` on Requests and none on More; `BottomNav` draws the pill from `count`. | reject |
| 9 | Long-labels test skips the More sheet labels (blind) | low | The sheet entries are full-width rows; the same gap exists for admin. | reject |
| 10 | Spliced comment in `nav-progress.e2e.ts` (blind) | low | Real, a direct rewrap. | patch |
| 11 | Spec file untracked (blind) | false | It is committed with the change (`git add -A`). | reject |
| 12 | Comments say "Open", the button says "View roster" (blind) | low | Real, a direct comment fix. | patch |
| 13 | Redundant `error ? [] : classes`; card type declared twice (blind) | low | Harmless; importing the `$lib/server` type into a component adds churn for no user effect. | reject |

## Verification

**Commands:**
- `npm run supabase:reset && npm test && npm run check && npm run build`: all exit 0.
- `npx playwright test e2e/shell.e2e.ts e2e/tours.e2e.ts e2e/breadcrumbs.e2e.ts e2e/teacher-mobile.e2e.ts`: pass.
