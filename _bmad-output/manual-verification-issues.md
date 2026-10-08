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
| 28 | Side menu | "My Account" menu item has no icon | fixed, to verify |
| 29 | Date inputs | Calendar icon in the date field is white (invisible) on the create homework page | fixed, to verify |
| 30 | Homework create | Creating one assignment shows several success toasts | fixed (create page redirects, #33), to verify |
| 31 | Homework create | Create button keeps spinning after the assignment is created | fixed with #30, to verify |
| 32 | Class page `/teacher/classes/[id]` | Summary cards: number of students, number of homework, and the class's reference / syllabus | fixed (needs 0014 pushed), to verify |
| 33 | Homework page | List all homework with pagination; create homework on its own page and return to the list after creating | fixed, to verify |
| 34 | Side menu | Selected "My Account" item turns into a white bar; its icon and text are invisible | fixed, to verify |
| 35 | Class page `/teacher/classes/[id]` | Opening a class shows "404 Class not found" | fixed (errors now 500; still needs 0014 pushed), to verify |
| 36 | Side menu | Menu should be expanded (icons + labels) by default for every role | fixed, to verify |
| 37 | Class page `/teacher/classes/[id]` | Cards differ in size; Syllabus should be a same-size card that opens its own page | fixed (needs 0015 pushed), to verify |
| 38 | Class page `/teacher/classes/[id]` | Remove the "Homework" button at the top right (the Homework card already links there) | fixed, to verify |
| 39 | Side menu (teacher) | Add a "My classes" section to the menu | wontfix (not required, user 2026-09-25) |
| 40 | Whole app | Changing page flickers instead of a smooth transition | fixed, verified by user 2026-09-25 |
| 41 | `/requests` (student approval) | Username and PIN shown after approving a student can't be copied easily; needs a copy action | fixed, to verify |
| 42 | `/student` + data model | Student page shows only one class; a student can be enrolled in several classes | fixed (0016 pushed), to verify |
| 43 | `/student` homework | All homework details are shown inline on one page; with many homework it needs a list + a homework detail page | fixed (0016 pushed), to verify |
| 44 | Student side | Students have no "My profile" page | fixed, to verify |
| 45 | `/student` | The student's class isn't shown on their page | fixed (0016 pushed), to verify |
| 46 | Side menu (student) | Student menu should be: Dashboard (summary), My classes, My homework, Team leaderboard | fixed (0017 pushed), working per user |
| 51 | Class schedule | A class that meets every other week can't be scheduled; it has to be created as separate classes | fixed (0026 pushed 2026-09-27), to verify |
| 52 | Admin area (`/admin`) | Parent information isn't visible anywhere in the admin area: no list of parents, and no parent shown for a student. Likely cause: the admin pages (`/admin`, classes, teachers, teams) were never extended for Epic 7; parent approval exists only on `/requests`. Decided (2026-09-28): a new admin Parents list page (name, email, status, linked children). | fixed, to verify |
| 53 | Student class page (`/student/classes/[classId]`) | Show the class's join code with a copy button, so a student can share it (e.g. with a sibling or friend who wants to join). The code already exists (`classes` join code, `validate_class_code`, 0002) and teachers see it on `/teacher` and `teacher/classes/[id]`; the student page never shows it. Open: can students read the code under RLS, and should sharing be allowed for every class? | fixed, to verify |
| 54 | Admin classes (`/admin/classes`, `/admin/classes/[id]`) | Same as #53 for the admin: show the class code with a copy button. The list already shows the code as plain `<code>` text (`admin/classes/+page.svelte:138`) with no copy; the class detail page doesn't show it at all. Plan with #53 as one shared copy-code component. | fixed, to verify |
| 55 | `/requests` student approval | Approving a student asks only for a team, yet the student ends up assigned to class(es). Likely cause: the approve action sets only status + team (`requests/+page.server.ts` approve); the enrollment comes from registration — the class code the student joined with enrolls them (0016 class_enrollments), and the #25 trigger then gives them the class's open homework. Confirmed (2026-09-28): one class, the one whose code they registered with — expected. Decided: show "Joined: <class>" read-only in the approve dialog; enrollment unchanged. | fixed, to verify |
| 56 | `/parent` child cards | Make the whole child card clickable to open that child's page, instead of only the small "Details" link (`parent/+page.svelte`, `parent_card_sessions_link`). Pending children ("Waiting for approval") stay non-clickable. Keep it one accessible link (not a clickable div) with visible focus. | fixed, to verify |
| 57 | Parent leave (`/parent/children/[id]`, Sessions tab) | Parents can answer Coming / On leave per session, but can't record a pre-approved plan (e.g. a known absence period). Today leave is per session only (7-4); On leave set ≥ the notice period ahead is auto-classed Planned. SPEC open question "date-range leave" (SPEC.md:122) was never decided. Decided (2026-09-28): (a) date-range leave — the parent enters a from/to period and every session of the child in it is marked On leave in one go (each still classified Planned/Short-notice by the DB). Decided (2026-09-29): the range covers sessions that exist when saved (UI says how many); from today up to 26 weeks; undo = same form with "Coming"; all classes or one picked class; preview before saving; sessions already On leave left untouched. Planned as B11 (migration 0030). Built 2026-09-29: "Plan a leave period" card on the Sessions tab with a preview dialog (`preview_leave_range` / `set_leave_range`, 0030). | fixed, to verify |
| 58 | Parent calendar | Parents have no calendar view of each child's classes and schedule. Likely cause: the parent nav (`+layout.svelte` ~:108) has only Dashboard, no Calendar item; `/calendar` itself reads `class_sessions_effective`, which parents can already see for their children's classes (0025), but it has no per-child view or leave answers for a parent. Decided (2026-09-28): the shared `/calendar` — add Calendar to the parent nav; show all linked children's class sessions, with a child picker or colour per child. Decided (2026-09-28): yes, show each child's current leave answer on their sessions. | fixed, to verify |
| 59 | Parent homework view | Like #58: a shared Homework page for parents (own nav item) listing all linked children's homework in one place, with a child picker or colour per child — homework is the key focus and easier to follow across children than per-child tabs. Today homework is only on each child's Homework tab (`/parent/children/[id]`). Open for planning: default filter (Open + Overdue first?), sort by due date across children, link each item to the child's page? | fixed, verified by user |
| 60 | Nav "Requests" count | Show the pending-requests count as a pill/badge instead of text in the label. Today the menu item is `nav_requests_with_count` (e.g. "Requests (3)", `+layout.svelte:63-66`). Open for planning: also on the `/requests` page header counter and the admin/teacher dashboard tile? Hide the pill at 0. | fixed, to verify |
| 61 | Navigation (whole app) | Use the Siemens iX breadcrumb (`ix-breadcrumb`, guide: https://ix.siemens.io/docs/components/breadcrumb/guide#components-breadcrumb-guide) for navigation on nested pages, e.g. `/parent` › child › tab, `/admin/classes` › class › students, `/teacher/classes` › class, homework detail. Decided 2026-09-29: all 12 nested pages get a breadcrumb that replaces their back buttons (spec-61-b10). | fixed, to verify |
| 62 | App toolbar | Don't show the user's role in the toolbar. Where it's rendered wasn't found by a quick search of `+layout.svelte` (no role label key there); locate the toolbar/header component during planning. Keep role switching for dual-role logins wherever it lives. | fixed, to verify |
| 63 | Student sign-up / login flow | Use the Siemens iX workflow steps (`ix-workflow-steps` / `ix-workflow-step`, https://ix.siemens.io/docs/components/workflow/code#components-workflow-code) to show the student flow as steps, e.g. class code → details (parent email, consent) → account created / waiting for approval. Decided (2026-09-28): the `/join` registration flow only (sign-in stays a single form). Open for planning: the exact steps. | fixed, to verify (2026-09-29, B9: /join shows iX workflow steps Class code → Your name → Parent consent → Waiting for approval, vertical so they fit the card; finished steps are clickable to go back; /join/pending shows the same steps with Waiting for approval current) |
| 64 | My account (app header) | Move "My account" to the iX application-header avatar (`ix-avatar` in `ix-application-header`, https://ix.siemens.io/docs/components/application-header/guide#avatar): avatar with the user's initials/name opening a menu with My account and Sign out. Today both are bottom items of the side menu (`+layout.svelte` ~:176-187). Plan with #62 (no role in the toolbar). Decided (2026-09-28): avatar menu = My account, role switcher (dual-role logins), Sign out; language stays where it is. | fixed, to verify |
| 65 | Alert messages (whole app) | Use the iX message modal (https://ix.siemens.io/docs/components/message-modal/guide#components-message-modal-guide) for alert messages. Current state: destructive confirmations already use it (`confirmAction` → `ix.showMessage.warning`, `src/lib/ix.ts:59`); errors and success confirmations are iX toasts (2026-09-23 decision); load errors are inline `role="alert"` lines; one-time credentials use `ix-message-bar`. Decided (2026-09-28): keep as is — confirmations stay iX message modals, errors/success stay toasts, load errors stay inline. Check during planning that every confirmation goes through `confirmAction`. | wontfix (already done) |
| 66 | Forms (whole app) | Verified 2026-09-28: forms do NOT use the iX form fields (https://ix.siemens.io/docs/components/forms-field/guide). 60 native `<input>`/`<select>`/`<textarea>` fields across 23 files; the only iX field in use is `ix-checkbox` (5 uses). No `ix-input`, `ix-select`, `ix-textarea`, `ix-date-input`, `ix-radio`, `ix-number-input` anywhere. Affected: all auth pages (login, register, join, forgot/reset password), account, admin classes/teams/teachers, requests (team select), calendar (day/session/schedule), teacher class page (session select, skill level + notes), homework new/edit, and shared components (ScheduleFields, LinkRows, SyllabusForm/List, EnrollmentPanel). Open for planning: migrate all at once or by area; keep native form posts working (iX fields must submit with `name` in SvelteKit forms / progressive enhancement); validation display via iX field states. | part 1 fixed, to verify (2026-09-28, B7: shared components ScheduleFields, LinkRows, SyllabusForm/List, EnrollmentPanel now iX fields; /calendar class schedules are collapsible rows with a one-line summary, the form shows when a row is expanded); part 1b fixed, to verify (2026-09-28, B7b: display names, /join class code, registration name and guardian email are iX fields; email/password fields stay native for password managers); part 2a fixed, to verify (2026-09-28, B8a: calendar session / extra-session / add-class-days dialogs, admin classes/teams/teachers create forms and the /requests team select are iX fields; dialog errors show the field's invalid state; an approve without a team is blocked in the browser); part 2b fixed, to verify (2026-09-29, B8b: teacher class page session picker, skill level + notes and homework new/edit are iX fields; skill status is a list of collapsible student rows with a one-line summary per skill area, the forms and history show when a row is expanded; homework mode and target are iX radio groups). #66 complete: all parts fixed, to verify |
| 67 | Student joins another class | An approved student can't join a second class themselves; the class code only works at sign-up, and only a teacher (`teacher/classes/[id]`) or the admin (`/admin/classes/[id]/students`) can enroll them. Decided (2026-09-28): the student enters a class code on their dashboard; this creates a join request that the class's teacher approves (admin as backup) before the student is enrolled (`enroll_student`, 0016). Relates to #53 (sharing the code). Decided (2026-09-29): a "Class join requests" section on /requests (counted in the nav pill); the student sees Pending/Rejected on the dashboard (no Withdraw yet) and may request again after a rejection; a teacher who is the student's parent can't decide (admin does); max 3 pending requests; unknown code and already-enrolled give the same message. Planned as B12a (migration 0031) + B12b. | fixed, to verify (2026-09-29: B12a 011cea8 — database + student dashboard card, migration 0031 not pushed; B12b cf7b842 — /requests "Class join requests" section and nav count) |
| 68 | Role switcher (dual-role logins) | A teacher or admin who is also a parent has no in-app way to reach the parent view (they'd type `/parent`). Decided (2026-09-28): a role dropdown listing every role the login holds (e.g. Teacher, Parent), not a single link that flips between two views. Split out of B2 (#64). Decided (2026-09-29): roles in the avatar menu with a check on the active one; side menu shows only the active role; remembered in a cookie checked against the held roles (never grants access); /parent and /teacher, /admin URLs set the role; Parent listed only once approved. Planned as B13 (switcher, no migration) + B14 ("Request parent access" from My account, migration 0032), since nothing creates a dual-role login yet. | open |
| 69 | Header avatar (B2, #64) | The avatar is there but only visible on hover, and its colour is wrong: the initials (e.g. "PL") are dark on the dark navy header. Likely cause: the header uses the Sherab navy frame colours (`--sherab-frame-*` in `src/app.css`, #12), but `ix-avatar` keeps iX's default avatar colours, which assume a light header. Fix: set the avatar's colour variables for the header (frame-text initials on a contrasting background). Regression from commit cd5718f. Follow-up: the avatar menu's text (name, My Account, Sign out) was white on the light dropdown — it inherited the header's white text; header dropdown items and the avatar now use the normal text colour. | fixed, to verify |
| 70 | Parent calendar child picker (B4, #58) | The selected child pill's text is invisible (blue on blue), and unselected pills show blue text. Cause: iX's global `a[href]:not(.disabled):not(:disabled):visited { color: primary }` out-ranks the picker's scoped colour once a pill's link has been visited. The same rule would turn visited whole-card links (`.tile-link`, e.g. `/parent` child cards) blue. Fixed with higher-specificity link-state rules for `.child-pick` (white text on the selected pill) and `.tile-link`. Regression from 8aaa175. | fixed, to verify |
| 71 | Dev server / Supabase session refresh | 2026-09-29: the dev server (`npm run dev:hosted`, hosted DB) crashed with `Error: Cannot use cookies.set(...) after the response has been generated`, from `setAll` in `src/lib/supabase/server.ts`. Supabase refreshed an expired session token (`_callRefreshToken` → `_notifyAllSubscribers` → `applyServerStorage`) after SvelteKit had already sent the response. `cookies.set` threw, the promise rejection was never handled, and Node exited with code 1. Likely cause: a request whose load or hook doesn't await the auth call that triggers the refresh (or a refresh racing a streamed or early response). Seen once, after the server had been idle overnight, so the token had expired. Open for planning: find the request that triggers the late refresh; guard `setAll` (try/catch, or skip once the response is sent) so a late refresh can't bring down the server; check whether Cloudflare Workers in production is affected the same way (a request-scoped isolate would drop the error, not exit). | open |
| 72 | Homework create: content field | Reported (user, 2026-10-01, with a screenshot of `/teacher/classes/[id]/homework/new`): "Currently in create homework, description is not required. We need content form where teacher can type the content of the home work. Description can be replaced." Today (#26, migration 0013): the form has one optional plain-text "Description (optional)" `ix-textarea` (`homework/new/+page.svelte`, same field on the edit form in `homework/[assignmentId]/+page.svelte`), stored in `homework_assignments.description` and shown to the student by `TextWithLinks` on `/student/homework/[instanceId]` and as a `<p>` on the teacher's homework page. Wanted: a "Content" field where the teacher writes the homework itself, replacing Description. Also seen in the screenshot (not reported): the textarea is only about a fifth of the form's width while Title and Skill area are full width. Open for planning: is Content required (the report reads that way) or still optional; does it apply to series (recurring) homework as well as one-off; reuse the `description` column or add a new one and migrate existing descriptions into it; whether the parent homework view should show the content too. Goes together with #73 and #74. Decided (user, 2026-10-01): Content is required, on create and on edit, for one-off and weekly homework; a new `content` column holds it and existing descriptions are copied into it (`description` stays, unused, until a cleanup migration); parents keep seeing title and links only. | built 2026-10-01, to verify (branch `feat/72-74-homework-content`; migration 0034 pushed to hosted 2026-10-01; spec `implementation-artifacts/spec-72-74-homework-content.md`) |
| 73 | Homework content: no length limit, rich text | Reported (user, 2026-10-01): "The content part should not have text limit and shouls support text editing tools. like bold, italic, numbering or bullet points etc." Today: the limit is 2000 characters, set in three places: `max-length="2000"` on the `ix-textarea` (create and edit forms), `MAX_DESCRIPTION_LENGTH` checked by `parseDescription()` in `src/lib/server/homework-details.ts`, and the check constraint `homework_assignments_description_length` in `0013_homework_details_and_late_joiners.sql`. The text is plain: no formatting is stored or rendered, and `package.json` has no rich-text editor or HTML sanitiser. Wanted: no limit, and a toolbar with at least bold, italic, numbered list and bullet list ("etc." leaves the full set open). Open for planning: which editor (iX has no rich-text component); the stored format (HTML, Markdown or editor JSON) and sanitising it on save and on display, since students and parents see what a teacher typed; which further tools (headings, underline, links, undo); whether "no limit" means removing the constraint or keeping a high technical cap to protect the database; how existing plain-text descriptions are carried over; keeping the form working as a normal SvelteKit form post; needs a migration. Decided (user, 2026-10-01): toolbar = bold, italic, underline, two heading sizes, bullet list, numbered list, links (http, https, mailto only). Editor: Tiptap, MIT packages only (no Tiptap Cloud or paid extensions). The content is stored as the editor's document in JSON and drawn element by element, never as HTML. No limit a teacher can see; a safety cap of 1 MB per homework remains in the server check, with a database backstop. | built 2026-10-01, to verify (with #72) |
| 74 | Homework content: language option and font | Reported (user, 2026-10-01): "We need language option which decide the content of the home work and based on that correct font should be used to display the content." Today: homework has no language. The Tibetan face (`--font-tibetan`, Noto Serif Tibetan, with line-height 1.6) is applied only by `[lang='bo']` in `src/app.css`, and `lang` is set once on `<html>` from the interface language (`src/app.html`). So homework written in Tibetan gets the Tibetan font only for a viewer whose interface is set to Tibetan; under English or German it falls to iX's fonts, which have no Tibetan glyphs, and the browser picks a fallback. Wanted: the teacher chooses the content's language when creating the homework, and the content is shown in that language's font for every viewer, whatever their interface language. Likely shape (for planning): a language column on `homework_assignments`, and a `lang` attribute on the content wherever it is shown (student, teacher and parent views) and in the editor while typing, so the existing `[lang='bo']` rule applies. Open for planning: which languages to offer (the interface has en, de, bo); the default (teacher's interface language, or a per-class setting); whether the language also covers the title; mixed-language content (e.g. Tibetan with an English explanation); language for existing homework; needs a migration. Decided (user, 2026-10-01): languages Tibetan, English, German; default the teacher's interface language; the language sets the font of the content and of the title wherever homework is listed (teacher, student, parent). Existing homework: marked Tibetan when its title or description contains Tibetan script, otherwise English. Known limits: the title in the breadcrumb and inside the title input keeps the interface font (both are inside iX components). | built 2026-10-01, to verify (with #72) |
| 75 | Syllabus: rich text, no limit, language | Reported (user, 2026-10-01, after #72–#74 were built): "i also need same in add sylabus section". Today (#32, #37, `0015_class_syllabi.sql`): a syllabus is plain text in `class_syllabi.content` (max 5000 characters, set in the `ix-textarea`, `MAX_SYLLABUS_LENGTH` and the check constraint) plus up to 10 links, edited in `SyllabusForm.svelte` on the teacher and admin syllabus pages and shown by `TextWithLinks` there and on the student's class page. It has no language, so a Tibetan syllabus gets the Tibetan font only under a Tibetan interface. Wanted: the same editor, no visible limit and language choice as homework. Kept as today (not asked): the syllabus text stays optional (a syllabus may be links only), one syllabus per class per school year. Built with the #72–#74 parts (`RichTextEditor`, `RichText`, `ContentLanguageSelect`, `src/lib/rich-text.ts`): migration `0035_syllabus_content.sql` adds `content_doc` (jsonb) and `content_language` and copies the old text across; the old `content` column stays, unused, until a cleanup migration. The syllabus list's one-line preview and the student's class page use the new content. | built 2026-10-01, to verify (same branch as #72; migration 0035 pushed to hosted 2026-10-01) |
| 76 | Class and team names in all three languages | Reported (user, 2026-10-03): "Currently class and team name is only in English. So while creating class and team, I need option to add name in all 3 supported languages.And show respective name based on the language selection." Today: `classes.name` and `teams.name` are single columns (0001, 0002), entered once on `/admin/classes` and `/admin/teams`, and shown as typed under every interface language; there is no way to rename either. Decided (user, 2026-10-03): English and Tibetan are required, German is optional; a language with no name shows the English one (this also covers existing classes and teams); an Edit action on both admin pages, so existing ones can get their names. Built: migration `0036_localized_names.sql` adds `name_bo` and `name_de` to both tables (nullable; a blank value is refused), a unique index per language as for the English name, the policy `teams_update_admin`, and the two new names on everything that returns a class or team name (`validate_class_code`, `team_leaderboard`, `list_enrollable_students`, `class_sessions_effective`, `child_attendance`, `sick_leave_queue`, `preview_leave_range`, `set_leave_range`, `list_class_join_requests`, `my_class_join_requests`); existing columns are unchanged, so the deployed code keeps working after the push. `request_class_join` is left as it is (it returns the English name as text); the student's "request sent" message reads the names through `validate_class_code`. The server picks the name for the request's language (`src/lib/localized-name.ts`) in every load and mapper, so pages keep receiving one name. `LocalizedNameFields.svelte` holds the three inputs on the create forms and in the new "Edit names" row (`?/rename`) of both admin pages; the admin lists show the name of the interface language with the other languages under it. Known limits: lists that the database orders by name (leaderboard ties, attendance history, the leave-period preview) are ordered by the English name; lists the app orders are ordered by the shown name. The Tibetan wording of the new labels is still English in `messages/bo.json`. | built 2026-10-03, to verify (committed on `main`; migration 0036 is on hosted) |
| 77 | Tibetan font: Atisha | Reported (user, 2026-10-03): "I want to use /Users/tenzinsamten/Downloads/Atisha.ttf font for tibetan." Today: Tibetan text (`[lang='bo']` in `src/app.css`) uses Noto Serif Tibetan, loaded from Google Fonts. Built: the file is in the repo as `src/lib/assets/fonts/Atisha.ttf` (603 KB) and declared with `@font-face` in `src/app.css`; `--font-tibetan` is `'Atisha', serif`; the Google Fonts import is removed, so the app no longer loads anything from Google. The face is limited to the Tibetan block (U+0F00–0FFF), so Latin text and digits inside Tibetan text keep the fallback serif, as before. Atisha has one weight; bold is drawn by the browser. Open: the font's own notice says "Copyright (c) 2014 by Lobsang monlam. All rights reserved." and names no licence; confirm with Monlam IT (monlamit.org) that it may be served from a website and kept in the repository. | built 2026-10-03, to verify (committed on `main`) |
| 78 | Atisha font not used on most Tibetan text | Reported (user, 2026-10-03, running the app after #77): "it seems tibetan font that was provided is not used". Not yet reproduced in a browser; cause read from the CSS. The font file and its `@font-face` are fine (the build emits `Atisha.*.ttf`). The problem is where the family is applied: `src/app.css` sets `font-family: var(--font-tibetan)` on `[lang='bo']` and on `h1`–`h3` inside it. (a) In a Tibetan interface `[lang='bo']` matches only `<html>`, and iX's stylesheet sets `body { font-family: Siemens Sans, Siemens Sans, Arial, Helvetica, sans-serif }` (`siemens-ix.css`), so everything below `<body>` inherits iX's stack, not Atisha; only `h1`–`h3` and elements that carry `lang='bo'` themselves (homework and syllabus content, the Tibetan name field) get it. (b) iX components set `Siemens Sans, …` inside their shadow DOM (124 declarations), so menu items, buttons, dropdown items and field labels never inherit a page font. (c) Tibetan text shown in an English or German interface without its own `lang` (e.g. Tibetan class and team names from #76) has no rule at all. In all three cases the browser falls back to the operating system's Tibetan font. Noto Serif Tibetan had the same gap before #77; the e2e test only checks a heading and `lang='bo'` content, so it passes. Likely fix (for planning): because the Atisha face is limited to U+0F00–0FFF, declare it a second time under the family name `Siemens Sans` (iX ships no `@font-face` for that name), which puts Atisha behind every iX stack, shadow DOM included, for Tibetan characters only; or override `--theme-font-family` and the `body` rule, which does not reach the shadow DOM. Related: the `line-height: 1.6` in the same rule is overridden at `body` the same way. Decided (user, 2026-10-03): "when the language is bo, then Atisha font should be used. Please fix it. And all all tibetan text, the text size should be 1.5 bigger then english and german language". Built: the second `@font-face` under `Siemens Sans`, `size-adjust: 150%` on both faces, line height 2.2 on `[lang='bo']` and on `body` under the Tibetan interface; the homework e2e test also checks both faces are loaded at 150%. Reported after the first build (user, 2026-10-03, with a screenshot of the login button): "text is getting cut, Usually we need line height to 1.2 to 1.5 for tibetan text". Cause: iX's button clips its label to one 1.43em line. Fixed: under the Tibetan interface `ix-button` is 2.5rem high with a 2.5rem line (`src/app.css`), and the header language picker gets a 2rem line through the new `dropdownButtonLabelRoom` action (`src/lib/ix.ts`, used in `src/routes/+layout.svelte`). The 2.2 line height is 1.47 times the Tibetan size. Checked in a browser on the Tibetan login page, `/bo/admin/classes`, `/bo/admin/teams`, `/bo/calendar` and `/admin/classes`. | built 2026-10-03, to verify (committed on `main`, not pushed) |
| 79 | Class and team names (and page text) go back to English after a language switch | Reported (user, 2026-10-03): "when i switch the language to Tibetan, we are not showing the tibetan name. So basically based on the langauge selection, the class and team name should show the selected language". Reproduced on the dev server. The name picking from #76 (`src/lib/localized-name.ts`) is correct; the language itself is lost. Paraglide runs with `strategy: ['url', 'cookie', 'baseLocale']` (`vite.config.ts`), and an address without a prefix always matches the English pattern, so the cookie is never read: `/login` sent with `PARAGLIDE_LOCALE=bo` comes back `lang="en"`. The language picker loads `/bo/<page>`, so that one page is right, but every in-app link is built with `resolve()` and has no prefix; from the next click on, the server resolves English for the data request and returns English names, and newly drawn page text is English too (the menu stays Tibetan only because it is not redrawn). In a browser: `/bo/login`, click the home link, the heading is "Welcome to Sherab". Fix: the cookie is the language (`strategy: ['cookie', 'baseLocale']`); addresses carry no language prefix; a GET to `/bo/…`, `/de/…` or `/en/…` sets the cookie and redirects to the address without the prefix (`handleLocalePrefix` in `src/hooks.server.ts`), so old links keep working; the picker calls `setLocale`. Not part of this: a class or team with no Tibetan name shows the English one by design (#76); on hosted, existing ones need their names entered through "Edit names". | built 2026-10-03, to verify (committed on `main`, not pushed) |
| 80 | Numbers, dates and day names are not Tibetan under the Tibetan interface | Reported (user, 2026-10-03): "what about translation of numbers, date and day in tibetan". Checked: dates are formatted with `Intl.DateTimeFormat(getLocale())` (calendar, requests, parent pages); Chrome 154 has no `bo` data (`supportedLocalesOf(['bo'])` is empty), so a Tibetan interface shows "Saturday, 3 October 2026"; Node has the data, so server and browser would differ. Numbers are Western digits everywhere; Chrome ignores `bo-u-nu-tibt`. The weekday labels `calendar_weekday_1`–`7` are still "Mon"…"Sun" in `messages/bo.json`. Eight places call `toLocaleDateString()` / `toLocaleString()` with no locale (admin Classes and Teams created dates, four on Requests, the attendance record time on the teacher's class page), so they follow the browser language, not the picked one; the calendar grid (`@event-calendar/core`) gets `locale: getLocale()` and has the same Chrome gap. Wider: 816 of 845 texts in `messages/bo.json` are still English. Decided (user, 2026-10-03): Tibetan digits (༠–༩); the Gregorian calendar written in Tibetan ("i want to show georgen calendar in tibetan text. not tibetan lunar calendar", replacing an earlier lunar answer). Built: `src/lib/format.ts` (`formatDate`, `formatDay`, `formatInstant`, `isoDay`, `num`) writes Tibetan dates itself and leaves English and German to the browser; no new dependency. Forms: `ཕྱི་ལོ་ ༢༠༢༦ ཟླ་ ༡༠ ཚེས་ ༣`, without a year `ཕྱི་ཟླ་ ༡༠ ཚེས་ ༣`, weekday after the date (`གཟའ་སྤེན་པ`, short `སྤེན་པ`), months by number. Every date helper on the calendar, requests and parent pages now uses it, as do the eight `toLocale…` calls (which now follow the picked language and the school's time zone, shown as e.g. "Oct 3, 2026" under English); dates that English and German show as `YYYY-MM-DD` (homework due dates on the teacher and student pages, the attendance toast) stay so there and are written out under Tibetan. The calendar grid gets Tibetan weekday headings, title and day numbers; `calendar_weekday_1`–`7` are translated. Counts, ranks, percentages, times, durations, school years and page counters go through `num`. Not changed: date and time input fields (iX and browser controls), numbers inside names, class codes and typed content, digits written literally in translation texts, the calendar grid's hidden column labels for screen readers (the library's own, English under Tibetan), and the 816 texts in `messages/bo.json` that are still English. The Tibetan wording needs the user's check. | built 2026-10-03, to verify (committed on `main`, not pushed) |

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

## 28. "My Account" menu item has no icon
- **Seen (user, 2026-09-25, retest after #23):** "My account icon is missing."
- **Cause:** the item uses `icon="user"`, but `setupIx()` (`src/lib/ix.ts`) only registers a fixed
  list of icons with `addIcons()`, and `iconUser` isn't on it. An unregistered name renders blank.
- **Fix idea:** add `iconUser` to the `addIcons()` list.

## 29. Date field calendar icon is invisible
- **Seen (user, 2026-09-25, create homework page):** "Due date calendar icon is not visible since it
  was white."
- **Cause:** iX's stylesheet sets `:root { color-scheme: light dark }`. On a Mac in dark mode the
  browser draws native controls (the date picker's calendar icon) for dark mode, so the icon is
  white. The app itself is forced light (#15), so the field background stays white.
- **Scope:** every native `type="date"` input: homework due date and start date, and the roster's
  attendance date. Possibly other native controls too (select arrows, scrollbars).
- **Fix idea:** `:root { color-scheme: light; }` in `src/app.css` while the app is light-only.
  Revisit with dark mode in phase 2 (#13).

## 30. Several toasts for one created assignment
- **Seen (user, 2026-09-25):** "When create assignment was in progress and done, it shows multiple
  toast when we created only one assignment."
- **Cause:** a bug from the #27 fix. The toast `$effect` in `homework/+page.svelte` does
  `createCount++` (to reset the link rows). That both reads and writes `createCount`, so the effect
  depends on the value it changes and re-runs itself. Each re-run shows the toast again, until
  Svelte stops the loop.
- **Fix idea:** reset the link rows outside the effect (in the create form's enhance callback,
  after `update()`), or wrap the increment in `untrack()`.

## 31. Create button keeps spinning after creation
- **Seen (user, 2026-09-25):** "After completed, create button is still showing spinner."
- **Likely cause:** the same loop as #30. When Svelte aborts the runaway effect it throws
  (`effect_update_depth_exceeded`), which breaks the page update, so the button's `loading`
  state (from `createPending()`) isn't re-rendered as cleared. To confirm after fixing #30. If it
  still spins, check whether `ix-button`'s `loading` attribute is removed when the prop becomes
  `undefined`.

## 32. Summary cards on the class page
- **Request (user, 2026-09-25):** "In the class details page, I want to see cards with number of
  students, number of homework and card with reference or syllabus for the class"
- **Page:** `/teacher/classes/[id]` (roster). Today its header shows only the class name, code and a
  Homework button, then the attendance form and the skills table.
- **What exists:**
  - Student count: the page already loads the approved students, so this needs no new query.
  - Homework count: not loaded on this page. `homework_assignments` has `class_id`, so a count
    query is cheap.
  - Syllabus: **nothing exists.** `classes` has only `name`, `code`, `created_by`, `created_at`
    (0001_init.sql:45). Needs a migration (e.g. `syllabus text` plus links, like homework's
    `description` / `reference_links` from 0013), an edit form, and RLS. Today only admins can
    update `classes` (`classes_update_admin`, 0001_init.sql:189).
- **Open questions:**
  - Who writes the syllabus: the class's teacher, the admin, or both? Teachers editing would need
    a new column-limited update policy on `classes`.
  - What is it: text (plain, line breaks kept) plus labelled links, like homework? Or a file upload
    (PDF)?
  - Homework count: all assignments, only open ones (not archived / not past due), or split
    (e.g. "3 open · 12 total")? Do weekly series count once or per week?
  - Do the cards link somewhere (homework count → Homework page)?
  - Should students see the syllabus too, e.g. on `/student`?
  - Show the same cards on the teacher dashboard's class cards (#24)?

## 33. Homework list with pagination, create on its own page
- **Request (user, 2026-09-25):** "when clicked on home work, i want to see all the home work with
  pagination and create home work in another page. once assignment is created then show the
  homework again"
- **Today:** `/teacher/classes/[id]/homework` is one long page: the create form on top, then every
  assignment with its instances, student statuses, edit form and series controls. `load` reads
  all assignments, instances and history for the class in one go, with no paging.
- **Change needed (for planning):**
  - `/teacher/classes/[id]/homework`: the list only, with a **Create homework** button and page
    controls (e.g. `?page=2`). Server-side paging with `.range()` on `homework_assignments`
    (ordered newest first), and instances/history loaded only for that page's assignments.
  - New `/teacher/classes/[id]/homework/new`: the create form (moves `createAssignment` there). On
    success, `redirect(303)` back to the list, with the success toast shown there (e.g. a
    `?created=` flag, like `?justSignedUp`).
  - Link rows reset (#30) no longer matters on the new page: each create starts from a fresh page.
- **Open questions:**
  - How many per page (10? 20?), and numbered pages or just Previous / Next?
  - Sort: newest created first (today), or by next due date?
  - Filters: open / archived / all, or one-off vs weekly? Should archived homework be hidden by
    default?
  - Keep each assignment's details (student statuses, mark done / reviewed, edit, pause / end)
    inline in the list, or move them to a detail page per assignment
    (`/homework/[assignmentId]`) with the list showing only a summary row (title, skill,
    due, done x/y)?
  - Edit on its own page too (reusing the create form), or keep it inline?
- **Related:** #30/#31 (toast loop and spinner on create) are fixed by the same rework if create
  moves to its own page, but should still be fixed on their own in case this is planned later.


## 34. Selected "My Account" menu item is unreadable
- **Seen (user, 2026-09-25, screenshot on `/account` as a teacher):** "when my profile is selected.
  text is not visible". The item above Sign out shows as a plain white bar; icon and label are
  both invisible.
- **Cause:** "My Account" sits in `ix-menu`'s `bottom` slot. iX styles bottom-slot items as
  *secondary* nav items (`--theme-nav-item-secondary--*`, e.g.
  `--theme-nav-item-secondary--background--selected`), and the navy frame override (#12,
  `src/app.css`) only sets the *primary* ones. So the selected bottom item gets iX's light
  selected background while its text and icon stay white. Sign out never looks selected, so it
  wasn't noticed before.
- **Fix idea:** add the matching `--theme-nav-item-secondary-*` overrides (colour, icon colour,
  hover / active / selected background = primary blue for selected) next to the primary ones.
  Check hover on Sign out too.


## 35. Class page shows "404 Class not found"
- **Seen (user, 2026-09-25, screenshot):** selecting a class on the teacher dashboard opens
  `/teacher/classes/<id>` with "404 — Class not found."
- **Cause (confirmed):** `supabase migration list --linked` shows 0014 is **not applied** on the
  hosted project (0001–0013 are). Since #32 the class page selects `syllabus, syllabus_links`,
  which don't exist yet, so the query errors. The load treats *any* error on the class query
  as "not found" and throws 404.
- **Fix:** push 0014 (`npx supabase db push`). `/admin/classes` and `/student` read the same
  columns and fail until then too.
- **Underlying gap (open):** a database error shows as a 404, which points at the wrong
  problem. The same `classError || !cls → 404` pattern is on the roster, homework list, create
  and detail pages. Proposal: 404 only when the query succeeds with no row (RLS hides it or
  it doesn't exist); a real error becomes a 500 ("Something went wrong loading this page").
  Also worth a deploy check that the hosted DB has every local migration (see #5).


## 36. Side menu expanded by default
- **Request (user, 2026-09-25):** "I want the dashboard opened by default for all". Clarified:
  the **side menu** should start expanded (icons and labels: Dashboard, Requests, Leaderboard,
  ...) for everyone, not collapsed to icons only.
- **Today:** `<ix-menu>` in `src/routes/+layout.svelte` has no expand settings, so iX starts it
  collapsed on every page load. The user can expand it with the « / » toggle, but that isn't
  remembered.
- **Fix idea:** iX's `start-expanded` attribute on `ix-menu`. iX applies it only at its large
  (`lg`) breakpoint; on smaller screens the menu opens as an overlay and should stay collapsed so
  it doesn't cover the page.
- **Open questions:**
  - Remember the user's choice (collapse / expand) across pages and visits (cookie or
    localStorage), or always start expanded?
  - Phones / tablets: keep collapsed there (recommended), or expanded too?
  - `pinned` (menu stays open next to the content instead of overlaying) on wide screens?


## 37. Class page cards: same size, syllabus on its own page
- **Seen (user, 2026-09-25, screenshot of class "Yaks"):** "keep same card size irrespective of data
  or not. Syllabus is also a card and diff page"
- **Today (#32):**
  - Students and Homework are separate cards with different heights: Homework has an extra
    "1 open · 1 total" line, and the grid uses `align-items: start`, so each card is only as tall
    as its content.
  - Syllabus is a full-width card below them with the text, links and an inline "Edit syllabus"
    form.
- **Wanted:**
  - All cards the same size whether they have data or not.
  - Syllabus is one more card of the same size in that row (e.g. a short status like "No
    syllabus yet" / "3 links"), and clicking it opens a separate syllabus page.
- **Change needed (for planning):**
  - Cards: one equal-height grid (`align-items: stretch`, same min-height), each card with
    label, big number/status, and an optional one-line note, so empty and filled cards match.
  - New route `/teacher/classes/[id]/syllabus`: shows the syllabus text and links, with the edit
    form (`SyllabusForm`, `set_class_syllabus`) on that page. Move the `setSyllabus` action there
    from the class page.
  - Class page: remove the inline syllabus block.
- **Open questions:**
  - What does the Syllabus card show: "Added" / "Not added yet", the first line of the text, or
    the number of links?
  - Syllabus page: view first with an **Edit** button, or the form directly?
  - Should the Students card link somewhere too (e.g. scroll to the roster), so all three cards
    are clickable?
  - Same card style on the admin side (admin edits the syllabus inline on `/admin/classes`
    today)?


## 38. Remove the Homework button from the class page header
- **Request (user, 2026-09-25):** "remove the Homework button on the top right"
- **Today:** the class page header (`src/routes/teacher/classes/[id]/+page.svelte`) has an
  `ix-button` "Homework" (icon `tasks-open`) linking to `/teacher/classes/[id]/homework`. Since
  #32 the Homework card links to the same page, so the button is a duplicate.
- **Change:** delete the button. The Homework card stays the way in; plan together with #37,
  which reworks the cards (make sure the Homework card still clearly looks clickable).
- **Check:** the homework list's "Back to roster" button still returns to the class page.


## 39. "My classes" in the side menu
- **Request (user, 2026-09-25):** "In the menu, add my class section"
- **Today:** the teacher menu is Dashboard, Requests, Leaderboard (+ My Account, Sign out at the
  bottom). #24 turned the old "My classes" item into "Dashboard" (`/teacher`), whose class cards
  are now the only way to reach a class. Inside a class (roster, homework, syllabus) no menu item
  is highlighted, because Dashboard uses `exact: true`.
- **Options (for planning):**
  - **A. One item per class under a "My classes" group.** iX has `ix-menu-category` (a collapsible
    group with sub-items): "My classes" → "Yaks", "Snow Lions", ... Each opens that class page,
    and the current class is highlighted on its roster / homework / syllabus pages. Needs the
    teacher's classes in the root layout load (one small `class_teachers` query, like the
    pending-requests count).
  - **B. A single "My classes" item** opening a new `/teacher/classes` list page (the class cards
    moved off the dashboard, or shown in both places).
- **Open questions:**
  - A or B? (A is quicker to use for a teacher with 1–3 classes.)
  - Should the dashboard keep its class cards?
  - Admin too (e.g. a "Classes" group listing every class), or teachers only?
- **Closed (user, 2026-09-25):** "leave 39, not required. we can mark as done". Classes stay
  reachable from the dashboard's class cards.


## 40. Page changes flicker
- **Seen (user, 2026-09-25):** "currently when i change the page, i have a flicker, its not smooth
  transition"
- **Not yet reproduced by me** (needs a signed-in browser session). Likely causes, to confirm:
  1. **Full page reloads instead of client-side navigation.** If a click reloads the whole
     document, every page starts with iX not loaded: `setupIx()` only runs in `onMount`
     (`src/routes/+layout.svelte`), so `ix-*` elements render unstyled until their definitions
     load, then snap into place (header, menu, cards, buttons). SvelteKit does follow links inside
     iX's shadow DOM (`ix-menu-item`, `ix-button href`), so normal links *should* be client-side;
     check the Network tab for a new document request per click.
  2. **Content swaps with no loading state.** SvelteKit keeps the old page until the next page's
     `load` finishes. Several pages now run several sequential Supabase queries against the
     hosted DB, so the swap comes late and all at once.
  3. **iX re-rendering on navigation**, e.g. cards (`ix-card`) or pills mounting fresh on each
     page.
- **Fix ideas (for planning):**
  - Hide custom elements until iX has defined them (`:not(:defined) { visibility: hidden }`) and
    start loading iX earlier, so a reload never shows the unstyled state.
  - A slim top progress bar while `navigating` is set (SvelteKit `$app/state`), so a slow load
    visibly starts at once.
  - Cross-fade between pages with the View Transitions API (`onNavigate` +
    `document.startViewTransition`), falling back to no animation where unsupported.
  - Fewer sequential queries on the heaviest pages (class page, homework list).
- **To confirm first:** which pages (all, or only some), and whether it's the whole screen or
  only the content area.
- **Cause (confirmed 2026-09-25 in the browser, signed out):** iX renders `<a target="_self">` inside
  `ix-button href` and `ix-menu-item href` (its default `target`). SvelteKit treats any link with a
  `target` as external (`get_link_info`: `external = !!target || ...`), so every such click was a
  full page load: the app re-booted and iX re-drew from scratch. Plain `<a>` links were already
  client-side. Checked with a `window` marker: lost after clicking "Sign in" before the fix, kept
  after.
- **Fix (user said "fix it", 2026-09-25):** `routeIxLinks()` in `src/lib/ix.ts`, registered in the
  root layout's `onMount`. A capture-phase click handler takes same-origin `_self` links rendered
  inside `ix-*` shadow DOM and navigates with `goto()`; modified clicks (new tab), downloads and
  external links are left alone. Verified signed out: Sign in, Join a class, Back all stay in the
  same document. Still to verify signed in (side menu items, dashboard / class cards' buttons).
- **Not done (only if a flicker remains):** progress bar while loading, view-transition cross-fade.

---

## 41. Copy the new student's username and PIN
- **Asked (user, 2026-09-25):** "when username and pin is created. we should be able to copy it"
- **Where it shows today:** approving a pending student on `/requests`
  (`src/routes/requests/+page.svelte`) shows the one-time username and PIN as one sentence inside
  a persistent `ix-message-bar` (`m.requests_outcome_approved`). The only way to copy them is to
  select the text by hand. The same kind of one-time credential appears for new teachers on
  `/admin/teachers`, and in the partial-approval error (`m.requests_error_approve_partial`).
- **To decide when planning:** copy username and PIN separately, both together (e.g.
  "Username: … / PIN: …"), or both; whether the teacher credential on `/admin/teachers` gets the
  same treatment; feedback after copying (toast or icon change).
- **Fix (2026-09-25):** `CredentialFields` / `CopyField` (`src/lib/components/`) with
  `copyText()` (`src/lib/clipboard.ts`): each value has a copy icon, plus "Copy both"
  ("Username: …" / "PIN: …" lines), toast "Copied"; when the clipboard is unavailable the value
  is selected and an error toast says to copy manually. Used on `/requests` (approval, and the
  partial-approval case, which now shows the details in a warning bar instead of an error toast)
  and `/admin/teachers` (email + temporary password).

---

## 42. A student can only belong to one class
- **Asked (user, 2026-09-25):** "curently student page shows only one class but student can be
  enrolled in multiple classes"
- **Cause: the data model, not just the page.** `profiles.class_id` (added in
  `0002_student_registration.sql`) is a single column, so a student belongs to exactly one class.
  `/student` (`src/routes/student/+page.server.ts`) reads that one `class_id` for the syllabus
  card. Homework already works per student (assigned rows in `homework_status_history`), so
  homework from several classes would list fine; it's class membership that is single.
- **What depends on the single `class_id` today:** registration and approval (`/requests`,
  sign-up with a class, `check_registration_available`), class roster and student count on
  `/teacher/classes/[id]`, whole-class homework and the late-joiner trigger
  (`profiles_assign_open_homework`, 0013), syllabus access (`class_syllabi_select`, 0015), the
  class delete guard (0011), streaks (`student_streaks.class_id`, 0007), `/admin/classes`, and
  the RLS helpers that check "student of this class".
- **Likely direction (for planning):** a `class_enrollments` (student, class) join table with the
  existing `class_id` data moved into it, then the places above switched over.
- **To decide when planning:**
  - How a student joins a second class: teacher or admin adds an existing student to a class,
    the student requests to join another class, or both.
  - `/student` layout: homework grouped by class, a class switcher, or one combined list with a
    class label per item; one syllabus card per class.
  - Streaks: one per student (across classes) or one per class.
  - Team (`profiles.team_id`): stays one per student, or per class.
  - Leaving a class: what happens to that class's open homework.
- **Fix (2026-09-25):** `0016_class_enrollments.sql` adds `class_enrollments` (backfilled from
  approved students' `class_id`), filled on approval by `profiles_enroll_on_approval`. The
  late-joiner trigger now fires per enrollment (`class_enrollments_assign_open_homework`). RLS
  checks that used `profiles.class_id` now use `is_enrolled_in_class()` /
  `is_teacher_of_student()`, as do the recurring-homework generator, the class delete guard, and
  the teacher's view of streaks. The streak's holiday weeks look at all of the student's classes.
  `enroll_student`, `unenroll_student` (refuses the last class) and `list_enrollable_students`
  are the only writers. App: `src/lib/server/enrollments.ts` (roster, counts, actions) and
  `EnrollmentPanel.svelte` on the teacher class page and `/admin/classes/[id]/students` (linked
  from the Students column). Teacher homework views drop a student who left the class unless they
  already did the homework. The migration was checked with a Postgres parser only; it was not
  run (Docker off), and no RLS integration tests were added for it yet. The `/student` side is
  #43.

---

## 43. Student homework: list plus a detail page
- **Asked (user, 2026-09-25):** "there could be multiple homework and currently homework detail
  page is there."
- **Today:** students have no homework detail page. `/student` (`src/routes/student/+page.svelte`)
  shows every homework item in the look-ahead window (default 14 days, `homework_lookahead_days`)
  as a full card: title, skill area, due date, status, the whole description and every reference
  link, plus the Done action. With several homework items (more so across several classes, #42),
  the page becomes a long scroll. Teachers already have a list + detail layout
  (`/teacher/classes/[id]/homework` and `/homework/[assignmentId]`, #33).
- **My reading (to confirm when planning):** show homework on `/student` as a compact list
  (title, class, due date, status) where each row opens a student homework detail page with the
  description, links and the Done action. The user's sentence was ambiguous ("is there"), so check
  that this is what's wanted.
- **To decide when planning:**
  - Route, e.g. `/student/homework/[instanceId]` (one due date of a series) vs per assignment.
  - Whether Done can still be marked straight from the list.
  - Pagination / filters (Open, Done, Overdue), and whether past homework outside the look-ahead
    window becomes visible.
  - How this fits with the several-classes layout from #42.
- **Fix (2026-09-25):** `/student` keeps the streak and badges tiles, then To do / Done buttons
  (`?filter=done`, `?page=`) and one card per class (#42) with a Syllabus link
  (`/student/classes/[classId]/syllabus`) and compact rows: title, recurring and overdue pills,
  skill · due date, and a "Mark done" button (To do) or the status pill (Done). To do shows every
  class, even with nothing due; it keeps the look-ahead window and hides homework from a class the
  student has left. Done is 10 per page, latest finished first, and includes classes the student
  has left, under "Former class". Each row opens `/student/homework/[instanceId]` with the
  description, links, status and Mark done. Shared code: `src/lib/server/student-homework.ts`
  (+ spec). Not checked in the browser yet: the hosted DB needs 0016 first.

---

## 44. Students have no profile page
- **Asked (user, 2026-09-25):** "for student, there is no my profile page for students."
- **Today:** `/account` (#23) is for admins and teachers only. `src/routes/account/+page.server.ts`
  returns 403 for other roles, with the comment "Students sign in with a username + PIN that a
  teacher or admin issues, so they have no page here". The student menu has only My Homework and
  Leaderboard.
- **To decide when planning:**
  - What a student profile shows: name, username, their classes (#42), team, streak and badges
    (these are on `/student` today)?
  - What a student can change: display name? their own PIN (the admin/teacher password page
    requires the current password and has its own rules)?
  - Reuse `/account` for students, or a separate `/student/profile`.
- **Decided and fixed (2026-09-25):** students use `/account` ("My Account" in the menu now
  shows for every signed-in user). A student sees: display name (editable), username (read-only,
  with "Forgot your PIN? Ask your teacher to reset it."), My classes (with Syllabus links), and
  the streak and badges tiles, which moved there from My Homework (`StudentProgressTiles.svelte`).
  No password form for students: `changePassword` stays staff-only. Spec:
  `src/routes/account/page.server.spec.ts`.

---

## 45. The student's class isn't shown on their page
- **Seen (user, 2026-09-25):** "I do not see the class that student joined in their page"
- **Cause (checked 2026-09-25):** the hosted database doesn't have `class_enrollments` yet
  (PostgREST answers `PGRST205 Could not find the table 'public.class_enrollments'`), so
  migration 0016 (#42) hasn't been pushed. `/student` (#43) reads the student's classes from
  that table, so it finds no class and shows "You're not in a class yet."
- **Also wrong:** when loading the classes fails, `/student` says "You're not in a class yet"
  instead of making clear the page failed to load. The error toast shows, but the empty state
  is misleading.
- **Next:** push `0016_class_enrollments.sql`, then check again. Separately, the empty state
  should not claim "not in a class" when the class query failed.
- **Fix (2026-09-25):** on a failed load, `/student` (and the classes card on `/account`) say
  "Couldn't load your homework. Please try again." instead.

---

## 46. Student menu: Dashboard, My classes, My homework, Team leaderboard
- **Asked (user, 2026-09-25):** "i want following menu items for student: 1. dashboard, which has
  summary of all 2. My classes 3. My home work 4. Team leaderboard"
- **Today:** the student menu (`src/routes/+layout.svelte`, the `role === 'student'` branch of
  `navItems`) has My Homework (`/student`, also the landing page via `roleHome()` in
  `src/lib/role-home.ts`) and Leaderboard (`/leaderboard`), plus My Account at the bottom (#44).
  The student's classes are listed on `/account` (#44); each class's syllabus is at
  `/student/classes/[classId]/syllabus`.
- **Likely shape (for planning):** Dashboard becomes the student's landing page with summary
  tiles, like the teacher dashboard (#24); My classes gets its own page (list of classes, each
  opening a class page with syllabus and that class's homework); My homework stays the current
  `/student` list; Team leaderboard is the existing `/leaderboard` renamed in the menu.
- **To decide when planning:**
  - What the dashboard summarises: homework due this week / overdue / done, streak and badges
    (currently on My Account since #44), team rank, classes count, next due homework?
  - Routes: e.g. `/student` = dashboard, `/student/homework` = My homework,
    `/student/classes` = My classes (moving the current list off `/student`).
  - What a class page shows: syllabus, that class's homework, teacher name, classmates?
  - Whether "My classes" on `/account` stays or moves entirely to the new page; whether streak and
    badges move from My Account to the dashboard.
- **Decided and fixed (2026-09-25):** menu Dashboard (`/student`, landing page) · My classes
  (`/student/classes`) · My homework (`/student/homework`, the #43 list moved unchanged) · Team
  leaderboard (`/leaderboard`). Dashboard: To do / Overdue / Done this week tiles, My team with
  rank ("#2 of 5"), streak and badges, the next 3 homework due, and a card per class. My classes:
  a card per class with its teachers and To do count. Class page (`/student/classes/[classId]`,
  replaces `/syllabus`): teachers, this year's syllabus, that class's homework (To do / Done,
  Mark done) and classmates. My Account for students is back to name + username. Teachers and
  classmates come from `class_people()` (`0017_class_people.sql`, display names only, for people
  in the class) because students can't read other profiles. Shared UI: `StudentHomeworkRows`,
  `Pager`. Migration 0017 checked with a Postgres parser only (Docker off).

## 47. Calendar should be a Google Calendar–style month grid
- **Asked (user, 2026-09-25):** "i wanted the calender which is similar to google calender view,
  you can use library . no need to build everything. and you can see the classes on it." With a
  screenshot of Google Calendar's Month view: Today button, prev/next arrows, month title,
  Sun–Sat grid of 5–6 weeks (days from neighbouring months shown), today as a filled circle, and
  events as coloured chips inside each day cell.
- **Today:** story 6-1 (commit `e6135bb`) shows `/calendar` as a date-grouped list, one card per
  class day, with edit forms inline. The month grid was deferred at spec time
  (`deferred-work.md`, "Month-grid calendar UI").
- **Likely shape (for planning):** keep 6-1's `?month=` load, actions, RLS and data; replace the
  list with a month-grid library. Each session becomes a chip in its day cell (class name + start
  time, cancelled shown struck through or greyed). Clicking a chip opens that session's edit
  controls (admin/teacher) or details (student). Clicking a day opens "add class day" or
  cancel/restore for the admin.
- **To decide when planning:**
  - Library: `@event-calendar/core` (Svelte-native, FullCalendar-like, MIT), FullCalendar
    (`@fullcalendar/core` + `daygrid`, framework-agnostic, MIT), or Schedule-X (has a Svelte
    adapter).
  - Views: month only, or also week/day like Google Calendar?
  - Chip colour: per class, or by status (scheduled / cancelled / time not set)?
  - Where editing happens: dialog/drawer on click, or keep the current forms below the grid?
  - Phone width: a month grid is cramped; switch to a list/agenda view below a breakpoint?
  - Week start: Sunday (as in the screenshot) or Monday (usual in Germany)?
- **Decided (user, 2026-09-25):** library `@event-calendar/core` · month grid on wide screens,
  agenda list at phone width · editing in a dialog (click a class chip for time / duration /
  cancel-restore; admin clicks a day to add or cancel a class day) · week starts Monday.
- **Built:** spec-47, commit `acefca9` (2026-09-26), not pushed.

## 48. Class schedule should be configurable per class (weekdays, time, duration, end date)
- **Status:** planned — story 6-4 (`planning-artifacts/sprint-change-proposal-2026-09-26.md`, approved 2026-09-26).
- **Asked (user, 2026-09-26):** "currently we are assuming that class can be scheduled only on
  sunday. But when you create or schedule a class. the start time,duration and till what date
  and which days in the week should be configurable."
- **Today (story 6-1, `0018_calendar.sql`):** class days are school-wide dates. The admin adds
  them as a start date "repeated weekly until" an end date, so they fall on one weekday (in
  practice Sunday). Every class gets a session on every class day, at its class default start
  time and duration (set by the class's teachers). Per-session overrides and cancellations exist.
- **Likely shape (for planning):** a per-class schedule, set when a class is created or edited:
  weekdays (one or more), start time, duration, start date and end date ("till what date").
  Sessions are generated from that schedule, on the school-wide class days only (see Clarified).
  Touches the data model (new migration), the class create/edit forms, session generation, the
  calendar (#47), and the attendance/streak intent in `specs/spec-class-tracker/calendar.md`.
- **Clarified (user, 2026-09-26):** "Add class days is the days on which classes will happen and
  then each class can take a slot from it." So school-wide class days **stay** as the pool of days
  the school is open (set by the admin). Each class then takes its slots from that pool: which of
  those days it runs on (weekdays, until an end date) and at what start time and duration.
  Today every class automatically gets a session on every class day; that becomes opt-in per class.
- **Admin side (user, 2026-09-26):** classes usually happen on Sunday, so Sunday should be the
  default, but the admin must be able to add an extra class day on another weekday (e.g. Friday
  or Saturday) when needed. Today this already works but isn't obvious: "Add class days" takes any
  date, and leaving "Repeat weekly until" empty adds just that one day; clicking a day in the
  month grid prefills it. Missing: no explicit weekday choice or "Sunday" default, the weekly
  repeat simply follows the start date's weekday, and one add can't cover two weekdays.
- **To decide when planning:**
  - Can one class have different times on different weekdays (Sun 10:00, Wed 18:00)?
  - Who sets the schedule: admin only, or also the class's teachers?
  - Start date: from class creation, or chosen? What happens to already-generated sessions when
    the schedule is edited (future ones regenerated, past ones kept)?
  - Existing data: convert today's class days + class defaults into schedules?
  - Streaks: still weekly ("any session in the week qualifies") with several sessions per week?

## 49. Saved class default time doesn't show on the calendar
- **Status:** explained — no class days in that month; resolved by 6-4's per-class schedules.
- **Reported (user, 2026-09-26):** "I saved class default time but i do not see the default class
  timing on the calender". Seen on the dev server on :5173, which runs `vite dev --mode
  production`, i.e. against the **hosted** Supabase.
- **How it works today:** a class default (start time + duration) does not create anything on the
  calendar by itself. It only sets the time of that class's sessions, and sessions exist only on
  class days the admin has added ("Add class days", start date weekly until an end date). The
  view `class_sessions_effective` (`0018_calendar.sql:231`) reads the default live, so existing
  sessions pick a new default up immediately, unless the session has its own time override.
- **Likely cause (not yet confirmed on hosted):** no class days exist in the month being viewed,
  so there are no sessions to show the time on. Less likely: that class's sessions carry a
  start-time override, which wins over the default. Local DB check: 0 class days in 2026–2027.
- **To check:** as admin on `/calendar`, is any day in that month a class day (chip or "Class
  day" marker)? If yes, open that class's chip: does the dialog show an override or the default?
- **Relation to #48:** the expectation behind this report ("saving the time schedules the class")
  is exactly what #48's per-class schedule would provide.

## 50. Anyone can sign up as admin (security)
- **Found (architecture review, 2026-09-26):** not reported from the app. Found by two independent
  spine reviewers (`planning-artifacts/architecture/architecture-tib-class-2026-09-13/reviews/review-rubric-2026-09-26.md` C1,
  `review-adversarial-2026-09-26.md` C-1) and confirmed in the code.
- **Cause:** `handle_new_user()` (latest in `0006_guardian_email_verification.sql:74`) sets
  `profiles.role` from `new.raw_user_meta_data ->> 'role'`, and the client controls that metadata
  on a public `supabase.auth.signUp` call. `supabase/config.toml` has `enable_signup = true`. A
  crafted sign-up with `role: 'admin'` gets an admin profile. A sign-up with no role defaults to
  `teacher`, although teachers are meant to be created by the admin only.
- **Likely fix (for planning):** take privileged roles only from `raw_app_meta_data` (only the
  service role can write it). Create teacher/admin/student accounts only through the Admin API.
  Accept at most `parent` from client metadata, or no role at all. Architecture rule: spine AD-4
  (2026-09-26).
- **To check:** does the hosted project also have sign-up enabled? Do any existing profiles have
  an unexpected `admin`/`teacher` role? Hosted detection query:
  `select id, email, role from profiles where role in ('admin','teacher') order by created_at;`
  plus `select email, raw_app_meta_data from auth.users` for unexpected accounts.
- **If an unexpected admin/teacher turns up:** delete that auth user (Studio → Authentication, or
  the Admin API `deleteUser`). That removes its profile and ends its sessions (refresh tokens are
  revoked). Access tokens it already holds stay valid until they expire (default 1 hour).
- **Known limit (deferred):** a public `signUp` still sends a confirmation email even when the
  sign-up is refused. This closes when `/join` moves to the Admin API (spine AD-11).
- **Status:** built (2026-09-26, uncommitted, not yet pushed to hosted): migration
  `0020_signup_role_from_app_metadata.sql` takes `admin`/`teacher` only from `raw_app_meta_data`,
  accepts only `student` from client metadata and refuses every other sign-up. The public
  `/signup` page is removed, `/admin/teachers` sets the role through `app_metadata`, and the README
  bootstrap now uses the Admin API plus the promote SQL. After pushing 0020, run the hosted checks in
  `implementation-artifacts/spec-50-signup-role.md` (Verification).

## 51. Class schedule can't repeat every other week
- **Status:** built 2026-09-27 (spec `implementation-artifacts/spec-51-schedule-interval.md`, branch `fix/51-schedule-interval`). Migration `0026_schedule_interval.sql` pushed to hosted 2026-09-27 (confirmed with `supabase migration list --linked`).
- **Reported (user, 2026-09-27):** "for class creation, we have a issue that we have class which
  happens every alternative week. In that case, currently we have to create it separately."
- **Today (story 6-4, `0019_class_schedules.sql`):** a class's schedule is weekdays + start date +
  optional end date. `class_schedule_matches()` matches a class day on its ISO weekday alone, so a
  schedule is always weekly. It has no interval, so a fortnightly class can't be expressed.
  Workarounds today are separate classes, or deleting and cancelling every other session by hand.
- **Likely shape (for planning):** add `classes.schedule_interval_weeks` (default 1). A day
  matches when its weekday matches and it falls in a week that is a multiple of N weeks from the
  week of `schedule_starts_on` (the start date anchors the alternation). Pass it through
  `class_schedule_matches()`, the three session triggers, `set_class_schedule()`, form parsing in
  `src/lib/server/calendar.ts` and `ScheduleFields.svelte` ("Every week / Every 2 weeks"). The
  default of 1 leaves existing classes unchanged.
- **Decided (user, 2026-09-27):**
  - Interval choices: every 1, 2, 3 or 4 weeks.
  - The pattern stays fixed on the calendar. A cancelled class day or holiday in an on-week
    loses that session; it does not shift the following weeks.
  - Streaks count only the weeks in which the class is planned. Off weeks neither count nor
    break a streak.
  - Classes already created separately as a workaround stay as they are (no merge).
  - One interval for the whole class: with several weekdays (e.g. Sun + Wed, every 2 weeks),
    all of them happen in the on-weeks and none in the off-weeks. No per-weekday interval.
- **Built:** "Repeats" select (every 1-4 weeks) on `/admin/classes` create and `/calendar` class schedules; streak rule unchanged (off weeks already skipped), covered by a new test.

---

## Log

<!-- New issues get appended below as they're reported. -->
- 2026-09-25: migration 0017 pushed to hosted by the user; student menu (#46) reported working.

- 2026-09-25: migration 0016 pushed to hosted by the user. Before that, pages using
  `class_enrollments` returned 500; after the push the user reports the app working.

- 2026-09-25: #41–#43 planned (`~/.claude/plans/woolly-sprouting-candle.md`). Decisions: #41 copy
  username and PIN separately plus "Copy both" (same for a teacher's temporary password), and
  the partial-approve credentials move from a toast to the persistent bar. #42 new
  `class_enrollments` table (0016) is the source of truth for class membership;
  `profiles.class_id` stays as "class registered into"; a teacher (class page) or admin
  (`/admin/classes/[id]/students`) adds an existing student to another class, and can't remove
  a student's last class; streak and team stay per student; removing a student hides their open
  homework from that class and keeps done/reviewed history. #43 `/student` grouped by class,
  To do / Done filters with pagination, rows open `/student/homework/[instanceId]`, Done on
  rows and on the detail page, syllabus on its own page per class.

- 2026-09-25: #37/#38 planned and built. Decisions: one syllabus per class per **school year**
  (Sept–Aug, stored by starting year, 2025 = 2025/26) in the new `class_syllabi` table (0015);
  the 0014 single syllabus moves into the current year. Syllabus card shows how many syllabi a
  class has and whether this year's exists; it opens a list page, each syllabus a view page
  with Edit / Delete. Students see the current year's (or the newest). Admin gets the same pages
  from a Syllabi column in `/admin/classes` (inline editor removed). Three equal clickable class
  cards; Students jumps to the roster. Header Homework button removed. Migration
  `0015_class_syllabi.sql` must be pushed.

- 2026-09-25: #34–#36 fixed. #34 secondary nav-item colours for bottom-slot menu items.
  #35 `rowOr404()` (`src/lib/server/class-access.ts`): no row → 404, query error → logged 500, on
  the four teacher class routes. The actual 404 came from 0014 not being pushed (user step).
  #36 decided: menu starts expanded on wide screens (iX `lg`, 1280px+), a collapse there is
  remembered in the `sherab-menu` cookie, smaller screens stay collapsed.

- 2026-09-25: #28–#33 planned (`~/.claude/plans/bright-greeting-forest.md`) and built. Decisions:
  #32 syllabus = plain text (max 5000) + up to 10 labelled links, edited by the class's teacher
  (class page) and the admin (`/admin/classes`) through `set_class_syllabus()`, shown to the
  class's students on `/student`; class page cards: Students, Homework (open / total), Syllabus.
  #33 homework list 10 per page, newest first, Open / Archived / All (default Open; open = any
  non-archived week, or an active series), summary rows opening `/homework/[assignmentId]`,
  create at `/homework/new` redirecting back with one toast (which also removes the #30 loop).
  Migration `0014_class_syllabus.sql` must be pushed before the class page, admin classes and
  `/student` load on hosted.

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

- 2026-09-28: #52–#67 logged and planned (`~/.claude/plans/manual-verification-52-67.md`) in five batches:
  1 quick UI (#56, #60, #62+#64, #53+#54, #55); 2 parent views (#58, #59); 3 admin Parents list (#52);
  4 iX components (#66 forms, #63 join workflow steps, #61 breadcrumbs); 5 migrations (#57 date-range
  leave, #67 student join request). #65 kept as is.

- 2026-10-01: #72–#74 logged (homework create: a Content field replacing Description, no length
  limit with rich-text tools, and a content language that selects the font). Not planned yet; no
  code changed.

- 2026-10-01: #72–#74 planned (`~/.claude/plans/i-want-you-to-logical-scott.md`) and built on branch
  `feat/72-74-homework-content`. New: migration `0034_homework_content.sql`
  (`content` jsonb, `content_language`), `src/lib/rich-text.ts`, `RichText.svelte`,
  `RichTextEditor.svelte` (Tiptap, MIT), `ContentLanguageSelect.svelte`. Verified locally after a
  database reset: 865 unit tests, `npm run check` and `npm run build` exit 0; 72 browser tests
  pass. `npm run lint` fails on formatting in files outside `src` (tooling and docs), none from
  this change. Migration 0034 is not pushed to hosted: push and deploy close together, since
  homework created on the old deployed app after the push would have no content. Run the browser
  tests on a freshly reset database: the unit tests leave class days around today that break
  the attendance test in `e2e/teacher.e2e.ts`. The new strings in `messages/bo.json` are in
  English, like the rest of its homework section.

- 2026-10-01: #75 logged and built on the same branch: the syllabus gets the
  homework editor, no visible limit and a language. Migration `0035_syllabus_content.sql`, not
  pushed to hosted; push 0034 and 0035 together, then deploy. Verified locally after a reset:
  868 unit tests, `npm run check` and `npm run build` exit 0; Prettier and ESLint pass on `src`,
  `e2e`, `messages` and the migrations. Browser tests: 58 passed in the full run, where one
  calendar test (admin cancels a class day, `e2e/calendar.e2e.ts:318`) timed out on a dialog
  click and stopped the 13 after it; the calendar file re-run alone passed all 22. That page
  is not part of this change, so it looks flaky rather than broken, but it is not explained.

- 2026-10-01: #72–#75 committed (`a07d10f` code, `018f4da` docs) and the branch pushed to the
  remote by the user. Migrations 0034 and 0035 pushed to hosted by the user (confirmed with
  `supabase migration list --linked`: hosted is at 0035). The branch is not merged into `main`
  yet. Until the new code is deployed, homework created on the deployed app has no content and
  a syllabus edited there keeps its changes only in the old `content` column.

- 2026-10-03: #76 logged, planned (`~/.claude/plans/currently-class-and-team-declarative-canyon.md`)
  and built on `main`, not committed: classes and teams have a name per language (English and
  Tibetan required, German optional), an "Edit names" action on `/admin/classes` and
  `/admin/teams`, and every page shows the name of the interface language, else the English one.
  Migration `0036_localized_names.sql` is applied locally only; push it to hosted before the
  deploy (the deployed code keeps working after the push, the new code needs it). Verified
  locally after a reset: 898 unit tests, `npm run check` and `npm run build` exit 0; Prettier
  and ESLint pass on `src`, `e2e` and `messages`. Browser tests: 73 passed (forms and calendar
  on a freshly reset database, then the other seven files). Run on a database the unit tests
  have used the same day, `e2e/calendar.e2e.ts:130` ("today is highlighted") fails: the unit
  tests leave a class day on today, and the hidden "Today" text is only drawn for a day that
  is not a class day. That is not part of this change.

- 2026-10-03: #77 logged and built on `main`, not committed: Tibetan text uses the Atisha font,
  served by the app; Noto Serif Tibetan and the Google Fonts request are gone. `npm run build`
  exits 0 and bundles the font; the forms and teacher browser tests (19, with the font
  assertions changed to Atisha) pass. The font's licence for web use is not confirmed.

- 2026-10-03: user asked to deploy #76 and #77. `supabase migration list --linked` shows hosted
  already at 0036 (pushed outside the build session). Re-verified after a reset: 898 unit
  tests, `npm run check` and `npm run build` exit 0, Prettier and ESLint pass. Committed on
  `main`; production deploys from pushes to `main` (Cloudflare Pages).

- 2026-10-03: #78 logged, not fixed: the user ran the app and Atisha is not used. Cause from the CSS:
  iX's `body` and shadow-DOM `font-family` rules override the `[lang='bo']` rule, so only
  headings and elements with their own `lang='bo'` get Atisha. Waiting for the user to plan or fix.

- 2026-10-03: #79 logged, planned (`~/.claude/plans/we-have-added-class-lexical-sunrise.md`): after a
  language switch, names and page text go back to English on the next click, because the language
  is only read from the address prefix and in-app links have none.

- 2026-10-03: #79 built on `main`, not committed: the language is read from the cookie, not the
  address (`vite.config.ts`, `src/hooks.server.ts`, the picker in `src/routes/+layout.svelte`,
  `src/routes/role/+server.ts`, `localeFromPath` in `src/lib/server/roles.ts`). The #76 team-names
  browser test now also checks that a `/bo/…` link lands on the plain address, that the Tibetan
  name holds across a menu click, and that the picker switches it to German. Verified after a
  reset: 899 unit tests, `npm run check` and `npm run build` exit 0, Prettier and ESLint pass,
  73 browser tests pass. No migration.

- 2026-10-03: #80 logged, not fixed: numbers, dates and day names stay English/Western under the
  Tibetan interface (Chrome has no Tibetan `Intl` data). User decided Tibetan digits and Tibetan
  lunar dates; scope of the lunar calendar is open.

- 2026-10-03: #80 built on `main`, not committed: user changed the calendar decision to Gregorian
  dates in Tibetan words and digits. New `src/lib/format.ts` with unit tests; date and number call
  sites moved to it; the #76 browser test also checks a Tibetan date, Tibetan digits and the
  calendar headings. Verified after a reset: unit tests, `npm run check`, `npm run build`,
  Prettier and ESLint pass; 73 browser tests pass.

- 2026-10-03: user asked to commit. #78, #79 and #80 committed on `main` in one code commit and one
  docs commit; not pushed. No migration.

- 2026-10-03: #81 logged, not fixed: the user ran the app locally (`npm run dev:hosted`) and saw no
  PWA install option. Two causes. (1) In dev, `SvelteKitPWA` in `vite.config.ts` has no
  `devOptions.enabled`, so `/manifest.webmanifest`, `/sw.js` and `/registerSW.js` all return 404.
  (2) In the build the files are generated (`.svelte-kit/cloudflare/manifest.webmanifest`, `sw.js`,
  `registerSW.js`), but no page links them: `src/app.html` and `src/routes/+layout.svelte` have no
  `<link rel="manifest">` and nothing loads `registerSW.js` or `virtual:pwa-register`, so a
  browser never offers install on the deployed site either. Not checked on the deployed site
  itself. Open: whether the service worker should also run in dev. Waiting for the user to plan
  or fix.

- 2026-10-03: #81 built on `main`, not committed: the root layout links the manifest and registers
  the service worker (`src/routes/+layout.svelte`, types in `src/app.d.ts`); `vite.config.ts`
  turns the PWA on in dev and sets `navigateFallback: null`, because the plugin's default served
  every navigation from a precached `/` that this server-rendered app doesn't have; `/dev-dist`
  is ignored. Verified after a reset: 906 unit tests, `npm run check` and `npm run build` exit 0,
  Prettier and ESLint pass on the changed files. On `npm run dev:hosted` the page carries the
  manifest link and `/manifest.webmanifest` and the dev service worker return 200. Browser tests
  not run; the install prompt itself not checked in a browser. No migration.

- 2026-10-03: user asked to commit. #81 committed on `main` in one code commit and one docs
  commit; not pushed. No migration.

- 2026-10-05: #82 logged, not fixed: while registering parents and teachers the user found no way
  to see the password being typed. The register form's "password" and "confirm password" fields
  (`src/routes/(auth)/register/+page.svelte`) are plain `type="password"` inputs with no show/hide
  control. The same is true of every other password field: login
  (`src/routes/(auth)/login/+page.svelte`), reset password
  (`src/routes/(auth)/reset-password/+page.svelte`) and the three fields on the account page
  (`src/routes/account/+page.svelte`). Open: whether the toggle goes on the register form only or
  on all four screens. Waiting for the user to finish listing issues, then plan.

- 2026-10-05: #83 logged, not fixed: the user expected one email to be both teacher and parent,
  but registering got "email already registered". Which form and which order the user tried is
  not confirmed; the wording matches the parent form `/register`, whose `emailHasLogin` check
  (`src/routes/(auth)/register/+page.server.ts`) refuses any email that already has a login with
  `register_error_exists` ("An account with this email already exists. Sign in instead."), by
  design (Story 7-1). One login with both roles is supported (#68), but only by two other routes:
  (a) a teacher or admin signs in and uses "Request parent access" on My account
  (`requestParentAccess` in `src/routes/account/+page.server.ts`), then the admin approves;
  (b) the admin adds a teacher whose email belongs to an approved parent, which promotes that
  login (`src/routes/admin/teachers/+page.server.ts`); with the parent still pending it stops
  with `teachers_error_parent_pending`. So the gap is that `/register` gives no hint of route
  (a): the message says "sign in instead" and nothing more. Open for planning: a clearer message
  pointing to My account, or letting `/register` itself raise the parent request for an existing
  teacher (needs proof of the password, since the form is public); and whether the message may
  reveal that the email is a teacher (today it deliberately never names the role).

- 2026-10-05: #83 confirmed by the user: it was the parent form `/register` with a teacher's
  email. The user will retry later through My account ("Request parent access"); not yet tried.

- 2026-10-05: #84 logged, not done: production email is not set up. Parent registration sends a
  confirmation mail (`supabase.auth.signUp` in `src/routes/(auth)/register/+page.server.ts`) and
  forgot-password sends one too, so the hosted Supabase project needs custom SMTP; Supabase's
  built-in sender is rate-limited and, as far as known, only delivers to members of the Supabase
  organisation. The user asked whether this means a monthly fee and has no domain. Suggested, not
  yet decided by the user: buy a domain (`.org` or `.com` at Cloudflare Registrar, about
  $10-12 a year; `.de` from a German registrar), verify it with an email provider's free tier
  (Resend suggested) and enter that provider's SMTP details in Supabase. Prices and free-tier
  limits were given from memory, not checked against the providers' pages. Mostly setup outside
  the repo; open for planning: which domain and provider, whether the app also moves to that
  domain (then Supabase's site URL and redirect URLs change), and the sender name and address.

- 2026-10-05: #85 logged, not fixed: the user finds Tibetan text too big and asked to "reduce it
  by 2px for all". Today Tibetan has no size of its own: `size-adjust: 150%` on both Atisha
  `@font-face` rules in `src/app.css` (#78) draws it at 1.5x the surrounding text, so 21px in
  normal body text (iX `--theme-font-size-default` 0.875rem = 14px), 18px in small text (12px),
  24px in large text (16px) and 33px at xl (22px). `size-adjust` is a ratio, so an exact 2px
  cut everywhere is not possible with it; proposed 136%, which gives 19px in body text (-2px),
  16.3px small (-1.7px), 21.8px large (-2.2px) and 29.9px xl (-3.1px). To revisit with the
  change: the Tibetan line height 2.2 and the 2.5rem `ix-button` height, both sized for 1.5x.
  Waiting for the user to finish listing issues, then plan.

- 2026-10-05: #86 logged, not fixed: under the Tibetan interface the breadcrumb text is cut off
  vertically. Cause read from the code, not reproduced in a browser: `ix-breadcrumb-item` carries
  the same sizing as `ix-button` on its own host (`height: 2rem`, `line-height: 1.429em`, and a
  `.content` label with `overflow: hidden` in iX's `breadcrumb-item.css`), so Tibetan drawn at
  1.5x is clipped the same way buttons were in #78. The #78 fix in `src/app.css`
  (`html[lang='bo'] ix-button { height: 2.5rem; line-height: 2.5rem }`) names only `ix-button`,
  and `src/lib/components/PageBreadcrumb.svelte` sets no height. Likely fix: the same height and
  line height for `ix-breadcrumb-item` under `html[lang='bo']`. Two things to settle in planning:
  a Tibetan class or homework title in the breadcrumb under an English or German interface is
  probably cut the same way (the rule would then need to cover every interface language), and
  the values depend on the size chosen in #85. Other iX components with a fixed one-line height
  (tabs, pills, menu items, inputs) not checked.

- 2026-10-05: #87 logged, not built (improvement): the app has no guidance for its users. The
  user wants a how-to for each kind of user (teachers, parents, children) and some FAQs. Today
  there is no help, guide or FAQ route under `src/routes`, no help entry in the menu and no such
  texts in `messages/*.json`. Open for planning: where it lives (a help page in the app, per
  role, reachable from the menu and from the sign-in pages, versus a document outside the app);
  whether admins get a guide too; languages (the interface has en, de, bo, and the children's
  guide most needs Tibetan and simple wording); whether texts sit in `messages/*.json` or in
  per-language content files; screenshots or text only; and the list of topics and FAQs, which
  the user has not given yet (candidates from this round: signing up as a parent, the
  confirmation mail, one login as teacher and parent (#83), installing the app (#81), a
  forgotten password or PIN).

- 2026-10-05: planned with the user. Batch A: #82 (toggle on all four screens), #83 (longer
  static message on `/register`), #85 (136%) and #86 together; the user asked to start it with a
  subagent. Batch B: #87 as a `/help` page. Batch C: #84, setup on the user's side. Decided by the
  user: new message keys are created in all three language files as usual and the user
  translates the Tibetan later; admins get no guide. Still open for #87: the FAQ topics.

- 2026-10-05: #82, #83, #85 and #86 built on `main` by a subagent, not committed. #82: new
  `src/lib/components/PasswordInput.svelte` (native input plus a show/hide button beside it),
  used for all eight password fields on register, login, reset password and My account; students
  get it on `/login`, where the PIN goes in the same field. #83: `register_error_exists` extended
  in en and de, text only. #85: `size-adjust` 136% on both Atisha faces, Tibetan line height
  2.2 to 2, `ix-button` under Tibetan 2.5rem to 2.25rem. #86: every `ix-breadcrumb-item` gets
  height and line height 2.25rem in all interface languages (crumbs carry no `lang`), inside
  iX's 2.5rem breadcrumb. Not done: `messages/bo.json` -- the subagent's edit was refused by the
  permission system, so `password_show`, `password_hide` and the longer `register_error_exists`
  are missing there (Paraglide falls back to English for the two new keys; the register message
  keeps the old short Tibetan text). Verified after a reset: 906 unit tests, `npm run check` and
  `npm run build` exit 0; Prettier and ESLint pass on the changed files (subagent's run). Browser
  tests: `auth-fields` 10/10, `breadcrumbs` 7/7 and the Tibetan homework test with the 136%
  assertion pass; the full run had 40 passed, 3 failed, 31 not run. Of the three, the team-names
  test passed on a re-run; `calendar.e2e.ts:130` ("today is highlighted") and
  `teacher.e2e.ts:246` (attendance, newest session first) failed each time. Neither is in code
  this batch touched, but no baseline run was made, so that they are unrelated is not proven.
  Measured in Chromium by the subagent: breadcrumb labels were cut 4.5-6.3px before and 0px
  after, in the Tibetan interface and for a Tibetan title under English. Found, not fixed: the
  side menu's `ix-menu-item` labels lose up to 2.2px at the bottom of the deepest Tibetan
  letters (shadow DOM, needs the `dropdownButtonLabelRoom` approach); `ix-radio` labels and
  `ix-typography` would overlap if a Tibetan line wraps. Not judged by eye by the user yet.

- 2026-10-05: user approved the `messages/bo.json` edit and asked for the side menu fix; built on
  `main`, not committed. `bo.json`: `password_show` and `password_hide` added with the English
  text, and the new English sentence appended to the Tibetan `register_error_exists`; all three
  wait for the user's translation (the two password texts are only the eye button's
  screen-reader name and tooltip). #86 side menu: new `menuItemLabelRoom` action in
  `src/lib/ix.ts`, used on every `ix-menu-item` in `src/routes/+layout.svelte`, gives the label a
  2.25rem line inside the 3rem item; the #76 team-names browser test now checks the 36px label.
  Verified after a reset: 906 unit tests, `npm run check` and `npm run build` exit 0; Prettier and
  ESLint pass on the changed files; the team-names browser test passes, and a screenshot of the
  expanded menu under the Tibetan interface shows complete, centred labels. Full browser suite
  not re-run; the two failures noted above (`calendar.e2e.ts:130`, `teacher.e2e.ts:246`) are
  still unexplained. Still open: `ix-radio` and `ix-typography` line height for wrapped Tibetan.

- 2026-10-05: #82 changed after the user saw it: the eye button sat beside the field and the user
  wants it inside. `PasswordInput.svelte` now places the button inside the field at its end
  (the input keeps 2.5rem of padding there) and hides Edge's own reveal button. The register
  browser test also checks that the button's box lies inside the field's. `npm run check` and
  `npm run build` exit 0, Prettier and ESLint pass, `auth-fields` 10/10; seen in a screenshot of
  `/register`. Unit tests not re-run for this styling-only change. Not committed.

- 2026-10-05: user checked it and asked to commit. #82, #83, #85 and #86 committed on `main` in
  one code commit and one docs commit; not pushed. The code commit also carries the user's own
  `home_poster_eyebrow` translation in `messages/bo.json`. Verified before the commit, after a
  reset: 906 unit tests, `npm run check` and `npm run build` exit 0. No migration. #84 and #87
  remain open.

- 2026-10-05: #87 built on `main`, not committed (user: "start the batch B"). New public page
  `/help` (`src/routes/help/+page.svelte`, content lists in `src/lib/help.ts` with unit tests):
  three link-based tabs (`?role=parent|teacher|student`), a numbered guide per role (8 parent,
  9 teacher, 8 student steps) and 10 shared FAQs as closed `<details>`. A signed-in visitor
  starts on their own role's guide; an admin or a signed-out visitor on the parents'. Linked
  from every role's side menu ("Help", `question` icon, last item), and from the start page and
  the sign-in page ("Need help?"). No admin guide (user's decision). 79 new `help_*` / `nav_help`
  keys in en and de; `messages/bo.json` holds the English text for all 79 until the user
  translates. Text only, no screenshots. Verified after a reset: 910 unit tests,
  `npm run check` and `npm run build` exit 0; Prettier and ESLint pass on the changed files;
  browser tests `auth-fields` (two new help tests) and `role-switcher` pass, 17/17; seen in
  screenshots as a teacher on desktop and at phone width under the Tibetan interface. Full
  browser suite not run. The guide texts were written from the code and messages and are not
  yet reviewed by the user. No migration.

- 2026-10-05: #88 logged, not fixed (found while writing the help text): a student's PIN cannot
  be reset in the app. `/account` tells a student "Forgot your PIN? Ask your teacher to reset
  it." (`account_pin_note`) and forgot-password says the same, but no teacher or admin page has
  such an action: the only reset is the admin's "Reset password" for teachers
  (`src/routes/admin/teachers/+page.server.ts`). The help text therefore says "Tell your
  teacher. The school gives you a new PIN." Open: a "Reset PIN" action on the class roster (and
  for the admin), showing the new PIN once like the approval does.

- 2026-10-05: #87 extended after the user read it ("information is good", wants screenshots for
  teachers and parents); built on `main`, not committed. 14 guide steps now show a phone-size
  screenshot (parent 1, 4-8; teacher 1-6, 8, 9), in the viewer's language: 42 PNGs under
  `static/help/<en|de|bo>/` (2.6 MB), lazy-loaded and kept out of the PWA precache
  (`globIgnores` in `vite.config.ts`). They are produced by `npm run help:screenshots`
  (`e2e/help-screenshots.e2e.ts`, skipped in a normal browser-test run): it seeds a demo class
  with made-up names on the local database, photographs the real pages and removes the data;
  run it on a freshly reset database and again whenever those pages change. No screenshots for
  the student guide, parent steps 2-3 or teacher step 7. One new key `help_screenshot_alt` in
  all three files; German t6 now says "Lernbereich" as the form does. Verified after a reset:
  911 unit tests (one checks every screenshot file exists), `npm run check` and
  `npm run build` exit 0, ESLint and Prettier pass; `auth-fields` browser tests 12/12; the
  built service worker lists no `help/` file; page seen in a screenshot as a teacher. Full
  browser suite not run.

- 2026-10-05: #87, user asked for the same screenshots for students; built on `main`, not
  committed. Seven student steps now show one (1, 3-8; none for step 2, "Wait for your
  teacher"), from a signed-in demo student: 63 PNGs in all under `static/help/` (3.6 MB). Demo
  students get readable usernames (`tenzin.dolma`). Verified after a reset: 911 unit tests,
  `npm run check` and `npm run build` exit 0, ESLint and Prettier pass, `auth-fields` browser
  tests 12/12; `npm run help:screenshots` passes 4/4. Full browser suite not run.

- 2026-10-05: #87 changed after the user asked for help in iX's "About and legal" overlay in the
  navigation (https://ix.siemens.io/docs/components/about-and-legal/guide); built on `main`, not
  committed. Signed in, the side menu's "Help" link item is replaced by `ix-menu-about` in
  `src/routes/+layout.svelte`: the info button at the foot of the menu, labelled "Help", opens
  an overlay with four tabs (the three guides, the active role's first, then "Common
  questions"). The guide and FAQ markup moved into `HelpGuide.svelte` and `HelpFaq.svelte`,
  shared with the public `/help` page, which stays for signed-out visitors (links on the start
  and sign-in pages). New `menuAboutPanels` action in `src/lib/ix.ts`: iX's tab panels hide
  themselves whenever they are connected and the active one sometimes stayed hidden after
  hydration, leaving the overlay empty; the action keeps the shown panel in step with the
  selected tab. One new key `help_close` in all three files. Seen in screenshots on desktop and
  at phone width; scrolling inside the overlay not checked. The overlay's own menu button
  label is inside iX's shadow DOM, so the #86 label fix does not reach it.
  Verified after a reset: 911 unit tests, `npm run check` and `npm run build` exit 0, ESLint
  and Prettier pass; browser tests `auth-fields`, `role-switcher` and `forms` pass, 25/25 (the
  overlay test also passed three times in a row). Full browser suite not run.

- 2026-10-05: user asked to commit. #87 committed on `main` in one code commit and one docs
  commit; not pushed. No migration. Open: #84 (production email), #88 (student PIN reset), the
  Tibetan texts for the `help_*` keys, `nav_help`, `password_show`, `password_hide` and the
  second sentence of `register_error_exists`, and the two unexplained browser-test failures
  (`calendar.e2e.ts:130`, `teacher.e2e.ts:246`).

- 2026-10-05: #84 prepared by a subagent (research and a guide only; nothing bought, no account
  or dashboard touched), not committed: `docs/production-email.md`, a step-by-step setup with a
  test checklist. Checked on the providers' pages on 2026-10-05: Supabase's built-in sender is
  2 mails an hour and only to the organisation's members; custom SMTP is allowed on the free
  plan (30 mails an hour to start, adjustable); Resend free is 3,000 a month, 100 a day, own
  verified domain required; Cloudflare does not sell `.de`. Recommended: a `.org` at Cloudflare
  Registrar (about US$8.50 first year, US$11.20 renewal, from a third-party price tracker) plus
  Resend, about US$9-11 a year, no monthly fee. Not confirmed: Brevo's free limits, Cloudflare's
  own price list, some dashboard labels. No code change is required for a custom domain. Found:
  with Supabase's default email templates the confirmation and reset links only work in the
  browser that submitted the form (PKCE code exchange), so a parent who registers on a laptop
  and opens the mail on a phone lands on an error; `/auth/confirm` already accepts the
  device-independent `token_hash` form, so the fix is to change the two templates in the
  Supabase dashboard (step 7 of the guide). That path was not exercised with a real mail.
  Waiting for the user's decisions: domain name and ending, whether the app moves to the
  domain, provider, sender name and address, template language.

- 2026-10-05: #84, user bought the domain `sherab.app` (where it was bought not yet said). The
  guide's placeholder `yourschool.org` is replaced by `sherab.app`. Next on the user's side:
  put the app on the domain, verify it at Resend, enter SMTP and URLs in Supabase, change the
  two email templates, then run the guide's test checklist.

- 2026-10-05: #84, user reports: `sherab.app` bought at Cloudflare and the app is on the domain
  (guide step 2 done; not checked by me). Next: Resend domain verification.

- 2026-10-05: #84, user reports the domain is verified at Resend (guide step 3 done). Next: API
  key, SMTP in Supabase, URLs, templates, rate limit, then the test checklist.

- 2026-10-05: #88 built on `main` by a subagent, not committed. "Reset PIN" per student in the
  "Class members" card (`EnrollmentPanel.svelte`) on the teacher's class page and on the admin's
  class students page: confirm dialog, then the username and new PIN shown once with copy
  buttons. Server: `resetStudentPin` in `src/lib/server/student-pin.ts`, called by a `resetPin`
  action on both pages. Allowed: the admin, or a teacher assigned to the class of the page; the
  target must be an approved student enrolled in that class; only then the service-role
  `updateUserById`. A teacher may reset their own child's PIN (the own-child rule covers
  decisions, not credentials; the parent is handed the PIN at approval anyway) -- open for the
  user to confirm. Supabase Auth ends the student's sessions when the password is set (seen
  locally, not on the hosted project). No record of who reset a PIN and no rate limit. Help:
  teacher step 10 added, student step 8 and FAQ 3 now say the teacher gives the new PIN; 8 new
  keys (`pin_reset_*`, `help_teacher_10_*`), English in `messages/bo.json`. Screenshots not
  regenerated (the member list is below what `teacher-4` and `teacher-5` show). No migration.
  Verified after a reset (re-run by me): 924 unit tests (13 new, against the local database),
  `npm run check` and `npm run build` exit 0; after another reset `teacher.e2e.ts` and
  `auth-fields.e2e.ts` pass, 24/24, including the new test that signs the student in with the
  new PIN and not the old one. Prettier and ESLint on the changed files: subagent's run. Seen
  by the subagent in screenshots at desktop and phone width; not seen by me. Full browser suite
  not run.

- 2026-10-05: the `teacher.e2e.ts:246` failure (attendance, newest session first) explained by
  the #88 subagent: not a regression. `npm test` leaves real-date `class_days` behind (2026-08-31
  to 2026-10-12 after one run; from `rls.spec.ts` or `calendar/page.server.spec.ts`, not
  isolated), and the browser test's class, scheduled on a random weekday, picks one up as its
  newest session. It passes on a database reset after `npm test`. So: reset between `npm test`
  and the browser tests. `calendar.e2e.ts:130` not investigated.

- 2026-10-05: user asked to commit #88 and the email guide. #88 committed on `main` as one code
  commit; `docs/production-email.md` and this log as one docs commit; not pushed. No migration.
  #84 itself stays open: the user is entering SMTP, URLs and the two templates in Supabase
  (domain on Cloudflare and Resend verification reported done); the test checklist has not been
  run. Open for #88: whether a teacher may reset their own child's PIN (allowed today).

- 2026-10-05: #84, user reports "it is tested" after setting SMTP, URLs and the templates for
  `sherab.app`. Which checklist items were covered (link opened on a second device, forgot
  password, spam placement) is not yet confirmed; not checked by me.

- 2026-10-05: #89 logged, not fixed: the user found that a parent who has registered and whose
  confirmation email has expired has no way to ask for a new one. What exists: signing in with
  the right email and password while unconfirmed re-sends the link
  (`src/routes/(auth)/login/+page.server.ts`, `email_not_confirmed` -> `auth.resend`, message
  `login_error_unconfirmed_resent`). Nothing leads the parent there: an expired link lands on
  `/login?error=confirm` with "That confirmation link is invalid or has expired. If you already
  confirmed your email, sign in." (`login_error_confirm_link`), which does not say that signing
  in sends a new link; the "Check your email" receipt after registering
  (`src/routes/(auth)/register/+page.svelte`) has no resend; registering again answers "account
  already exists"; a parent who forgot the password has no route at all unless a recovery mail
  also works for an unconfirmed account (not checked). The link lifetime is Supabase's
  `otp_expiry` (3600 s locally, `supabase/config.toml`; the hosted value not checked), and the
  hosted project allows one mail per address per 60 s. Only the help FAQ mentions the sign-in
  route. Proposed for planning: a "Send a new confirmation link" form that takes only the email
  (same generic answer whether or not the address exists), offered on the expired-link page and
  on the register receipt, and a clearer `login_error_confirm_link`.

- 2026-10-05: #89, evidence from the user (phone screenshot of `sherab.app`, link opened from the
  GMX app): the confirmation link landed on "That confirmation link is invalid or has expired",
  and signing in right after answered "Confirm your email first. Open the link we sent you,
  then sign in." That second text is `login_error_unconfirmed`, the branch where
  `auth.resend` returned an error, so the hidden re-send failed too and the parent was left
  with no new mail and no hint. The cause of both failures is not established (candidates: a
  mail sent before the templates were changed, so a PKCE link opened in another browser; an
  older mail whose link a newer one replaced; a really expired link; for the re-send, the
  60-second per-address limit or an SMTP error -- the reason is only in the Cloudflare function
  log, "login: confirmation resend failed"). Also visible: the "link expired" toast stays on
  screen next to the sign-in error (the address keeps `?error=confirm`), and both cover the
  card's heading on a phone. To add to the #89 fix: say what to do when the re-send fails
  ("wait a minute and try again"), and drop the stale toast after a sign-in attempt.

- 2026-10-05: #89, user reports the same failure for the reset-password link on `sherab.app`.
  Tested locally by me with a temporary browser test (deleted): a real sign-up through
  `/register`, the mail's hashed token read from Mailpit, then
  `/auth/confirm?token_hash=<token>&type=email` opened in a browser with no cookies lands on
  `/parent`; the same for a real forgot-password mail with `type=recovery` lands on
  `/reset-password`. So the device-independent link format works with this code. Opening the
  same sign-up link a second time lands on `/login?error=confirm`: a link is good for one
  request only, so anything that fetches it before the person does (a mail scanner, a preview,
  a double tap) uses it up; in that case the email would however be confirmed, which the
  user's screenshot contradicts. Cause on the hosted project still not established: the link
  as it arrives in the mail and the Supabase Auth log entry are needed. To consider for the
  fix: `/auth/confirm` verifying on a button press (POST) instead of on the GET, so a
  pre-fetch cannot use the link up. Also: `main` is level with `origin/main`, so today's
  commits have been pushed (not by me).

- 2026-10-05: #89, cause found with the user: a fresh reset link copied from GMX webmail into a
  new tab on a computer worked, while the same kind of link tapped in the GMX phone app was
  "invalid or has expired". A link is good for one request and the app fetches it first. User
  asked to build #89; built on `main`, not committed.
  (1) `/auth/confirm` is now a page (`+page.server.ts`, `+page.svelte`; the old `+server.ts` is
  removed): a `token_hash` link only shows a button ("Confirm my email" / "Continue") and the
  token is verified when the form is posted, never by a script. PKCE `code` links are still
  exchanged on the GET (useless without the asking browser's cookie).
  (2) New `/resend-confirmation`: takes only the email, calls `auth.resend`, and gives the same
  answer whatever happens; linked from the register receipt (email prefilled) and from the
  sign-in page after a failed link or an unconfirmed sign-in.
  (3) Sign-in page: the failed-link message is shown in the card instead of as a toast, so it
  no longer stacks on the sign-in error; the three unconfirmed/expired messages and help FAQ 1
  each gained a sentence pointing to the new link.
  12 new keys (`confirm_*`, `resend_*`, `register_receipt_no_mail`); in `messages/bo.json` the
  new keys are English and the four extended texts have an English sentence after the Tibetan.
  `docs/production-email.md` step 7 updated. Verified after a reset: 933 unit tests,
  `npm run check` and `npm run build` exit 0, ESLint and Prettier pass; after another reset
  `auth-fields.e2e.ts` passes 14/14, including a real local sign-up whose mailed token is
  opened in a cookie-less browser twice (first press confirms, second says expired and offers a
  new link) and a real reset mail. Seen in screenshots at phone width. Not verified: on
  `sherab.app` with the GMX app (needs a deploy); whether the GMX app's fetch also explains the
  sign-up case in the user's screenshot, where the email stayed unconfirmed; why the re-send on
  sign-in failed that time; a reset mail for an unconfirmed account. Full browser suite not run.

- 2026-10-06: user asked for the Tibetan translation; 107 entries in `messages/bo.json` written
  by the assistant with the app's existing terms: all `help_*`, `nav_help`, `password_show`,
  `password_hide`, `pin_reset_*`, `confirm_*`, `resend_*`, `register_receipt_no_mail`, and the
  English sentences added to `register_error_exists` and the three `login_error_*` texts. A
  draft, not reviewed by a Tibetan reader. Left as they were: `home_poster_hero`, `credential_pin`
  and texts that are only placeholders. The user then said "stop the change" while the
  screenshots were being regenerated: the job was stopped, the three screenshots it had
  rewritten (`teacher-8.png`) were restored, so the Tibetan screenshots still show the earlier
  English help link on the sign-in page.

- 2026-10-06: user asked to commit. #89 and the Tibetan texts committed on `main` as one code
  commit, the guide and this log as one docs commit; not pushed. Verified before the commit,
  after a reset: 933 unit tests, `npm run check` and `npm run build` exit 0, Prettier passes.
  Browser tests were last run before the translation (`auth-fields` 14/14); not re-run after
  it. No migration.

- 2026-10-06: #90, user asked for two admin options on the Requests page for a parent whose
  confirmation mail is blocked or does not arrive; built on `main`, not committed.
  (1) "Resend confirmation email" on a pending parent row whose email is unconfirmed (new
  action `resendParentConfirmation`, admin only): the same sign-up mail as `/resend-confirmation`,
  sent to the stored address. A failed send (one mail per address per minute) is shown to the
  admin.
  (2) Approve is no longer disabled for an unconfirmed email: it asks first, naming the address,
  and only then approves (`withoutConfirmation` flag on `approveParent`). The action marks the
  login's email confirmed through the service-role client (`email_confirm: true`) and then
  approves through the admin's own client. Reason: an unconfirmed login cannot sign in, `/parent`
  shows "Confirm your email" before anything else, and `parents_update_admin` (0023) refuses the
  approval otherwise; so no migration, and the database rule is unchanged. Consequence: nobody
  has proven they own that address; the question says so.
  5 new keys (`requests_parent_resend`, `requests_parent_outcome_resent`,
  `requests_parent_error_resend_*`, `requests_parent_approve_unconfirmed_confirm`) and a reworded
  `requests_parent_error_unconfirmed`, in en, de and bo (Tibetan is the assistant's draft, not
  reviewed). Verified after a reset: 942 unit tests, `npm run check` and `npm run build` exit 0;
  Prettier and ESLint pass on the changed files (`npm run lint` fails on 196 other files, as
  before). New browser test in `parent-access.e2e.ts` passes: a real unconfirmed parent, resend
  (one mail arrives in Mailpit), cancel leaves it pending, approve, then the parent signs in and
  lands on `/parent` past the confirmation notice. Not verified: on `sherab.app`; the row's three
  buttons at phone width; the full browser suite. Found on the way: `parent-access.e2e.ts`
  "B14b" fails at line 204 ("Temporary password" is visible) also without these changes, after a
  reset; not looked into.

- 2026-10-06: #91, user asked whether every action that can be pressed by mistake asks first.
  Audit: 11 dialogs existed (all via `confirmAction`), among them the parent's deletion request,
  its approval and #90's approve-without-confirmation; these one-press actions that cannot be
  undone had none. User chose "only actions that can't be undone"; built on `main` on top of
  #90, not committed. Now ask first, naming the person or item:
  `/requests`: reject parent (both buttons; a staff request gets its own text), reject student
  registration, clear rejected registration, approve / reject sick leave, reject deletion
  request. Teacher homework page: mark done, mark reviewed, archive, pause series, end series.
  Student homework (list and detail): mark done.
  How: `createPending().submit()` takes an optional `confirm`; `confirmWith(message, okay)` in
  `src/lib/ix.ts` supplies it. No server or database change. 13 new `*_confirm` keys in en, de
  and bo (Tibetan is the assistant's draft, not reviewed).
  Deliberately without a dialog, because pressing again or editing corrects them: attendance,
  skill status, cancel / restore one session, schedule and session edits, teacher class
  assignment, rename and create forms, resend confirmation mail, a student's join request and
  its dismissal, requesting parent access, student registration approval (needs a team first).
  That list was classified from the page markup, not by testing each one.
  Verified after a reset: 947 unit tests (5 new for the `confirm` option), `npm run check` and
  `npm run build` exit 0; Prettier and ESLint pass on the changed files. Full browser suite after
  another reset: 78 passed, 4 skipped, 1 failed ("B14b", which also fails without these changes)
  and 2 not run because of it; those two (#90 and the new #91 reject-parent test: Cancel keeps
  the request, confirming deletes the login) pass when run on their own. `teacher.e2e.ts` now
  cancels and then confirms "Mark done". Dialog seen at 390 px width: text wraps, both buttons
  visible. Not exercised in a browser: the sick-leave, deletion-reject, clear-rejected, archive,
  pause / end series, mark-reviewed and student mark-done dialogs (same helper, no test presses
  them). Not verified on `sherab.app`.

- 2026-10-06: #92 logged, planned (`~/.claude/plans/what-info-do-you-federated-nautilus.md`) and
  built on `main`, not committed: homework push notifications for students and parents.
  User's decisions: students and parents only; "New" when a teacher creates one-off homework
  (not for weekly series); "Due soon" on Saturday morning to both; "Overdue" once, the day
  after, to parents only; a shared phone notifies whoever is signed in; no email.
  How: migration 0037 (`push_subscriptions`, `push_notification_log`, two RPCs for the
  browser, `homework_push_targets` with the 0025 Open rule, `trigger_homework_push` via pg_net
  and Vault, job `send-homework-push` every 5 minutes 07:00-08:55 UTC). `src/lib/server/push.ts`
  writes the text per browser language and sends with `web-push-neo` (new dependency) in
  batches of 20, because Cloudflare's free plan allows 50 outgoing calls per request.
  `/api/push/run` (shared secret) and `/api/push/subscription`; a Notifications card on
  `/account`; `static/push-sw.js` loaded by the generated service worker; the root layout moves
  a browser's subscription to the signed-in account and releases it at sign-out. Off and hidden
  until `VAPID_*` are set (`$env/dynamic/private`). 26 new message keys in en, de and bo
  (Tibetan is the assistant's draft, not reviewed); one help step each for parents and students.
  Setup, checklist and limits: `docs/notifications.md`.
  Changed from the plan: the "New" notice is not sent from the create action but handed to the
  database (`trigger_homework_push`), which calls the app in a request of its own; the action
  has already spent its outgoing calls on the per-student inserts.
  Verified after a reset: 1029 unit tests (82 new: 46 for `push.ts`, 16 for the two endpoints,
  7 for the account load, 13 database tests), `npm run check` and `npm run build` exit 0;
  Prettier and ESLint pass on the changed files. Live, locally: the dev server sent through
  Mozilla's push service to a scripted receiver that decrypted the notices (New to student in
  Tibetan and parent in German, Overdue to the parent only, nothing on a repeated call, and the
  database hand-over through local Vault secrets, since removed). The card seen for a parent at
  390 px. Full browser suite after another reset: 74 passed, 4 skipped, 2 failed, 5 not run
  because of those. The two failures also fail without these changes: "B14b" (known) and
  "admin team names" in `forms.e2e.ts` (see #93).
  Not verified: a notification on a real phone or browser (the automated browser cannot answer
  the permission question); iPhone Home Screen app; the Saturday reminder against the running
  app; anything on `sherab.app` (Cloudflare variables, the hosted job, CPU limit per batch).
  Not pushed, no migration pushed, no dashboard touched.
  During the local test the assistant stopped the dev server by killing every process on its
  port, which also stopped Docker Desktop (its network process held a connection on that port).
  Docker was restarted; other projects' containers came back on their own.

- 2026-10-06: #93 logged, not fixed: `forms.e2e.ts` "admin team names: edit the names, and each
  interface language shows its own (#76)" fails, also on the code before #92 (checked by
  setting the #92 changes aside). It times out at the end, on
  `page.locator('ix-dropdown-item[lang="de"]').click()` after opening the language picker on
  `/leaderboard`: the item is found but "not visible". Cause not looked into. Waiting for the
  user to plan or fix.

- 2026-10-08: #94 logged and built on `main` from
  `_bmad-output/implementation-artifacts/spec-syllabus-sections.md`, not committed; status
  "built, to verify". Migration `0038_syllabus_sections.sql` is NOT pushed. A class syllabus
  for a school year now has any number of sections: a title (1-200 characters), an optional
  rich-text description in a chosen language and up to 10 links (user, 2026-10-08: "I am
  planning to teach 2 songs, then i want to add two songs with links and all").
  How: table `class_syllabus_sections` (RLS through the parent syllabus's class: admin and the
  class's teachers read and change, enrolled students read; column-level update grants, so a
  section cannot change syllabus). `move_syllabus_section()` swaps a section with its neighbour
  in one statement. `syllabus_sections_backfill()` (service role only) copies each syllabus's
  own text and links into one section titled "Syllabus" / "Lehrplan" / "སློབ་ཚན་ཐོ་གཞུང་།" by the
  syllabus's language; the migration runs it once. `class_syllabi.content_doc`,
  `content_language` and `links` stay in the database and are no longer read or written.
  `src/lib/server/class-syllabus.ts` gets `createSection`, `updateSection`, `moveSection`,
  `deleteSection`; both `syllabus/[syllabusId]` routes get the actions `addSection`,
  `updateSection`, `moveSection`, `deleteSection` (the old `update` action is gone).
  `SyllabusDetail.svelte` is the section list with the add form, `SyllabusForm.svelte` the
  per-section form; the year list shows a section count; the student's class page shows the
  sections in order. 18 new `syllabus_section_*` keys in en, de and bo (Tibetan is the
  assistant's draft, not reviewed); 8 `syllabus_*` keys that nothing uses any more are removed.
  Changed from before: adding a syllabus no longer lands on `?edit=1` (a new syllabus has no
  sections; the page shows "No sections yet." and the add form).
  Verified after a reset: 1057 unit tests (28 new: 21 in `class-syllabus.spec.ts`, 7 database
  tests in `rls.spec.ts`), `npm run check` and `npm run build` exit 0; Prettier and ESLint pass
  on the changed files. After another reset: `forms.e2e.ts`, the new
  `syllabus-sections.e2e.ts` and `breadcrumbs.e2e.ts`, 20 passed ("admin team names", #93,
  passed in both runs of `forms.e2e.ts` today). Teacher page seen at 390 px in English and
  Tibetan: a long Tibetan title wraps beside the move buttons and is not clipped.
  Not verified: the migration against a database that already holds syllabi (the local one is
  empty at reset; the copy is tested through the same function on rows made by the test); the
  hosted database and `sherab.app`; the pages in a browser with JavaScript really switched off
  (iX fields are web components and post nothing without it, as on every other form; what is
  tested is a plain form post to the actions, which saves and comes back with the form open);
  the full browser suite (only the three files above were run).
  Deploy the new app right after `db push`: text or links the old deployed app saves after the
  migration ran go to the old columns and never reach a section. Two queries (also in the
  migration's header) check for that.
  Right after the push, syllabi whose old columns hold text or links but that have no section
  (expected: 0 rows):

  ```sql
  select s.id, s.class_id, s.school_year
  from public.class_syllabi s
  where (s.content_doc is not null or jsonb_array_length(s.links) > 0)
    and not exists (
      select 1 from public.class_syllabus_sections c where c.syllabus_id = s.id
    );
  ```

  After the deploy, syllabi whose `class_syllabi.updated_at` is later than their section's
  (edits made in the window, to copy into the section by hand):

  ```sql
  select s.id, s.class_id, s.school_year, s.updated_at
  from public.class_syllabi s
  where exists (
      select 1 from public.class_syllabus_sections c where c.syllabus_id = s.id
    )
    and s.updated_at > (
      select max(c.updated_at)
      from public.class_syllabus_sections c
      where c.syllabus_id = s.id
    );
  ```
