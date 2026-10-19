---
title: 'New app shell: header, bottom tab bar, side nav, help'
type: 'feature'
created: '2026-10-19'
status: 'done'
route: 'dispatch'
baseline_commit: '572f4f96fb5a2feb4d9e007779a767d95392ff9b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stories/1-foundation-tailwind-shadcn-theme-isolation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signed-in users on phones and iPads reach every page through iX's hamburger overlay in the top-left corner, and the iX header folds the language switch into a "more" menu (SPEC CAP-1, CAP-6). Every later story needs the new shell before pages migrate.

**Approach:** For signed-in users, replace `ix-application`, `ix-application-header` and `ix-menu` with a shell built on story 1's system: header (logo, language, avatar menu), fixed bottom tab bar below 80em, collapsible side nav from 80em, and a Help sheet. Pages inside stay iX; toasts stay iX (separate story).

## Boundaries & Constraints

**Always:** Nav items and order per role as in `stack.md`. Admin below 80em: Dashboard, Classes, Requests, Calendar and a "More" tab opening a sheet with Teachers, Parents, Teams, Leaderboard, Help (user decision). Bottom-bar labels use the short keys (`nav_dashboard`, `nav_classes`, `nav_homework`, `nav_calendar`, `nav_requests`, `nav_leaderboard`, `nav_help`), wrap to at most two lines and never truncate in en, de or bo. Active item has `aria-current="page"`; Requests shows its count. Targets ≥44×44px; the bar pads `env(safe-area-inset-bottom)`; page content is never hidden behind header or bar. Keep: desktop menu-collapse cookie, role switcher, account link, sign-out with push release, PWA registration, `routeIxLinks`, new-badge dialog, page tours. `data-ui="new"` only on shell chrome and a popup portal root — never around page content.

**Never:** No page content changes. Signed-out header and toasts stay iX. No new destinations, routing or permission changes. No hard-coded colours.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone nav | Teacher at 375px | Bar: Dashboard, Calendar, Requests (count), Leaderboard, Help; no hamburger | — |
| Admin phone | Admin at 375px, tap More | Sheet lists Teachers, Parents, Teams, Leaderboard, Help | — |
| Tablet | Parent at 820px and 1180px (iPad portrait and landscape) | Bottom bar at both (user decision: no nav change on rotate); side nav from 1280px | — |
| Desktop | Admin at 1440px | Side nav, all 9 items; collapse survives reload | — |
| Long labels | Student, de and bo, 375px | Every label fully visible, ≤2 lines | — |
| Unapproved student | `status` pending | No nav items, no account link | — |
| Multi-role login | Teacher who is also an approved parent | Avatar menu lists both roles; picking one posts `/role` | — |
| Help | Help tab (teacher, parent), avatar menu (student), side nav / More (admin) | Help sheet with role tabs and FAQ; tour replay closes it first | — |
| Sign out | Avatar → Sign out | `releasePush()` runs before the sign-out POST | — |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte` -- signed-in branch (`<ix-application>` … `</ix-application>`) is replaced; `navItems`, `roleNames`, `switchRole`, `signOut`, `localeFlags`, `languageItems`, `tourEntry`, `replayTour`, `isActive` carry over. The signed-out `.app-public` branch stays.
- `src/routes/+layout.server.ts:31-41` -- `menuExpanded`, `pendingRequestsCount`, `roles`, `activeRole`, `newBadges`; unchanged.
- `src/lib/menu.ts` -- `MENU_COOKIE`, `WIDE_SCREEN_QUERY` (80.0625em), `rememberMenuExpand` (listens for iX `expandChange`); adapt to the new side nav.
- `src/lib/ix.ts` -- `menuItemLabelRoom`, `menuAboutPanels`, `avatarLabel` lose their only caller; `headerHomeLink`, `dropdownButtonLabelRoom` stay (signed-out header); `setupIx`, `showToast`, `routeIxLinks`, `confirmAction` stay.
- `src/lib/components/PageTour.svelte:191-204` -- waits for `ix-application` and skips while `ix-menu.showAbout` is open; switch to the new help-open state.
- `src/lib/components/HelpGuide.svelte`, `HelpFaq.svelte` -- no iX inside; reuse in the Help sheet.
- `src/lib/help.ts`, `src/lib/tours.ts` -- unchanged.
- e2e shell selectors (`ix-menu-item`, `ix-menu`, `ix-menu-about`, `ix-application-header`, `ix-avatar`, header `ix-dropdown-*`) in `auth-fields`, `breadcrumbs`, `class-join`, `credentials`, `forms`, `parent-access`, `role-switcher`, `tours`.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/ix-visual.e2e.ts` -- FIRST: shoot the `.page` element instead of the viewport (shell excluded); regenerate baselines on commit e267a77 in a temporary worktree; commit.
- [x] `src/lib/components/ui/` -- generate shadcn `dropdown-menu` and `sheet`; add their folders to the `@source` lines if needed.
- [x] `src/lib/nav.ts` + `nav.spec.ts` -- `navItems(role, opts)` and `tabItems(role)` (incl. admin "More") moved out of the layout; unit-test items and order per role and the unapproved student.
- [x] `src/lib/components/shell/` -- `AppHeader`, `BottomNav`, `SideNav`, `HelpSheet`, `PortalRoot`; utilities only; `data-ui="new"` on each.
- [x] `src/routes/+layout.svelte` -- signed-in branch uses the shell; content in a plain `<main>` offset for header and bar.
- [x] `src/lib/ix.ts`, `src/lib/menu.ts`, `src/lib/components/PageTour.svelte` -- remove the three orphaned actions; new side-nav cookie handling; help-open state.
- [x] `e2e/*.e2e.ts` (8 files above) -- shell selectors by role/name or `data-testid`.
- [x] `e2e/shell.e2e.ts` -- one test per matrix row at 375, 820, 1180, 1440px; label checks in en, de, bo.

