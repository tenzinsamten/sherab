# Stack and rollout — mobile-first migration

## Stack

- Tailwind CSS v4 + shadcn-svelte (Bits UI underneath), components generated into `src/lib/components/ui/` and owned by the project. Svelte 5 runes.
- Icons: Lucide (`@lucide/svelte`) replaces `@siemens/ix-icons`.
- Theme: Sherab brand colors, fonts and today's iX corner radius value as Tailwind theme tokens (source: `../../design-tokens.md`, `../../brand-guide.md`; values read from the current iX theme in `src/app.css`).
- Toasts: a shadcn-svelte toast (Sonner) behind a `showToast(type, message)` with today's signature, so callers don't change.
- Dialogs: shadcn Dialog on tablet/desktop, bottom Drawer (sheet) on phone for the same content.
- Date/time inputs: native `<input type="date|time">` on phone and tablet (iOS pickers); keep today's value formats.

## Shell

- Phone and tablet (<80em): top header (logo, language, avatar) + fixed bottom tab bar with safe-area padding (`env(safe-area-inset-bottom)`).
- Desktop (≥80em): collapsible side navigation, same items; replaces `ix-menu`, keeps the remembered collapse cookie (`src/lib/menu.ts`).
- Help guides and FAQ: a full-screen sheet on phone, a dialog on desktop; opened from the Help tab (teacher, parent), the avatar menu (student) or the side nav (admin).

## Primary nav per role

| Role | Items (order) |
|---|---|
| Parent | Dashboard, Homework, Calendar, Help |
| Student | Dashboard, Classes, Homework, Calendar, Leaderboard — Help in the avatar menu |
| Teacher | Dashboard, Calendar, Requests (count), Leaderboard, Help |
| Admin | Side nav on desktop: Dashboard, Classes, Teachers, Parents, Teams, Calendar, Requests, Leaderboard, Help. On phone/tablet: Dashboard, Classes, Requests, Calendar, More (sheet with the rest) |

## Rollout order

1. Foundation: Tailwind + shadcn-svelte, theme, CSS isolation for coexistence, toast/dialog/icon replacements, new shell + bottom bar (all roles get the new shell; pages inside stay iX until migrated).
2. Parent pages — **pilot, go/no-go gate.**
3. Student pages.
4. Shared pages: calendar, requests, leaderboard, account, help, teams, auth pages.
5. Teacher pages, including the shared syllabus/enrollment/schedule components.
6. Admin pages.
7. iX removal: packages, `src/lib/ix.ts`, iX CSS in `src/app.css`, final regression pass.

## Coexistence rules (steps 1–6)

- Tailwind preflight must not restyle iX components; iX global CSS must not reach new components. Isolate before migrating any page.
- A migrated page uses no iX components.
- Shared components move in the step of their first consumer listed above and serve every role from then on.
