# Manual Verification Issues — Sherab (tib-class)

Issues found while working through `manual-verification-checklist.md` against the
hosted Supabase project. Logged first, planned and fixed afterwards.

Status: `open` · `draft fix` (code written, uncommitted, not verified) · `fixed` · `wontfix`

| # | Area | Issue | Status |
|---|------|-------|--------|
| 1 | Home `/?justSignedUp=1` | "Account created" banner squashes the split-screen layout into narrow columns | fixed in iX (toast), to verify |
| 2 | `/admin/teams` | Name field keeps the text after a team is created (same on classes and teachers) | fixed in iX, to verify |
| 3 | `/admin/teams` | Two teams can have the same name | fixed, to verify |
| 4 | `/admin/teams` | No way to delete a team | fixed, to verify |
| 5 | Hosted DB | Migrations 0007–0009 (streaks, badges, leaderboard) never applied to the hosted project | fixed (0001–0011 pushed 2026-09-23) |
| 6 | Dev workflow | Every change needs `npm run build` + restarting preview to show up | draft fix |
| 7 | `/admin/classes` | No way to delete a class | fixed, to verify |
| 8 | `/admin/teachers` | "Assign classes" checklist doesn't respond to clicks | fixed (ix-checkbox), to verify |
| 9 | `/admin/teachers` | Teacher details can't be edited after creation | fixed (classes / reset password / remove), to verify |
| 10 | `/leaderboard` | Shows "Something went wrong loading this page's data" | fixed (`team_leaderboard()` responds on hosted), to verify in UI |
| 11 | Whole app | Adopt Siemens iX as the design system | done (all pages), to verify |
| 12 | App header / side menu | Toolbar colour doesn't match the earlier Sherab colours | fixed (navy frame), to verify signed in |
| 13 | App header | No way to switch light/dark theme in the app | deferred to phase 2 |
| 14 | App header | Simplify the toolbar: no seal, no Sign in / Join buttons, language as a dropdown | fixed, to verify signed in |
| 15 | Whole app | Light theme only for phase 1 (app currently follows the OS, so it's dark on a dark-mode Mac) | fixed (`data-ix-color-schema="light"`) |
| 16 | Landing page `/` (signed out) | Landing page looks empty; stack Sign in / Join buttons full width | open (confirmed requirement) |
| 17 | App header | Clicking "Sherab" in the toolbar doesn't go back to the landing page | fixed, to verify signed in |
| 18 | Home `/` (signed in) | No separate home page after login; land on the dashboard | fixed, to verify signed in |
| 19 | `/admin` dashboard | iX cards overlap each other | fixed, to verify |
| 20 | Toasts | Toasts appear bottom right; should be top right | fixed |

---

## 1. Sign-up banner breaks home layout
- **Seen:** after `/signup`, the redirect to `/?justSignedUp=1` shows the banner as a wide
  column beside the blue poster, squeezing the poster and welcome panel.
- **Cause:** `.app-main:has(.split-screen)` is `display: flex` (row), so the banner becomes a
  flex item next to `.split-screen`.
- **Draft fix:** `src/app.css`: `flex-direction: column`, and the banner sits flush above the split screen.

## 2. Create forms don't clear after success
- **Seen:** creating a team leaves its name in the input.
- **Cause:** the actions return the submitted values on success too, and the inputs
  re-render from `form.name` / `form.email` / etc.
- **Draft fix:** teams, classes and teachers pages prefill only when `!form?.success`.

## 3. Duplicate team names allowed
- **Seen:** a second team with the same name is created without error.
- **Why it matters:** the leaderboard and approval team-picker only show the name.
- **Draft fix:** new migration `0010_team_names_and_delete.sql` adds a unique index on
  `lower(btrim(name))`. The action maps `23505` to "A team called "X" already exists."
- **Open question:** should class names stay non-unique (current spec: yes, told apart by code)?

## 4. Teams cannot be deleted
- **Seen:** no delete control on `/admin/teams`.
- **Constraint:** `enforce_team_id_set_once()` blocks the `on delete set null` cascade, so a
  team with students cannot be deleted at DB level.
- **Draft fix:** a "Students" column, and a Delete button (with confirm) only on empty teams.
  RLS `teams_delete_admin` policy is in 0010.
- **Decided (user, 2026-09-23):** a team can be deleted only if no student has been added to it.
  Teams with students cannot be deleted. The draft fix already follows this rule.
- **Note:** a test delete failed because 0010 isn't applied to the hosted DB (see #5).
  The first 0010 file also went missing from disk and was recreated.

## 5. Hosted database is behind the migrations
- **Seen:** `supabase migration list --linked` shows 0001–0006 applied, 0007–0010 not.
  The hosted REST API returns 404 for `student_streaks` / `student_badges` and PGRST202 for
  `team_leaderboard()`.
- **Impact:** streaks, badges, leaderboard (Epic 4) and team delete/uniqueness fail on hosted.
- **To decide:** when and how to push (`supabase db push`), and whether deploys should check
  migrations.

## 6. No live reload while testing against hosted Supabase
- **Seen:** `npm run preview` serves the last build, so each change needs a rebuild.
- **Cause:** `npm run dev` reads `.env` (local Supabase, not running). Only the build uses
  `.env.production` (hosted).
- **Draft fix:** a `dev:hosted` script (`vite dev --mode production`) in `package.json`.
  **Caveat:** it writes to real hosted data.

## 7. Classes cannot be deleted
- **Seen:** no delete control on `/admin/classes`.
- **Decided (user, 2026-09-23):** a class can be deleted only if no student is enrolled.
  This mirrors the team rule in #4.
- **What exists already:** an RLS delete policy on `classes` (0001_init.sql:195). No UI, no action.
- **Cascade to plan for:** `on delete cascade` removes the class's teacher assignments,
  attendance, skill records, homework, and streak rows (0001, 0003, 0004, 0007).
  `profiles.class_id` is `on delete set null`.
- **Open questions:**
  - Do pending or rejected registrations count as "enrolled", or only approved students?
    If they don't count, their `class_id` becomes null and they're orphaned.
  - Should a class with an assigned teacher (or homework) but no students be deletable
    without a warning?

## 8. Teacher form: class checklist doesn't respond
- **Seen:** clicking a class under "Assign classes" in the create-teacher form doesn't
  visibly check it.
- **Likely cause:** the ✓ glyph and `.checked` highlight come from
  `checked = form?.classIds?.includes(cls.id)`, which is the *last server response*, not the
  checkbox's live state. The real `<input type="checkbox">` is visually hidden
  (`.check-row input` in `src/app.css`), so a click toggles an invisible box and the visible
  glyph never changes. The bug predates the #2 draft change.
- **To confirm:** whether the selection still reaches the server on submit (the teacher gets
  assigned even though nothing looked checked). Check whether other `.check-row` lists
  (e.g. the homework student subset) have the same problem.

## 9. Teachers can't be edited after creation
- **Seen:** once a teacher is created, there's no way to change their details.
- **What exists:** `/admin/teachers` has only a `create` action. RLS already allows admins to
  add and remove `class_teachers` rows (0001_init.sql:205, :209). There's no admin update
  policy on `profiles`.
- **Open questions (what should be editable?):**
  - Display name
  - Assigned classes (add/remove). Most likely the main need.
  - Email. It's the login identity in Supabase Auth, so changing it needs the Auth Admin API.
  - Reset or reissue the temporary password. It's related to the known gap "no credential
    reissue flow".
  - Deactivate or delete a teacher, and what happens to their classes if so.

## 10. Leaderboard fails to load
- **Seen:** `/leaderboard` shows "Something went wrong loading this page's data. Please
  refresh, or try again shortly."
- **Cause (confirmed 2026-09-23):** the hosted DB has no `team_leaderboard()` function.
  PostgREST returns `PGRST202` because migration 0009 was never applied (see #5).
- **Expected to resolve** once 0007–0009 are pushed. Retest afterwards. Streaks and badges on
  `/student` will likely fail the same way until then.

## 11. Adopt Siemens iX design system app-wide
- **Request (user, 2026-09-23):** use the Siemens iX library as the design guideline for the
  whole application. Docs: https://ix.siemens.io/docs/home/overview
- **Kind:** change request, not a bug. It touches every page, so plan it as its own epic and
  don't fold it into the fixes above.
- **Current state:** custom design in `src/app.css` (split-screen posters, `.check-row`,
  `.btn`, banners, etc.), documented in `planning-artifacts/ux-designs/ux-tib-class-2026-09-14/DESIGN.md`, `design-tokens.md`,
  `brand-guide.md`, `component-specs.md`. Those docs would be superseded or rewritten.
- **To research before planning:**
  - Integration with SvelteKit. iX ships web components (`@siemens/ix`), with official
    wrappers for Angular/React/Vue only, so Svelte would use the web components directly.
    Check SSR/hydration behaviour on the Cloudflare adapter.
  - Theme and licensing: which themes are public (classic light/dark) and whether the Siemens
    brand theme is restricted to Siemens-internal use.
  - Tibetan (`bo`) script rendering with iX typography, and the language switcher.
  - Bundle size and Cloudflare Worker limits. Icons (`@siemens/ix-icons`).
- **Open questions:**
  - Full replacement or incremental (per page)? Before or after fixing #1–#10?
  - Keep the Sherab identity (seal, colours) within iX theming, or go stock iX?
  - Several draft fixes (#1, #2, #4, #8) touch UI that iX would replace. Decide whether to
    finish them now or fold them into the migration.

## 12. Header toolbar colour doesn't match the earlier design
- **Seen (user screenshot 2026-09-23, dark mode):** the iX header and side menu use iX's grey
  (`#283236`-ish), not the Sherab colours.
- **Earlier design:** the nav bar was navy `#0f172a` with white text, and the active link used the
  primary blue `#2563eb`.
- **How to fix:** iX exposes `--theme-app-header--background`, `--theme-app-header--color`,
  `--theme-menu--background` and the menu button variables. Override them in `src/app.css` next
  to the primary-colour override.
- **Decided (user):** navy `#0f172a` toolbar, and the side menu matches it. Implemented as
  element-scoped iX variable overrides in `src/app.css`; the selected menu item is `#2563eb`.

## 13. No theme switch
- **Seen (user, 2026-09-23):** "where is the theme change option". There is none. The app follows
  the OS setting (`data-ix-color-schema="system"` in `src/app.html`).
- **Proposal:** a light / dark / system switch in the header next to the language flags, so it
  also shows when signed out. Store the choice in a cookie and apply it server-side in
  `hooks.server.ts` (like `%paraglide.lang%`), so there's no flash of the wrong theme.
  iX's `ix-menu enable-toggle-theme` only exists in the signed-in menu, so it isn't used.
- **Decided (user, 2026-09-23):** "we need theme switch option". It's a confirmed requirement,
  on the change list for the next planning round.
- **Update (user, 2026-09-23):** "for now lets implement only for light theme. dark is for second
  phase". The theme switch and dark mode move to **phase 2** (see #15).

## 14. Simplify the toolbar
- **Request (user, 2026-09-23):** "Remove the app icon from the toolbar and also remove sign in and
  join class button from it. just keep the language switch. and language should can be dropdown"
- **Changes (`src/routes/+layout.svelte`, `src/app.css`):**
  - Remove the seal logo (`slot="logo"`, `.app-logo`) from `ix-application-header`, signed in and
    signed out.
  - Remove the signed-out header's Sign in / Join buttons. The home page card already has both,
    and `/login` links to forgot-password, so nothing becomes unreachable. `/join` stays
    reachable from the home card.
  - Replace the three flag links with one dropdown (e.g. `ix-dropdown-button` showing the current
    language, items English / Deutsch / བོད་སྐད།). Keep full-page navigation
    (`data-sveltekit-reload`) to the `localizeHref` URL.
- **Done (2026-09-23):** the seal, the email and the Sign in / Join buttons are removed from the
  toolbar. The language is an `ix-dropdown-button` (globe + current language; items show flag +
  name, the current one ticked) in the header's `ix-application-header-avatar` slot, the only
  right-hand slot that doesn't collapse into the phone "more" menu. Choosing a language does a
  full page load of the `localizeHref` URL, as before. Verified signed out: `/login` → Deutsch →
  `/de/login` in German.

## 15. Light theme only (phase 1)
- **Decided (user, 2026-09-23):** "for now lets implement only for light theme. dark is for second
  phase".
- **Change:** `src/app.html` sets `data-ix-color-schema="light"` instead of `"system"`. Remove the
  dark-mode link override in `src/app.css` (`--sherab-link` blocks), or leave it dormant for phase 2.
  The navy header/menu frame (#12) is the same in both schemas, so it's unaffected.
- **Phase 2:** dark mode and the theme switch (#13).

## 16. Landing page looks empty
- **Request (user, 2026-09-23):** "home page looks very empty. what can we add ? and also have sign
  in and join class button one below another with full width"
- **Clarified (user, 2026-09-23):** "i meant at landing page. http://localhost:5173/". The scope
  is the **signed-out landing page**. The signed-in cards below came from the follow-up Q&A
  (answered "yes"). They're secondary: do them after the landing page, and confirm before
  building.
- **Decided (user):**
  - **Signed out, the landing page** (`src/routes/+page.svelte`, `AuthCard`):
    - Stack **Sign in** and **Join a class** on top of each other, both full width
      (`ix-button class="block"`).
      The user also flagged the **button alignment** explicitly: today the two buttons sit side
      by side and centred in the card. Both should span the card's full width, Sign in (primary)
      on top and Join a class (secondary) below, with the same gap as the login form's fields.
      **Done 2026-09-23** (user: "i want it join a class button below Sign in"): `.stacked-actions`
      in `src/routes/+page.svelte`; checked in the browser. The rest of #16 (content sections)
      is still open.
    - Below the welcome card, add **How joining works**: three steps for parents
      (1. get the class code from the teacher, 2. register the child with a guardian email and
      consent, 3. the teacher approves and gives the child a username and PIN).
    - Also add **What Sherab tracks**: iX cards with icons for attendance, homework, skills
      (language / song / dance), and streaks with the team leaderboard.
  - ~~**Signed in (secondary, confirm first):** add summary cards~~ Superseded by #18: signed-in
    users no longer see `/`. Original idea: instead of a bare greeting and a row of buttons.
    - Admin: the dashboard numbers (classes, teachers, pending requests), linking to their pages.
    - Teacher: their classes as cards linking to each roster.
    - Student: current streak, badges, and the next homework due.
- **Notes for planning:**
  - `/` has no `+page.server.ts` today; the page only gets `profile` and `pendingRequestsCount`
    from `+layout.server.ts`. The signed-in cards need a new `src/routes/+page.server.ts` that
    reuses the queries in `admin/+page.server.ts`, `teacher/+page.server.ts` and
    `student/+page.server.ts` (ideally extracted into shared `$lib/server` helpers, not copied).
  - New strings in en/de/bo (bo falls back to English, flagged for review).
  - The signed-out cards need a layout wider than the 28rem auth card, e.g. the welcome card on
    top and a responsive card grid below.

## 17. "Sherab" in the toolbar isn't a link home
- **Seen (user, 2026-09-23):** clicking "Sherab" in the toolbar doesn't go back to the landing page.
- **Cause:** #14 removed the seal, which was the header's only link to `/`. The app name comes
  from `ix-application-header`'s `name` prop, which iX renders as plain text (`ix-typography`)
  in its shadow DOM, so it can't be clicked.
- **Tried first:** a slotted `<a>`. That didn't work: the `logo` slot is `display:none !important`
  below 48em (inside iX's shadow DOM), and the always-visible avatar slot sits in a shrink-to-fit,
  positioned wrapper on the right, so the link can't be placed on the left.
- **Fix (2026-09-23):** keep iX's `name="Sherab"` (always visible) and add the `headerHomeLink`
  Svelte action (`src/lib/ix.ts`) on both `ix-application-header`s. A click or Enter on the name
  goes to `/`, and the name gets `role="link"`, `tabindex="0"` and a pointer cursor (via an
  adopted stylesheet in the header's shadow root). Verified signed out: `/join` → click "Sherab"
  → `/`.

## 18. After login, land on the dashboard (no separate home page)
- **Request (user, 2026-09-23):** "currently home and dashboard is separate. the landing page after
  login should be dashbaord. no need of separate home page"
- **Done:**
  - New `src/routes/+page.server.ts` redirects signed-in users from `/` to their role's start
    page, keeping the query string: admin → `/admin` (Dashboard), teacher → `/teacher` (My
    classes), student → `/student` (My homework). The mapping is `roleHome()` in
    `src/lib/role-home.ts`, with a unit test. Login and every other `redirect(303, '/')` now end
    up there.
  - `src/routes/+page.svelte` is signed-out only (the landing card).
  - Side menu: the separate **Home** item is removed (and `nav_home`); the Dashboard / My
    classes / My homework item is the first entry.
  - Clicking "Sherab" in the toolbar goes to the role's start page when signed in, and `/` when
    signed out.
  - The signup "Account created" toast moved to the root layout, so it still shows after the
    redirect.
- **Assumption:** teachers and students have no "dashboard", so they land on their existing main
  page. Confirm this is wanted.

## 19. Dashboard cards overlap
- **Seen (user screenshot, 2026-09-23):** the stat tiles on `/admin` overlap. Each card is wider than
  its grid cell and spills into the next one.
- **Cause:** iX sets `ix-card`'s host to a fixed `width: 20rem`; the `.tile-grid` cells are
  narrower (`minmax(12rem, 1fr)`).
- **Fix:** `ix-card { width: 100%; }` in `src/app.css`. It applies to every card in the app
  (dashboard, teacher classes, student tiles, leaderboard), all of which sit in a grid cell or
  list row. Checked with a test grid: each card's width and left edge now match its cell exactly
  (213px / 213px).

## 20. Toast position
- **Request (user, 2026-09-23):** "toast is showing but on the botton right. i want it at top right"
- **Fix:** `ix.setToastPosition('top-right')` once in `setupIx()` (`src/lib/ix.ts`), so it applies
  to every toast. Verified: a wrong-password login shows the error toast at the top right
  (container `position` = `top-right`).

---

## Log

<!-- New issues get appended below as they're reported. -->

- 2026-09-23: plan approved (`~/.claude/plans/lets-plan-it-now-snappy-steele.md`). iX 5.2 classic
  migrated app-wide; every error and confirmation is an iX toast; one-time credentials stay in a
  persistent `ix-message-bar`. Primary colour kept at #2563eb (user request). Requires Node
  >= 22.19 (`.nvmrc` = 22.23.2). Migrations 0007–0011 pushed to the hosted DB the same day.
