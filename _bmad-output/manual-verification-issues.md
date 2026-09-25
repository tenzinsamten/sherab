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
| 21 | Admin create / delete actions | No progress indicator while a create or delete is running | fixed, to verify |
| 22 | `/admin/classes` | Two classes can have the same name | fixed (0012 pushed 2026-09-25), to verify in UI |
| 23 | Teacher account | A signed-in teacher can't update their own details or change their password | fixed (`/account`), to verify |
| 24 | Teacher landing page | Teachers need a dashboard as their landing page (today they land on My classes) | fixed, to verify |
| 25 | Homework create | One-off homework for the whole class fails when the class has no approved students | fixed (needs 0013 pushed), to verify |
| 26 | Homework create | No field for a longer description / instructions, only title and one link | fixed (needs 0013 pushed), to verify |
| 27 | Homework create | Only one reference link per homework; teachers need to add several | fixed (needs 0013 pushed), to verify |

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

## 21. No feedback while create / delete is in progress
- **Request (user, 2026-09-25):** "For action like, create and delete, if it takes time then it
  should have progress bar to show something is happening"
- **Seen:** after clicking Create or Delete, nothing changes until the server responds, so on a slow
  request it looks like nothing happened.
- **Scope (to confirm when planning):** create and delete on teams, classes and teachers. Possibly
  other form submits too (teacher edit, reset password, approvals).
- **Decided (user, 2026-09-25):** a spinner on the clicked button is enough, no page-wide bar.
- **Draft fix:** `createPending()` (`src/lib/pending.svelte.ts`) wraps `use:enhance`. The clicked
  button gets iX's `loading` spinner, every action button on the page is disabled until the
  server answers, and a second submit (e.g. Enter in the name field) is cancelled. Applied to
  create/delete on teams and classes, create/save classes/reset password/remove on teachers,
  and approve/reject/clear on `/requests`.

## 22. Duplicate class names allowed
- **Seen (user, 2026-09-25):** three classes all named "Yaks" (codes RV7V4W, VVXAVT, EW6BKB) were
  created without error.
- **Background:** #3 only made **team** names unique. Class names were left non-unique on purpose:
  `0001_init.sql` says a class is identified by its code and duplicate names are allowed, and
  `0010_team_names_and_delete.sql` repeats this. #3's open question on classes was never answered.
- **User expectation:** class names should be unique, like team names.
- **To decide when planning:** unique across the whole app, or only per teacher? How to handle
  any duplicates already in the hosted DB (such as the three "Yaks" test classes) before adding
  the index?
- **Decided (user, 2026-09-25):** unique across the whole app (only admins create classes).
- **Draft fix:** `0012_class_names_unique.sql` adds `classes_name_unique_idx` on
  `lower(btrim(name))`. `insertClassWithUniqueCode` now retries only when the clash is on
  `classes_code_key`, so a duplicate name no longer turns into 5 retries and "could not generate
  a class code". The create action shows `classes_error_duplicate_name` instead. Unit test added.
- **Before pushing 0012:** remove or rename duplicate class names in the hosted DB (at least the
  three "Yaks" test classes), or the migration will fail.

## 23. Teacher can't edit their own details or change their password
- **Seen (user, 2026-09-25, teacher walkthrough step 1):** "as teacher logged, there is no option for
  teacher to update his/her details. or to reset the password"
- **What exists today:**
  - No account/profile page for any signed-in role. The side menu has only My classes, Requests
    and Leaderboard.
  - Password: only the signed-out **Forgot password** link on `/login` (email reset link).
    `/forgot-password` redirects signed-in users to `/`, so a teacher has to sign out first.
    The admin can also reset it from `/admin/teachers` (#9), which issues a new temporary password.
  - Teachers keep the temporary password from creation forever unless they use one of the above.
    Nothing prompts them to change it.
  - RLS: `profiles` has select-own but **no update-own policy** (0001_init.sql:171), so a
    self-edit needs a new policy limited to safe columns, or a server action using the admin client.
- **Open questions:**
  - Which details can a teacher edit? Display name for sure. Email is the login identity
    (needs the Auth Admin API / re-confirmation). Any other fields (phone, etc.)?
  - Change password in-app: ask for the current password first, or only the new one twice?
  - Force a password change on first login with the temporary password?
  - Same account page for admins (and students, who use username + PIN)?

## 24. Teacher dashboard as the landing page
- **Request (user, 2026-09-25, teacher walkthrough):** "teacher also need a dashboard as landing page."
- **Background:** #18 sends signed-in users to their role's start page (`roleHome()` in
  `src/lib/role-home.ts`). It assumed teachers have no dashboard, so they land on `/teacher`
  (My classes: one card per class with a View roster button). This answers #18's
  "confirm this is wanted": not for teachers.
- **Related:** #16's superseded idea of signed-in summary cards ("Teacher: their classes as cards
  linking to each roster"), and the admin dashboard `/admin` (story 5-1) as the pattern to follow.
