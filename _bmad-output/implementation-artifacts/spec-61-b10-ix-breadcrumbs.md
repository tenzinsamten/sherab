---
title: 'B10 — iX breadcrumbs on nested pages (#61)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '6c3d508338749d3f332562e60b859f1a6724c3e5'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nested pages have no sense of place: each has its own "Back to …" button pointing one level up, so users can't see or jump to the levels above (#61).

**Approach:** Show an iX breadcrumb (`ix-breadcrumb` / `ix-breadcrumb-item`) above the page header on every nested page, built from one shared component, with real links for every level above the current page.

**Decisions (user, 2026-09-29):** all 12 nested pages get a breadcrumb; the breadcrumb replaces their "Back to …" buttons (kickers, headings and other header actions stay). Trails:

| Page | Trail (last = current page, not a link) |
|------|------|
| admin/classes/[id]/students | Classes › {class} › Students |
| admin/classes/[id]/syllabus | Classes › {class} › Syllabus |
| admin/classes/[id]/syllabus/[syllabusId] | Classes › {class} › Syllabus › {year} |
| teacher/classes/[id] | Dashboard › {class} |
| teacher/classes/[id]/homework | Dashboard › {class} › Homework |
| teacher/classes/[id]/homework/new | Dashboard › {class} › Homework › New homework |
| teacher/classes/[id]/homework/[assignmentId] | Dashboard › {class} › Homework › {title} |
| teacher/classes/[id]/syllabus | Dashboard › {class} › Syllabus |
| teacher/classes/[id]/syllabus/[syllabusId] | Dashboard › {class} › Syllabus › {year} |
| student/classes/[classId] | My classes › {class} |
| student/homework/[instanceId] | My homework › {title} (the "My homework" link keeps `?filter=done` when opened from Done) |
| parent/children/[id] | Dashboard › {child} › {tab} |

(On admin class pages without their own class page, "{class}" is plain text, not a link.)

## Boundaries & Constraints

**Always:** Crumb links are real links (SvelteKit client navigation, middle-click/new tab work). The last crumb is the current page (`aria-current="page"`, no link). Labels come from paraglide messages (reuse `nav_*` and existing section/heading keys) or page data; the breadcrumb's own `aria-label` and the "show previous items" label are localized. On narrow screens the trail doesn't overflow the page (collapse earlier items). Collapsed items still navigate.

**Never:** No server/load changes except exposing a label already loaded. Don't change the side menu, tabs, kickers or headings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Navigate up | on homework detail, click "Homework" crumb | goes to the class homework list (client nav) | N/A |
| Deep trail on a phone | 360px wide, syllabus year page | no sideways scroll; earlier crumbs collapse into "…"; picking one navigates | N/A |
| Student from Done | open homework detail with `?from=done`, click "My homework" | lands on `/student/homework?filter=done` | N/A |
| Parent tab | child page `?tab=sessions` | last crumb reads the Sessions tab label; switching tabs updates it | N/A |
| Former class | student homework with no class name | trail still renders (no class level on that trail) | N/A |

</frozen-after-approval>

## Code Map

- New `src/lib/components/PageBreadcrumb.svelte` -- props `items: { label: string; href?: string }[]`; renders `<ix-breadcrumb aria-label=… aria-label-previous-button=… visible-item-count={narrow ? 2 : 9}>` with `ix-breadcrumb-item label href breadcrumb-key={href ?? label}`; `onitemClick` → `goto(breadcrumbKey)` for collapsed (dropdown) items, which have no href; `narrow` from `matchMedia('(max-width: 640px)')`. Place it as the first child of `.page`, before `.page-header`.
- iX facts: item with `href` renders a real `<a>` in shadow DOM (SvelteKit `find_anchor` handles it); last item gets `aria-current="page"` automatically; missing `breadcrumbKey` logs a warning; host defaults `aria-label` to English "Breadcrumbs"; no responsive behaviour besides `visibleItemCount`.
- Pages (each: add `PageBreadcrumb`, remove the back `ix-button`/`<a>`): `src/routes/admin/classes/[id]/students/+page.svelte`, `admin/classes/[id]/syllabus/+page.svelte`, `admin/classes/[id]/syllabus/[syllabusId]/+page.svelte`, `teacher/classes/[id]/+page.svelte`, `teacher/classes/[id]/homework/+page.svelte` (keep its "New homework" button), `teacher/classes/[id]/homework/new/+page.svelte`, `teacher/classes/[id]/homework/[assignmentId]/+page.svelte`, `teacher/classes/[id]/syllabus/+page.svelte`, `teacher/classes/[id]/syllabus/[syllabusId]/+page.svelte`, `student/classes/[classId]/+page.svelte`, `student/homework/[instanceId]/+page.svelte` (its `backHref` logic becomes the "My homework" crumb href), `parent/children/[id]/+page.svelte` (tab labels: `child_tab_overview`, `student_class_homework_heading`, `leave_sessions_label`, `child_tab_record`).
- Labels: `nav_classes`, `nav_dashboard`, `nav_my_classes`, `nav_my_homework`, `homework_heading`, `homework_create_heading`, `syllabus_heading`, `enroll_heading`/`classes_col_students`, `syllabus_year_heading`. New messages (en/de/bo): breadcrumb aria-label, "show previous" label. Remove back keys left unused (`syllabus_back_to_*`, `homework_back_to_*`, `student_classes_back`, `student_homework_back`, `leave_back`) only if no other use.
- `src/app.css` `.page-header` (177-183); `src/lib/ix.ts` registers icons (none needed unless an icon crumb is added).
- Tests: no e2e touches these back buttons.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/PageBreadcrumb.svelte` -- shared breadcrumb as above
- [x] the 12 pages -- add trails per the Decisions table; remove back buttons
- [x] `messages/*.json` -- new breadcrumb labels; delete back keys that became unused
- [x] `e2e/breadcrumbs.e2e.ts` (new) -- matrix rows: navigate up (client nav, no full reload), 360px collapse + dropdown navigation, student `?from=done`, parent tab label, last crumb `aria-current="page"`
- [x] `_bmad-output/manual-verification-issues.md` -- #61 "fixed, to verify"

**Acceptance Criteria:**
- Given any of the 12 pages, when it loads, then its trail matches the Decisions table and every level above is a working link.
- Given a keyboard user, when they tab through the breadcrumb, then each link is reachable and announced with its label.

## Implementation Notes

- `PageBreadcrumb.svelte` renders `<ix-breadcrumb>` with one `<ix-breadcrumb-item label href breadcrumb-key>` per level. Visible crumbs are iX anchors (`target="_self"`); the existing `routeIxLinks()` in `src/lib/ix.ts` (root layout, #40) already hands clicks on iX shadow-DOM anchors to SvelteKit's router, so no new routing code was needed. Modified clicks (middle/ctrl) keep native behaviour.
- iX renders a crumb anchor as `<a role="button">`; an `{@attach linkRole}` removes that role (and re-removes it if iX re-renders), so screen readers announce the levels above as links.
- Collapsed crumbs: iX's "…" dropdown emits `itemClick` on `<ix-breadcrumb>` itself; visible items bubble their own `itemClick` from the item. The handler only acts when `event.target === event.currentTarget` and `goto()`s the crumb whose href equals the key.
- iX recomputes hidden items only on child mutations, not on a `visible-item-count` change, so the breadcrumb is wrapped in `{#key visibleCount}` (2 at `max-width: 640px`, else 9). Items are keyed by href+label so a changed label (parent tab) replaces the element and iX re-reads its items.
- Review fixes: `narrow` starts from `matchMedia` in the browser (no 9-item first render on phones); when narrow, link-less crumbs other than the last are left out (they would be dead entries in the "…" dropdown); each keys and link-less `breadcrumb-key`s include the index; the parent child crumb has no href on the Overview tab; `breadcrumb_label` is "Breadcrumb" / "Navigationspfad".
- Overflow: items get `flex: 0 1 auto; min-width: 2.5rem` (iX sets a fixed 5rem minimum), so long labels ellipsize instead of widening the page.
- "New homework" crumb uses a new `breadcrumb_new_homework` message, as in the Decisions table (reusing `homework_create_heading` "Create assignment" made the current crumb, which iX renders as a focusable button, share its name with the form's submit button and broke teacher.e2e); admin "Students" uses `classes_col_students`; syllabus year crumb shows the formatted year (e.g. 2025/26).
- Parent page: the subtitle that only held the "Back to my children" link was removed with it.
- New messages `breadcrumb_label`, `breadcrumb_show_previous`, `breadcrumb_new_homework` (bo uses English, like other untranslated bo keys). Removed now-unused `syllabus_back_to_classes|list|class`, `homework_back_to_roster|list`, `student_classes_back`, `student_homework_back`, `leave_back`.
- `aria-label-previous-button` triggers Svelte's unknown-aria warning; silenced with `svelte-ignore` (it is an iX prop).

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | E1: two link-less crumbs with the same label (e.g. an admin class named "Students") get the same `{#each}` key and `breadcrumb-key` | medium | key is `${href ?? ''}\|${label}`: class crumb and current crumb both lack href → Svelte `each_key_duplicate` error | patch |
| 2 | V2 + B6: admin trails (mixed link / plain text, admin syllabus route) and the student class trail are untested | medium | breadcrumbs.e2e covers teacher, student homework and parent only | patch |
| 3 | B6 (matrix audit): "Former class" row has no test | medium | no test opens a student homework item whose class is gone | patch |
| 4 | E2 + B3: on a phone a link-less crumb (admin class name) sits in the "…" dropdown and does nothing | low | `onItemClick` only acts on hrefs; direct fix: leave link-less middle crumbs out when narrow | patch |
| 5 | E5 + B8: on the parent Overview tab the child crumb links to the current page | low | `href: baseHref` is the overview URL; direct fix | patch |
| 6 | B1 + B2: de label uses "Sie" (app uses "du"); "You are here" is an odd landmark name | low | direct message fix: "Breadcrumb" / "Navigationspfad" | patch |
| 7 | E4 + B4: first paint on a phone uses 9 visible items, then remounts | low | `narrow` starts false; direct fix: initialise from `matchMedia` in the browser | patch |
| 8 | E3: `linkRole` async IIFE has no `.catch` | low | direct fix | patch |
| 9 | E6: e2e cleanup can run twice and throw, masking a setup error | low | direct fix: drop ids once deleted | patch |
| 10 | B7: `getByText('Back to …')` toHaveCount(0) checks can never fail | low | the keys were deleted; direct fix: remove or assert no header back button | patch |
| 11 | B5: current crumb is a focusable button with no action | low | iX's own rendering (it has `aria-current="page"`); patching further into the shadow DOM adds upgrade risk | rejected |
| 12 | B9 + E7: collapsed crumbs navigate via `goto`, not real links | low | iX renders dropdown items without href; visible crumbs are real links | rejected |
| 13 | B10: ellipsised labels have no tooltip | low | `ix-breadcrumb-item` has no title prop; the full name is in the heading below | rejected |
| 14 | B11: no unit test for the component | low | Vitest runs in node without custom elements; covered by e2e | rejected |
| 15 | B12: bo strings are English | low | existing bo practice | rejected |
| 16 | B13: subtitle/kicker repeat the trail | false | kickers and headings are frozen by the intent ("stay") | rejected |
| 17 | B6: middle-click / new tab untested | low | real `<a href>` in iX's shadow DOM; routeIxLinks only handles plain clicks | rejected |
| 18 | V1: e2e not in the gate | low | already deferred (spec-mv-66-b8b entry in deferred-work.md) | rejected (carried) |
| 19 | V3: resize across 640px after load untested | low | secondary path; the phone path is covered | rejected |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
