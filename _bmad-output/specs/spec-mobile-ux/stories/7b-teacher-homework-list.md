---
title: 'Teacher homework list'
type: 'feature'
created: '2026-10-20'
status: 'done'
route: 'dispatch'
baseline_commit: '2780ea98ce74ccbc7741f95a71430fe93cb24809'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The teacher's class homework list is still iX (`ix-button` create, filter and pager links, `ix-pill` badges, a page `<style>`). On a phone, its filter buttons and pager are small and the rows are not built for touch (SPEC CAP-2, CAP-3).

**Approach:** Rebuild `/teacher/classes/[id]/homework` phone-first on the new system, following the student homework list (story 4) and the class page (story 7): `ui.*` frame, `ui.filter` links, the shared `Pager`, `Badge` pills and whole-row links. Create and review are story 7c.

## Boundaries & Constraints

**Always:**
- Keep the load, the URLs (`?filter=open|archived|all`, `?page=n`, `pageHref` omitting the defaults), the counts in the filter labels, `aria-current="page"` on the current filter, the empty text per filter, and every message.
- Keep the `?created=…&failed=…&visible=…` toast effect exactly as it is (`showToast`, `replaceState` dropping the params).
- Each row is one link to the homework detail page, at least 44px tall, with its title in `lang={item.contentLanguage}`. The meta line keeps skill · due · done/total.
- Pills become `Badge`s: Recurring `outline` with `RepeatIcon`, Archived `secondary`, Overdue `alarm` (archived wins over overdue, as today).
- The page has its own `data-ui="new"` root (`ui.page`, `data-hydrated`) as a direct child of `main`, with `PageBreadcrumb` inside it.
- Tour targets `homework-create`, `homework-filter` and `homework-row` (on the first row's `li`) stay on elements visible at 375, 820 and 1440px. The breadcrumbs e2e still passes.
- Create button: full width on phone, at least 44px (`ui.touch`).

**Never:**
- No server, load, action or message changes.
- No iX element, `$lib/ix-fields` or `<style>` left in the page. `showToast` from `$lib/ix` stays, as on the other migrated pages.
- No change to the homework create, detail or review pages (story 7c), `Pager.svelte` or `StudentHomeworkRows.svelte`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| List | 3+ assignments, 375 / 820 / 1440px | Rows stacked, title, badges and meta wrap, no sideways scroll | — |
| Filter | Tap Archived | `?filter=archived`, Archived marked current, its rows | No rows → that filter's empty text |
| Pager | 11+ assignments in a filter | `Pager` shows; Previous disabled on page 1, Next is a link | Single page → no pager |
| Created toast | Arrive with `?created=weekly&visible=tomorrow` | Toast once, the URL loses the params | Unknown `visible` → neutral toast |
| Overdue / archived | Overdue open, archived, recurring rows | Matching badges as above | — |
| Fit | en, de, bo at 375px | Targets ≥44px, no cut labels | — |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/classes/[id]/homework/+page.svelte` (245): `ix-button` create :103 (`data-tour="homework-create"`), filter nav :113 (`data-tour="homework-filter"`), list :134 (`li data-tour="homework-row"`, `.homework-row-title` :144), `ix-pill` ×3 :147-154, hand-built pager :174-197, `<style>` :200. Keep the script (:1-82) except the imports.
- Patterns to copy:
  - `src/routes/student/homework/+page.svelte`: `hydrated`/`data-hydrated` root (:22-52), filter links with `ui.filter`/`ui.filterCurrent`/`ui.filterOther` (:60-66), `Pager` (:114).
  - `src/lib/components/StudentHomeworkRows.svelte`: row link markup with `ui.rows`, title with `wrap-break-word`, `Badge` + `RepeatIcon`.
  - `src/routes/teacher/classes/[id]/+page.svelte`: `ui.page`/`ui.header`/`ui.kicker`/`ui.heading`/`ui.subtitle`, `Button href` with `ui.touch`.
- `src/lib/components/Pager.svelte`: takes `page`, `pageCount` and `hrefFor` (already-resolved hrefs); hides itself for one page.
- `src/lib/ui/tailwind.css` :83-85: add `@source '../../routes/teacher/classes/*/homework/+page.svelte';` (the `classes/*/+page.svelte` glob does not reach it).
- e2e:
  - `e2e/teacher.e2e.ts:1211`: `.homework-row-title span[lang="bo"]` → a role- or `data-testid`-based locator.
  - `e2e/teacher.e2e.ts:897-933`: created toasts (`ix-toast` stays; check it still passes).
  - `e2e/tours.e2e.ts:473, 506`: list tour, 3 steps.
  - `e2e/breadcrumbs.e2e.ts:271-291`: the Homework crumb, `h1` "Homework".
  - `e2e/teacher-mobile.e2e.ts`: reuse `teacherPage`, `expectFits`, `toast`, `classPath` (:260-300) for the new tests.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/teacher/classes/[id]/homework/+page.svelte` -- rebuild per Always/Never with `data-testid="homework-row"` on each `li` -- the new UI, with test hooks that don't depend on class names.
- [x] `src/lib/ui/tailwind.css` -- the `@source` line -- Tailwind must see the page's classes.
- [x] `e2e/teacher.e2e.ts` -- replace the `.homework-row-title` locator -- the class is gone.
- [x] `e2e/teacher-mobile.e2e.ts` -- a homework-list block covering each matrix row at 375 and 820px (list and tours also at 1440px), seeding 11+ assignments for the pager, plus the en/de/bo fit check -- regression net for this page.

**Acceptance Criteria:**
- Given the list at 375px, when a teacher taps a filter, a row or Next, then each target is ≥44px and works without sideways scrolling.
- Given the teacher-homework tour at 375, 820 and 1440px, when it starts on the list, then all three steps find a visible target.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap; verification-gap found no gaps):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind-hunter | `li` padding leaves dead tap zones between row links | low | patch | `li` `py-1` + link `py-2`: ~8px between links not tappable; old row put all padding on the link. Direct correction. |
| 2 | blind-hunter | Row-height check measures the `li`, not the link | low | patch | `rows(page).nth(0).boundingBox()` is the `li` incl. its padding; `expectFits` catches links, but the named check misleads. |
| 3 | blind-hunter | "Create button full width on phone" not asserted | low | patch | Only height is checked; one width assertion. |
| 4 | blind-hunter | `data-testid="homework-list"` unused | low | patch | No test references it; deletion. |
| 5 | edge-case | `data.loadError` never shown; a failed load reads as "No open homework." | medium | defer | Load returns `loadError` (+page.server.ts:106); the page before this story ignored it too (pre-existing). |
| 6 | blind-hunter, edge-case | "Toast once" not proved by a reload | false | reject | The test asserts the URL lost its params; a reload of that URL cannot match `created`. Effect code is unchanged. |
| 7 | blind-hunter, edge-case | Other toast branches (now, date, count, partial, empty) untested here | low | reject | Effect code unchanged by the diff; `teacher.e2e.ts` (:751, :877, :917) covers them. |
| 8 | blind-hunter | Newest-first order not asserted; seed relies on it | low | reject | A wrong order fails the page-1/page-2 assertions loudly; separate inserts get distinct `created_at`. |
| 9 | blind-hunter | Weekly row meta (no due date) untested | low | reject | Template unchanged: the due part sits inside `{#if item.nextDue}`. |
| 10 | blind-hunter | Tour test overwrites `tours_seen` with a fixed list | low | reject | The file's own fixture teacher; test-only. |
| 11 | blind-hunter | Seed is ~40 serial round-trips | low | reject | Test speed only; passes in 1.2 min. |
| 12 | blind-hunter | Locale fit check skips `?filter=all` with rows and 820px | low | reject | Same markup as the views checked; 820px fit runs in the list tests. |
| 13 | blind-hunter | Spec file missing from the diff | false | reject | Excluded on purpose; the spec is the claims file. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone: open a class's homework, switch filters, page through, open a row.
