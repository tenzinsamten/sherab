# Addendum — Parent Role PRD

## Technical notes (for architecture)

- **Parent↔student link mechanism (user-proposed):** the parent's account email acts as the reference key; a student's guardian email on their registration points to the parent account. Architecture decides whether this is a live email match or a stored foreign key set at match time.
- **Email collision risk (found in code, 0006_guardian_email_verification.sql):** student self-registration signs up to Supabase Auth with the guardian's real email until approval; Auth emails are unique. Superseded by the parent-first decision below.
- **Update after parent-first decision:** since students now register only against an approved Parent's (already-confirmed) email, the student sign-up no longer needs the guardian's real email as its Supabase Auth email for confirmation. Architecture can give pending students a synthetic auth email from the start, which removes the unique-email collision above.
- **Dual role (Teacher/Admin + Parent on one login):** today `profiles.role` is a single value. Supporting one login with two roles needs a role model change (e.g. separate parent-role record with its own approval status) and a role switcher in the UI. Architecture decides.
- **Dual role (Teacher/Admin + Parent on one login):** today `profiles.role` is a single value. Supporting one login with two roles needs a role model change (e.g. a separate parent-role record with its own approval status) and a role switcher in the UI. Architecture decides.

## Technical notes for §4.6, Homework Content & Syllabus (added 2026-10-01, as built)

- **Stored format:** the editor's document as JSON, not HTML. The server checks every saved document against an allow-list of node and mark types (`src/lib/rich-text.ts`), and the pages draw it element by element (`RichText.svelte`), so no HTML sanitiser is needed and nothing typed is inserted as markup. The app runs on Cloudflare Workers, which has no DOM for a sanitiser.
- **Editor:** Tiptap, MIT-licensed packages only (`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm`). No Tiptap Cloud, paid extensions, account, or key. Loaded in the browser on the forms that need it.
- **Length:** no limit in the interface. A safety cap of 1 MB per document is enforced by the server, with a 2 MB check constraint in the database behind it.
- **Database:** `0034_homework_content.sql` adds `homework_assignments.content` (jsonb) and `content_language`; `0035_syllabus_content.sql` adds `class_syllabi.content_doc` (jsonb) and `content_language`. Both copy the old plain text across and grant column-level update on the new columns. The old `homework_assignments.description` and `class_syllabi.content` columns stay, unused, until a cleanup migration.
- **Rollout:** push 0034 and 0035 together and deploy straight after. Homework created on the old deployed app after the push has no content.
- **Font rule:** the title and content carry a `lang` attribute; `src/app.css` applies the Tibetan face to `[lang='bo']` and restores the standard face for English or German text inside a Tibetan interface.
- **Spec and status:** `_bmad-output/implementation-artifacts/spec-72-74-homework-content.md`. Built on branch `feat/72-74-homework-content`; both migrations were pushed to the hosted database on 2026-10-01.

## Technical notes for §4.7, Class & Team Names (added 2026-10-03, as built)

- **Database:** `0036_localized_names.sql` adds `name_bo` and `name_de` to `classes` and `teams`. `name` stays the English name and the fallback. The new columns are nullable (existing rows, optional German); a blank value is refused, and each language has its own unique index (lower-cased, trimmed). That Tibetan is required is the forms' rule, not the database's.
- **Reads:** every function and the view that return a class or team name also return the other two names. Existing columns are unchanged. `request_class_join` still returns the English name as text; the app reads the names through `validate_class_code`.
- **Which name is shown:** decided on the server per request from the interface language (`src/lib/localized-name.ts`), so pages receive one name. Changing the interface language reloads the page.
- **Admin:** `teams_update_admin` lets the Admin update a team (classes already had an update policy). Both admin pages have a `rename` action.
- **Ordering:** lists the database orders by name use the English name; lists the app orders use the shown name.
- **Rollout:** push 0036, then deploy. The deployed code keeps working after the push; the new code needs the migration.
- **Status:** built and committed on `main` on 2026-10-03; 0036 is on the hosted database.

## Technical notes for §4.8, Tibetan Font (added 2026-10-03, as built)

- **File:** `src/lib/assets/fonts/Atisha.ttf` (603 KB, TrueType, version 1.0), declared with `@font-face` in `src/app.css` and bundled by the build under a hashed name. `--font-tibetan` is `'Atisha', serif`.
- **Removed:** the Google Fonts import of Noto Serif Tibetan. The app now makes no font request to a third party.
- **Scope:** the face is limited to the Tibetan block (`unicode-range: U+0F00-0FFF`), so Latin text and digits inside `[lang='bo']` fall through to the serif fallback, as they did before. The `[lang='bo']` rules and the line height of 1.6 are unchanged.
- **Weight:** one weight (400); bold is synthesised by the browser.
- **Licence:** not confirmed; see PRD §10, Open Question 11. The font file allows embedding in documents (`fsType` 8) but says nothing about serving it from a website.
- **Status:** built and committed on `main` on 2026-10-03. Issue #77.