- **Open questions (what goes on it):**
  - Tiles like the admin one, scoped to the teacher's classes? Candidates: number of classes and
    students, pending requests, homework due this week, overdue homework, homework completion %,
    items waiting for review (Done but not Reviewed), last attendance date per class.
  - Keep the class cards on the dashboard, or keep My classes as a separate menu item?
  - Quick actions (mark attendance today, create homework) from the dashboard?
  - Route: new `/teacher` dashboard with classes moved to `/teacher/classes`, or a new
    `/teacher/dashboard`?
  - Should students also get a dashboard (streak, badges, next homework), or stay on My homework?

## 25. Whole-class homework fails on a class with no students
- **Seen (user, 2026-09-25, teacher walkthrough step 5):** "Create assignment, I assigned to whole
  class but it failed since no student is there."
- **Cause (by design today):** a one-off assignment creates one status row per targeted student.
  `createAssignment` (`src/routes/teacher/classes/[id]/homework/+page.server.ts:375`) returns
  `fail(400)` with "No students to assign this to." (`homework_error_no_students`) when the class
  has no **approved** students. Pending students don't count. The root layout shows it as an error
  toast.
- **Gaps:**
  - The form doesn't warn beforehand: "Whole class" and Create stay enabled on an empty roster,
    so the teacher fills in everything and only then gets the error.
  - Students approved later never receive a one-off assignment made earlier (only the targets at
    creation time get a row). So allowing an empty-class assignment would need new behaviour.
  - Weekly (recurring) mode doesn't hit this check. Not yet verified what the generator does for
    an empty class.
- **Open questions:**
  - Allow creating homework for an empty class, and have students approved later pick up the
    class's open (not archived, not past due) whole-class assignments automatically?
  - Or keep the rule and make it clear up front: a message on the homework page when the
    roster is empty, and "Whole class" / Create disabled, with a clearer text such as
    "This class has no approved students yet. Approve students in Requests first."
  - Does the entered form data survive the error (title, link, date), or does the teacher have to
    retype it? To check.

## 26. Homework has no description field
- **Seen (user, 2026-09-25, teacher walkthrough step 5):** "In create homework, there is no option to
  add more detailed text"
- **What exists:** the create form has title, skill area, reference link, and due date / weekly
  settings. `homework_assignments` (0004_homework.sql:37) has `title`, `skill_area`,
  `reference_link`, `recurrence_rule`, no description column.
- **Change needed (for planning):**
  - Migration: nullable `description text` on `homework_assignments` (with a length limit).
  - Create form: a multi-line textarea. Recurring **Edit series** form too.
  - Show it to students on `/student` and to teachers in the assignment list, with line breaks kept.
    Plain text only, rendered escaped (no HTML).
  - en/de/bo strings.
- **Open questions:**
  - Plain text, or basic formatting (bold, lists, clickable links)?
  - Max length?
  - For a weekly series: one description for every week, or editable per week's instance?
  - Required or optional? Should a one-off be editable after creation (today only series can be
    edited)?
  - Several links: split out as #27. File attachments (e.g. an audio file for a song)?

## 27. Only one reference link per homework
- **Seen (user, 2026-09-25, teacher walkthrough step 5):** "it has option to add only one
  reference. it should be able to take more"
- **What exists:** a single `reference_link text` column on `homework_assignments`
  (0004_homework.sql:42), one text input on the create form and the Edit series form, and one
  "Open reference" link shown to students.
- **Change needed (for planning):**
  - Storage: either a `reference_links text[]` / jsonb column, or a child table
    `homework_links (assignment_id, url, label, position)`. Migrate the existing `reference_link`
    values into it.
  - Form: an "Add link" button that adds another row, and remove per row. Same on Edit series.
  - Display: list every link for teachers and on `/student`.
- **Open questions:**
  - Maximum number of links?
  - Each link with a label ("Song recording", "Lyrics sheet"), or just the URL?
  - Still no URL validation (current rule: teachers are trusted), or at least require http(s)?
  - Plan together with #26 (description): one form/migration change for both.

---

## Log

<!-- New issues get appended below as they're reported. -->

- 2026-09-25: teacher walkthrough #23–#27 planned (`~/.claude/plans/bright-greeting-forest.md`) and
  built in three commits. Decisions: #23 account page with display name + in-app password change
  (current password required, no email change, no forced change on first login), also for admins;
  #24 teacher dashboard (tiles + class cards) at `/teacher`, menu item renamed Dashboard;
  #25 whole-class homework allowed on an empty class, and students approved later get the class's
  open (not archived, not past due) whole-class homework via trigger
  `profiles_assign_open_homework`; #26/#27 plain-text description (max 2000) and up to 10 links
  with optional labels, one-off homework editable too. Migration
  `0013_homework_details_and_late_joiners.sql` must be pushed before the homework pages work on
  hosted. It was not run locally (Docker was off).

- 2026-09-23: plan approved (`~/.claude/plans/lets-plan-it-now-snappy-steele.md`). iX 5.2 classic
  migrated app-wide; every error and confirmation is an iX toast; one-time credentials stay in a
  persistent `ix-message-bar`. Primary colour kept at #2563eb (user request). Requires Node
  >= 22.19 (`.nvmrc` = 22.23.2). Migrations 0007–0011 pushed to the hosted DB the same day.