**Acceptance Criteria:**
- Given any signed-in role at 375px, when a page loads, then the last element of the page content scrolls fully into view above the bar.
- Given the full e2e suite after `supabase:reset`, when it runs, then all tests pass except the pre-existing `teacher.e2e.ts` Reset PIN failure.
- Given `ix-visual`, when it runs after the change, then all page-content screenshots match.

## Implementation Notes

- `ix-visual` (606b1b4): shoots `.page` (`.auth-page` for the signed-out login). Two things the task text did not foresee: (1) iX scrolled inside `ix-content`, so an element taller than the viewport came out blank below the first screen; the test now grows the viewport height to fit the element first (width unchanged). (2) The new shell is sticky and would lie over a tall element shot while scrolled; `normalize()` hides `[data-ui="new"]` (visibility only, layout kept). Playwright's `style` option did not take effect for this, hence the inline style. Baselines regenerated on e267a77 in a temporary worktree; all 8 match the new shell.
- `<main>` keeps iX's `ix-content` padding (`px-8 pt-3 pb-1`) and the side nav is 16rem wide expanded (iX's menu width), so `.page` has exactly the width it had (311px at 375, 1120px at 1440) and page content is pixel-identical. Page gutters get redesigned with the pages.
- Layout: the document scrolls (no inner scroll container). Header `sticky top-0`, side nav sticky below it, bottom bar `sticky bottom-0` at the end of a `min-h-dvh` flex column -- it occupies its own space in the flow, so content is never behind it whatever height the labels need (two lines, Tibetan), with no measuring.
- `viewport-fit=cover` added to `app.html` so `env(safe-area-inset-*)` is non-zero on iOS; header pads top/left/right, bar pads bottom/left/right, side nav left. The signed-out `.app-public` pads left/right so a landscape notch does not cover it (0 on desktop, so signed-out pages are unchanged in tests).
- Breakpoint: Tailwind `xl` (80rem = 1280px) -- bottom bar below, side nav from it. **Conflict in the frozen matrix:** the Tablet row expects the side nav at 1180px, but 1180 < 80em (Approach, stack.md, SPEC assumptions, CAP-8 all say 80em/1280px). Implemented 80em; `shell.e2e.ts` asserts the bottom bar at 1180 and the side nav at 1280. If iPad landscape (1180) should get the side nav, the breakpoint has to drop below 80em (e.g. 73.75em) -- human decision.
- `WIDE_SCREEN_QUERY` and `rememberMenuExpand` are gone from `src/lib/menu.ts`; `rememberMenuExpanded(expanded)` writes the same `sherab-menu` cookie from the side nav's toggle (it exists only from 80em, so phones never overwrite the desktop choice).
- Nav labels: the side nav keeps today's labels (`nav_my_classes`, `nav_my_homework`, `nav_team_leaderboard` for students); the bar uses the short keys. Bar labels wrap with `hyphens-auto` + `wrap-break-word`; German "Hausaufgaben" hyphenates onto two lines at 375px.
- New messages (en/de/bo): `nav_more`, `nav_more_label`, `nav_main_label` (both navs' landmark name), `nav_collapse`, `nav_expand`, `common_close`. The bo strings are my own translations and should be checked by a Tibetan reader.
- Count: the pill is `aria-hidden`; the entry reads "Requests, N pending" (`requests_pending_count`); `data-count` on the link replaces iX's `notifications` property for tests.
- Portal: `PortalRoot` (`<div data-ui="new" id="ui-portal">`) renders after the layout content; the generated `sheet-portal` and `dropdown-menu-portal` default `to` to it (`src/lib/components/shell/portal.ts`). `HelpSheet` has no element of its own outside the portal, so its `data-ui="new"` comes from the portal root. `sheet-content` got a `closeLabel` prop and a 44px close button.
- HelpGuide/HelpFaq style themselves with scoped CSS, which the scoped reset beats inside the portal; `HelpSheet` restores margins/borders/heading size with arbitrary-variant utilities on the tab panels instead of editing the shared components (they also render the /help page).
- Help sheet: full screen below 48em, centred dialog from 48em; built from Bits `Dialog.Content` directly (the shadcn bottom-sheet's `data-[side=bottom]:*` classes out-rank responsive overrides). The tour entry sits once above the tabs instead of in each tab. Replay closes the sheet and starts the tour from Bits' `onOpenChangeComplete` (close finished). Help and More close on any `page.url.pathname` change.
- `PageTour` takes `helpOpen` from the layout instead of reading `ix-menu.showAbout`, also skips while any popup in `#ui-portal` is open, and waits for `ix-button` instead of `ix-application`.
- Signed in, `html` gets `scroll-padding-top` (header + top inset) and below 80em `scroll-padding-bottom` (the bar's measured height, `--bottom-nav-height`) via `:has([data-app-shell])`; `<main>` pads `max(2rem, env(safe-area-inset-*))`; `.app-public` pads all four insets.
- `ix.ts`: `menuItemLabelRoom`, `menuAboutPanels`, `avatarLabel` removed. app.css's `ix-application-header ix-avatar` / `ix-menu` rules are now unused but left for the iX-removal story.
- `NewBadgeDialog.focusPage()` preferred `<main>` over the first `h1`; under iX there was no light-DOM `<main>`, so focus went to the heading. With the shell's `<main>` it would have gone there instead, so the order is now `main h1` → `h1` → `main` (same behaviour as before; `badges.e2e.ts` unchanged).
- `e2e/forms.e2e.ts` finds the Tibetan side nav by test id (its landmark name is Tibetan too). `shell.e2e.ts` gives its approved student a fixture team (#99).
- Unapproved student: no nav at all; avatar menu has Help and Sign out (no account) -- Help was reachable for them before too (the iX menu foot).

- Final verification (after review patches, `supabase:reset`): 1531 unit tests, check 0 errors, ESLint 0 errors, build OK. Full e2e: 152 passed, 4 skipped (help screenshots), 2 failed, 9 not run. Failures: the known `teacher.e2e.ts:1235` Reset PIN (only failure when `teacher.e2e.ts` runs alone, 16 passed); `calendar.e2e.ts:628` failed in `signIn` (stuck on /login, before any shell renders) and its serial block's remaining tests did not run — `calendar.e2e.ts` alone: 25/25 passed, so a flaky sign-in under full-suite load.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter BH, edge-case-hunter EH, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| EH2 | `<main>` has fixed `px-8`, no safe-area inset | medium | `viewport-fit=cover` is new; a landscape iPhone (<80em, bottom bar) has a ~47px notch inset > 2rem, so page content sits under it while header and bar are inset | patch |
| BH3 | No `scroll-padding` for the sticky header and bar | medium | Pages now scroll as a whole (iX scrolled its own content area), so Tab focus, `scrollIntoView` and `#hash` targets (e.g. `scroll-margin-top` on `teacher/classes/[id]`) can land under the 56px header or the bar | patch |
| EH4 | Help and More sheets stay open across back/forward navigation | low | `helpOpen` / `moreOpen` are only reset by their own controls; a back gesture changes the page under an open modal sheet | patch |
| BH1/EH8 | Auto-start tour can open over an open More sheet or header menu | low | `autoStart` checks only `helpOpen` and `ix-modal`; Bits UI popups in `#ui-portal` are invisible to it; reachable in the ~3 s settle window | patch |
| BH2/EH1 | `replayTour` polls a `data-testid` for at most 500 ms | low | Production code depends on a test id; after the cap the tour starts anyway; bits-ui Dialog has a close-complete callback | patch |
| BH6 | Side-nav toggle changes `aria-label` and sets `aria-expanded` | low | Announced twice ("Expand menu, collapsed"); direct fix | patch |
| BH17/EH3 | Signed-out `.app-public` pads only left/right under `viewport-fit=cover` | low | Bottom (home indicator) and top insets unhandled on signed-out pages; direct CSS addition | patch |
| BH13/EH10 | Stale iX-shell comment and orphaned CSS | low | `routeIxLinks` doc cites `<ix-menu-item>`; `app.css` frame variables list `ix-menu`, header `ix-avatar` rule has no element left | patch |
| VG1 | Help-open guard on auto-start untested | low (pre-verified) | No test opens Help while an unseen tour is pending; dropping `{helpOpen}` keeps the suite green | patch |
| VG2 | "My Account" menu click never tested | low (pre-verified) | Only presence checks; a missing `onSelect` would pass | patch |
| BH10 | Unapproved student's Help item untested | low | Only Sign out / no My Account asserted; it is their only route to Help | patch |
| BH5/EH5 | Focus may race when a closing popup hands off to Help | maybe-false (medium if true) | Bits UI restores focus to the dropdown/sheet trigger while the Help dialog traps focus; ordering not verified in a browser | defer |
| BH4 | iX toasts may overlap the bottom bar | false | `setupIx` sets `setToastPosition('top-right')`; toasts are at the top, not near the bar | reject |
| BH7 | 11px bar labels, no Tibetan size bump | low | Tibetan is drawn 1.36x via Atisha `size-adjust`; native tab bars use 10–11px | reject |
| BH8 | Tests contradict the frozen Tablet row | false | Resolved by the human on 2026-10-19: bottom bar at 820 and 1180; row updated | reject |
| BH9 | Replay test does not assert the tour starts | false | `tours.e2e.ts:360` ("runs a seen tour again") covers replay starting the tour; shell test covers the sheet closing | reject |
| BH11 | Teacher Requests count untested | false | `requestsNavItem(teacherPage)` asserts `data-count` in the updated e2e files | reject |
| BH12 | End-of-page check uses last element in DOM order | low | Pages have no reordered/absolute trailing content; fix adds complexity | reject |
| BH14 | `nav.ts` passes labels twice; admin special case | low | Style only, no named harm | reject |
| BH15 | Language menu reloads for the current language | low | Same behaviour as the old iX dropdown (pre-existing) | reject |
| BH16 | `{#each}` to render one More sheet; `aria-current` on More button | low | Style; `aria-current` marks the current section the sheet holds | reject |
| EH6 | No Help for a profile with an unknown role | false | `profiles.role` is a four-value enum; every role has a Help entry | reject |
| EH7 | Two-line limit not enforced with `line-clamp-2` | false | Clamping would truncate, which the spec forbids; the e2e checks the two-line limit for all three languages | reject |
| EH9 | Tibetan glyph check in `forms.e2e.ts` can't see ink overflow | low | Same as story 1 BH5: no overflow clip on the label, so ink is never cut | reject |

## Design Notes

The portal root (`<div data-ui="new" id="ui-portal">` at the end of `<body>`) is the `to` target for every Bits UI popup (dropdowns, sheets), so popups get the scoped reset without wrapping `<main>`, which holds iX content.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: clean DB.
- `npm test` -- expected: all pass, incl. `nav.spec.ts`.
- `npm run check` -- expected: 0 errors.
- `npx eslint .` and Prettier on changed files -- expected: clean.
- `npm run build` -- expected: success, manifest and `sw.js` emitted.
- `npm run test:e2e` -- expected: all pass except the known Reset PIN test.

**Manual checks:**
- iPhone and iPad (Safari 16.4+), portrait and landscape: bar clears the home indicator, labels readable in all three languages.
