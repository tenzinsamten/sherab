# Brownfield — mobile UX current state (2026-10-18)

## Shell (`src/routes/+layout.svelte`)

- Siemens iX `ix-application` + `ix-application-header` + `ix-menu` side menu. Below iX `lg` (`WIDE_SCREEN_QUERY` = 80.0625em, `src/lib/menu.ts`) the menu is a hamburger overlay: every destination is two taps away and top-left (out of thumb reach).
- Header right side: language `ix-dropdown-button` (folds into iX "more" overflow on small screens) and `ix-avatar` menu (role switcher, Account, Sign out).
- Help (guides + FAQ) lives in `ix-menu-about` at the foot of the side menu; page tours (`PageTour.svelte`, `src/lib/tours.ts`) for parent and teacher.

## Nav items per role (current)

| Role | Items |
|---|---|
| Teacher | Dashboard, Calendar, Requests (count pill), Leaderboard |
| Student | Dashboard, My classes, My homework, Calendar, Team leaderboard |
| Parent | Dashboard, Homework, Calendar |
| Admin (out of scope) | Dashboard, Classes, Teachers, Parents, Teams, Calendar, Requests, Leaderboard |

## Screens to cover

- Tables (`<table>`): `teacher/classes/[id]/homework/[assignmentId]`, `requests`.
- Dialogs: `parent/children/[id]`, `calendar`, `PageTour`, `NewBadgeDialog`, `BadgeDetailDialog`.
- Forms with date/select inputs: `teacher/classes/[id]` (attendance, class day), `teacher/.../homework/new`, `parent/children/[id]` (leave), `calendar`, `ScheduleFields`, `EnrollmentPanel`, `SyllabusForm`/`SyllabusList`/`SyllabusFiles`, `StudentHomeworkRows`, `student/homework/[instanceId]`, `account`.
- Other role pages: `teacher`, `parent`, `parent/homework`, `parent/children/[id]/badges`, `student`, `student/classes[/classId]`, `student/homework`, `student/badges`, `leaderboard`, `teams/[teamId]`, `help`, auth pages under `(auth)`.

## Responsive code today

Only three files carry width media queries (`teacher/classes/[id]`, `calendar`, `LinkRows`), with mixed breakpoints (640px, 40em, 48em). No shared breakpoint tokens.

## iX footprint (what the migration replaces)

- Non-admin: 52 `.svelte` files, 363 iX elements, ~11,300 lines. Admin: 8 pages, 38 iX elements, ~1,270 lines.
- Most used: `ix-button` 115, `ix-pill` 80, `ix-input` 28, `ix-select` 22, `ix-empty-state` 20, `ix-card` 19, `ix-date-input` 11, `ix-checkbox` 10, `ix-number-input` 8, `ix-modal` 6, `ix-time-input` 5, `ix-message-bar` 5.
- Helpers: `src/lib/ix.ts` (306 lines: `setupIx`, `showToast`, `routeIxLinks`, header/menu actions); iX theme variables throughout `src/app.css` (563 lines).
- Tests: all 17 `e2e/*.e2e.ts` files (~8,800 lines) reference iX elements.
- Shared by admin and teacher: `SyllabusList`, `SyllabusForm`, `SyllabusDetail`, `SyllabusFiles`, `EnrollmentPanel`, `ScheduleFields`.

## Design-source conflict (resolved)

`planning-artifacts/ux-designs/ux-tib-class-2026-09-14/DESIGN.md` prescribes zero border-radius and `design-tokens.md` / `component-specs.md` clay radius; the user chose today's iX theme radius value. The bottom nav in `component-specs.md` was never built and is now delivered by this spec.
