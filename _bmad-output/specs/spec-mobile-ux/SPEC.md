---
id: SPEC-mobile-ux
companions:
  - stack.md
  - brownfield.md
  - ../../design-tokens.md
  - ../../brand-guide.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Mobile-first redesign: complete migration off Siemens iX

## Why

Pain to solve: parents, students and teachers use Sherab mostly on phones and iPads; only admins use laptops. The UI is a desktop-first Siemens iX shell — hamburger-only navigation, wide tables, cramped forms and dialogs, an industrial-dashboard look — and iX offers no mobile patterns (bottom nav, card lists) to fix it with. The whole app moves to a mobile-first component system and iX leaves the project, so there is one UI system and a lighter app on phones (see `brownfield.md`, `stack.md`).

## Capabilities

- **CAP-1**
  - **intent:** Parents, students and teachers reach every primary destination on phone and tablet with one thumb-reachable tap.
  - **success:** At 375px and 820px, each role's primary nav items (list in `stack.md`) are visible without opening a menu, sit at the bottom of the screen, show the active item and the Requests count pill, and each is one tap from any page.
- **CAP-2**
  - **intent:** Lists and tables are readable on phone without horizontal scrolling.
  - **success:** At 375px, every list and table renders as stacked rows/cards with every column's data present; page `scrollWidth` ≤ viewport width on every route.
- **CAP-3**
  - **intent:** Forms and dialogs are usable one-handed on phone.
  - **success:** At 375px, every input and button has a ≥44×44px target, fields are full-width with visible labels, every dialog fits the viewport (its content scrolls, actions stay visible), and the on-screen keyboard never hides the focused field or primary action.
- **CAP-4**
  - **intent:** Tablet layouts use the extra width instead of stretching a phone column.
  - **success:** At 820px and 1024px, in portrait and landscape, dashboards and list pages show two columns or a grid where they hold more than one card/section, with no body-text line over ~80 characters.
- **CAP-5**
  - **intent:** Every page looks and feels like a mobile app, built from one shared theme carrying the Sherab brand.
  - **success:** All routes use the shared theme's breakpoints, spacing and colors (no ad-hoc px media queries or hard-coded colors); a before/after screenshot review at 375px per role is accepted by the user.
- **CAP-6**
  - **intent:** The phone header shows only essentials, with language and account one tap away.
  - **success:** At 375px, the header shows logo/name, language switch and avatar with no overflow menu, and no header label truncates in en, de or bo.
- **CAP-7**
  - **intent:** Every page for every role renders with the new component system, every current behaviour kept, and iX is gone from the project.
  - **success:** No `<ix-*` element, `@siemens/ix*` import, `$lib/ix` helper or iX CSS variable remains in `src/`; `@siemens/ix` and `@siemens/ix-icons` are removed from `package.json`; the full unit and e2e suites pass.
- **CAP-8**
  - **intent:** Admins on a laptop get a wide desktop layout of the same system without losing any admin capability.
  - **success:** At ≥1280px, admin pages show side navigation and full data tables, and every admin action that exists today (classes, students, syllabus, teachers, parents, teams, requests) is still reachable and passes its existing e2e test.

## Constraints

- Presentation only: no feature, data, route, server-load or permission changes.
- Rollout is page by page in the order in `stack.md`; the app passes test, check and build and is deployable after every step.
- While iX and the new system coexist, neither's global CSS leaks into the other: unmigrated pages look as before, migrated pages show no iX styling.
- Brand kept: Sherab logo, flags, colors, fonts and today's corner radius carry into the new theme.
- en, de and bo all fit: German label length and Tibetan script never truncate nav or action labels.
- Toasts, page tours (driver.js), help guides, role switcher, push notifications and PWA install keep working at every step; tours point at elements visible at each breakpoint.
- Tests for a page are updated in the same step that migrates it.
- iOS Safari 16.4+ on iPhone and iPad, portrait and landscape.

## Non-goals

- A native iOS/Android app or app-store release.
- New brand identity — logo, colors and fonts stay.
- New features, content or workflow changes found during the redesign (log them separately).
- Offline support beyond what the PWA does today.

## Success signal

- A parent, a student and a teacher each complete their main weekly task (parent: request leave and check homework; student: open and mark homework; teacher: take attendance and review homework) on an iPhone and an iPad without a hamburger menu, sideways scrolling or zooming; an admin completes class and teacher management on a laptop; and `@siemens/ix` is no longer installed.

## Assumptions

- Breakpoints: phone <48em (768px), tablet 48em–80em, desktop ≥80em (1280px).
- iOS minimum is 16.4 because Tailwind v4 requires Safari 16.4+; supporting 16.0–16.3 would mean Tailwind v3.
- The parent pilot is a go/no-go gate: if the new feel is rejected after it, the rest of the plan is reassessed.
- Admin nav on phone/tablet: Dashboard, Classes, Requests, Calendar, and a More sheet for the rest.
