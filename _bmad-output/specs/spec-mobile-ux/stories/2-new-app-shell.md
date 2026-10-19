---
title: 'New app shell: header, bottom tab bar, side nav, help'
type: 'feature'
created: '2026-10-19'
status: 'ready-for-dev'
route: 'dispatch'
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
| Tablet | Parent at 820px and 1180px | Bottom bar at 820; side nav at 1180 | — |
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
- [ ] `e2e/ix-visual.e2e.ts` -- FIRST: shoot the `.page` element instead of the viewport (shell excluded); regenerate baselines on commit e267a77 in a temporary worktree; commit.
- [ ] `src/lib/components/ui/` -- generate shadcn `dropdown-menu` and `sheet`; add their folders to the `@source` lines if needed.
- [ ] `src/lib/nav.ts` + `nav.spec.ts` -- `navItems(role, opts)` and `tabItems(role)` (incl. admin "More") moved out of the layout; unit-test items and order per role and the unapproved student.
- [ ] `src/lib/components/shell/` -- `AppHeader`, `BottomNav`, `SideNav`, `HelpSheet`, `PortalRoot`; utilities only; `data-ui="new"` on each.
- [ ] `src/routes/+layout.svelte` -- signed-in branch uses the shell; content in a plain `<main>` offset for header and bar.
- [ ] `src/lib/ix.ts`, `src/lib/menu.ts`, `src/lib/components/PageTour.svelte` -- remove the three orphaned actions; new side-nav cookie handling; help-open state.
- [ ] `e2e/*.e2e.ts` (8 files above) -- shell selectors by role/name or `data-testid`.
- [ ] `e2e/shell.e2e.ts` -- one test per matrix row at 375, 820, 1180, 1440px; label checks in en, de, bo.

**Acceptance Criteria:**
- Given any signed-in role at 375px, when a page loads, then the last element of the page content scrolls fully into view above the bar.
- Given the full e2e suite after `supabase:reset`, when it runs, then all tests pass except the pre-existing `teacher.e2e.ts` Reset PIN failure.
- Given `ix-visual`, when it runs after the change, then all page-content screenshots match.

## Implementation Notes

## Spec Change Log

## Review Triage Log

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
