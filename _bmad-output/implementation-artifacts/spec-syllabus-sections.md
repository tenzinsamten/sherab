---
title: 'Syllabus sections: several titled sections under a class syllabus'
type: 'feature'
created: '2026-10-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '41076f597e8764da1515fb5ce2123f8b7386176f'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A class syllabus for a school year holds one block of text and one list of links. A teacher who plans two songs, or a song and a dance, has to put everything into that one block (user, 2026-10-08: "I am planning to teach 2 songs, then i want to add two songs with links and all").

**Approach:** Under each yearly syllabus the teacher adds as many sections as they need. A section has a title, an optional rich-text description in a chosen language, and optional links. Existing syllabus text and links become the first section.

## Boundaries & Constraints

**Always:**
- A section belongs to one syllabus. Title is required (1-200 characters); description and links are optional and behave exactly like today's syllabus text and links (rich text, language, up to 10 links, same size cap).
- Access follows the syllabus: the admin and the class's teachers read and change; enrolled students read; nobody else sees anything. Enforced by RLS, not only by the pages.
- Sections show in the order added; a teacher or admin can move a section up or down and delete one after a confirmation.
- Migration: every syllabus that has text or links gets one section holding them, titled "Syllabus" in that syllabus's language (en / de / bo wording from the existing `syllabus_heading` message). Nothing is lost and nothing shows twice.
- `class_syllabi.content_doc`, `content_language` and `links` stay in the database, no longer read or written, so the deployed app keeps working between the migration push and the deploy.
- Teacher and admin pages keep sharing the same components and server helpers. All new text in en, de and bo (Tibetan is the assistant's draft, recorded as unreviewed).

**Never:**
- No file upload (deferred: PDF only, 1 MB). No parent access. No search or archive. All three are in `deferred-work.md`.
- No change to the one-syllabus-per-class-per-year rule, to school-year handling, or to homework.
- Do not regenerate `database.types.ts`; edit it by hand. Do not push the migration or commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add section | Title "Song 1" on a syllabus | Section created last in order, opens for editing | N/A |
| Empty title | Title blank or over 200 chars | Nothing saved | Field error, form keeps its values |
| Save section | Title, description doc, language, links | Saved; toast; view mode | Invalid doc, language or links: same messages as today |
| Move up / down | First section moved up, last moved down | No change | Button disabled; server ignores it |
| Delete section | Confirmed | Section gone, the others keep their order | Cancelled: nothing happens |
| Wrong class | Section id from another class or syllabus | Nothing changed | 400, generic save error |
| Student view | Enrolled student, syllabus with 2 sections | Both titles with text and links, in order | Not enrolled: sees nothing (RLS) |
| Syllabus with no sections | New year just added | "No sections yet" and the add form | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0015_class_syllabi.sql`, `0016_class_enrollments.sql:399-406`, `0035_syllabus_content.sql` -- table, the current select policy (`is_admin()`, `is_teacher_of_class`, `is_enrolled_in_class`), column grants and the `content_doc` check to copy. New migration is `0038_syllabus_sections.sql`.
- `src/lib/server/class-syllabus.ts` -- `Syllabus` type, `parseSyllabusForm`, `listSyllabi`, `loadSyllabusDetail`, `updateSyllabus`, `ActionContext`. Extend here; reuse `parseContent`, `isContentLanguage` (`$lib/rich-text`) and `parseReferenceLinks` / `readReferenceLinks` (`./homework-details`).
- `src/lib/server/class-syllabus.spec.ts`, `src/lib/server/rls.spec.ts` -- unit and database tests to extend.
- `src/lib/components/SyllabusDetail.svelte`, `SyllabusForm.svelte` -- today's single view/edit; become the section list and the per-section form. `SyllabusList.svelte:74-81` -- row summary (links count, first line) to replace with a section count.
- `src/routes/teacher/classes/[id]/syllabus/[syllabusId]/+page.server.ts` and the identical `admin/classes/[id]/syllabus/[syllabusId]` -- actions `update`, `delete`; add the section actions to both.
- `src/routes/student/classes/[classId]/+page.server.ts:49-71`, `+page.svelte:65-74` -- student view via `listSyllabi` + `pickStudentSyllabus`.
- `src/lib/server/student-homework.ts:197-220` -- `hasSyllabus` reads only `class_syllabi`; unchanged.
- `src/lib/supabase/database.types.ts:363` -- hand-maintained; add the new table.
- `messages/{en,de,bo}.json` `syllabus_*` (25 keys) -- naming to follow.
- `e2e/forms.e2e.ts:173` -- existing syllabus browser test; `e2e/fixtures.ts` helpers.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0038_syllabus_sections.sql` -- create `class_syllabus_sections` (`syllabus_id` fk cascade, `position`, `title`, `content_doc`, `content_language`, `links`, `created_by`, timestamps), index, RLS through the parent syllabus's class, column-level update grants, and the copy of existing text and links into one section each -- storage and access.
- [x] `src/lib/supabase/database.types.ts` -- add the table by hand -- typed queries.
- [x] `src/lib/server/class-syllabus.ts` -- `Section` type on `Syllabus`; load sections ordered by `position`; `parseSectionForm`; `createSection`, `updateSection`, `moveSection`, `deleteSection`, each checking syllabus and class and treating zero rows as failure; stop reading and writing the syllabus-level text and links -- server logic.
- [x] `src/lib/server/class-syllabus.spec.ts` -- cover every matrix row that is server logic -- edge cases.
- [x] `src/lib/server/rls.spec.ts` -- teacher of the class writes; other teacher and non-enrolled student get nothing; enrolled student reads but cannot write; migration copy produces one section -- access proven in the database.
- [x] `src/lib/components/SyllabusDetail.svelte`, `SyllabusForm.svelte` (or a new `SyllabusSection.svelte`), `SyllabusList.svelte` -- section list with per-section view / edit / move / delete, an "Add section" form, section count in the year list -- teacher and admin UI.
- [x] both `syllabus/[syllabusId]/+page.server.ts` files -- wire the four section actions -- routes.
- [x] `src/routes/student/classes/[classId]/+page.svelte` (and its server file if the shape changes) -- show the sections in order -- student view.
- [x] `messages/en.json`, `de.json`, `bo.json` -- new `syllabus_section_*` keys -- translations.
- [x] `e2e/forms.e2e.ts` or a new `e2e/syllabus-sections.e2e.ts` -- teacher adds two sections, reorders, deletes one; student sees them -- browser check.
- [x] `_bmad-output/manual-verification-issues.md` -- log the change as a new numbered entry, "built, to verify", with the migration not pushed -- project log.

**Acceptance Criteria:**
- Given a syllabus that had text and links before the migration, when the teacher opens it, then one section titled "Syllabus" shows that same text and links.
- Given a teacher on a syllabus, when they add "Song 1" and "Song 2" with links, then both appear in that order for the teacher, the admin and an enrolled student.
- Given the interface is in Tibetan, when a section written in English is shown, then its text keeps the English font (per-section language).
- Given JavaScript is off, when a section form is posted, then it still saves.

## Implementation Notes

- Reordering is a database function, `move_syllabus_section(section, syllabus, class, direction)` (security invoker, so RLS applies): it locks the syllabus's sections, swaps and renumbers 1..n in one statement. It returns `moved`, `unchanged` (first up / last down) or null (not found, wrong class or syllabus, not allowed); the action turns null into the 400.
- The copy of existing text and links is a function too, `syllabus_sections_backfill()` (service role only), called once by the migration and by the database test. It skips a syllabus that already has a section.
- `position` is not unique; ties sort by `created_at`. A new section gets the last position + 1, read by the action before the insert.
- A wrong title returns `{ titleError, sectionId }` without `error`, so it shows under the field and not also as the root layout's error toast.
- Adding a syllabus no longer redirects to `?edit=1`; `startInEdit` is gone.
- 8 `syllabus_*` message keys that lost their last use were removed (`syllabus_links_count`, `syllabus_no_links`, `syllabus_edit`, `syllabus_label`, `syllabus_links_legend`, `syllabus_submit`, `syllabus_saved`, `syllabus_language_label`).
- "JavaScript off" is covered as a plain (not enhanced) form post in `e2e/syllabus-sections.e2e.ts`; iX input fields themselves need JavaScript, as everywhere in the app.

- Review pass 1 (2026-10-08): 12 fixes applied, see the triage log. Verified afterwards on a reset database: 1056 unit and database tests, `npm run check` and `npm run build` exit 0; browser tests: all 6 in `syllabus-sections.e2e.ts`, the syllabus tests in `forms.e2e.ts` and `breadcrumbs.e2e.ts` pass; "admin team names" (#93, unrelated, intermittent) failed in this run and stopped the 3 tests after it.
- Migration copy checked on old-format rows: database reset to 0037, four syllabi inserted (text and a link in en, text in bo, links only in de, empty), then 0038 applied. Result: three sections titled Syllabus / the Tibetan heading / Lehrplan with identical text and links, none for the empty one, and no syllabus with text or links left without a section. Not run against the hosted database.
- Not committed and not pushed; migration 0038 is local only.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-08). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| V1 | The migration's one-time backfill call is never run against existing rows | medium | Filed evidence: the test calls `syllabus_sections_backfill()` itself; a reset database has no syllabi when 0038 runs. | patch: simulate locally on pre-0038 rows; hosted check noted in the log |
| V2 | Admin route's `moveSection` / `deleteSection` are never posted to | low | Filed evidence: all move/delete browser steps use `/teacher/...`. | patch (test) |
| V3 | Student "no syllabus yet" text for a syllabus without sections is not asserted | low | Filed evidence: only use of `student_syllabus_empty` is the page. | patch (test) |
| V4 | `move_syllabus_section` with tied positions is not exercised | low | Filed evidence: every test row gets `max + 1`. | patch (test) |
| V5 | `supabase/seed.sql` is configured but missing | false | Not a defect of this change; a reset database being empty is the project's normal state. | rejected |
| B1 / E1 / V-other | Edits made in the old app between `db push` and deploy never reach a section | medium | Real: backfill runs once and skips syllabi that have a section; the new code no longer reads the old columns. Inherent in keeping the old columns for the deployed app (frozen). | patch: write the push-then-deploy rule and a check query into the migration header and the log |
| B2 / E4 | A title error reappears after Cancel then Edit | low | `titleError` is passed from `result` for as long as `form` holds the failed result (`SyllabusDetail.svelte`). | patch |
| B3 / E2 | A new section is stored as `en` whatever language its title is in | medium | `createSection` inserts no `content_language`; the title is drawn with `lang={section.contentLanguage}`, so a Tibetan title loses its font until the form is saved. | patch |
| B4 / E3 | The edit form can change a saved section's language | medium | `SyllabusForm.svelte` starts from the interface language whenever `section.content` is empty, also for a saved title-only or links-only section. | patch |
| B5 | Section failures show syllabus-worded messages | low | True ("Could not save the syllabus"). Met only when a save fails; fix needs new keys in three languages. | rejected (low, rare) |
| B6 | Every section document is loaded to count sections | low | True of `SYLLABUS_COLUMNS`; not noticeable at this school's size, and the fix is a second query shape. | rejected (low) |
| B7 / E6 | No cap on sections per syllabus; concurrent adds can tie positions | low | True; ties are tolerated by the sort and repaired by the next move. A cap is a new guard for a state nobody reaches in normal use. | rejected (low) |
| B8a | No feedback after a section is added | low | True: save and delete toast, add does not. | patch (toast) |
| B8b | After a move the focused arrow can become disabled and focus is dropped | low | True, but every button in the app is disabled through `pending.busy` during a post (72 uses), so focus is already dropped on any submit. | defer (pre-existing pattern) |
| B9 | "Delete syllabus" confirmation does not say the sections go too | low | True: `syllabus_delete_confirm` unchanged while the delete now cascades to sections. | patch (wording) |
| B10a / E7 | `firstLine` is dead code | low | Only `rich-text.ts` and its own spec reference it after the list preview was removed. | patch (delete) |
| B10b / E8 | `Syllabus.updatedAt` is stale and unread | low | Selected and mapped in `class-syllabus.ts`; read by no component; no section action bumps it. | patch (delete) |
| B10c | `authenticated` keeps update grants on the deprecated syllabus columns | false | Needed: the deployed app writes those columns until the new deploy. | rejected |
| B11a | Tie and gap repair untested | low | Gap is covered (delete the middle one, then move); ties are V4. | merged into V4 |
| B11b | No parent-role database case | false | Parents have no policy path to the table; the non-enrolled and signed-out cases cover "nobody else". | rejected |
| B12a | e2e test title says "admin and enrolled student" but signs in only as the admin | low | True; the student is the next test. | patch (rename) |
| B12b | `ORIGIN` repeats the port; no 201-character or admin-edit browser case | low | True; the unit spec covers 201 characters and `forms.e2e.ts` has the admin editing a section. | rejected (low) |
| B13 / E9 | "JavaScript off: it still saves" holds only for hand-built posts; a real browser without JavaScript cannot fill iX fields, and a failed plain post loses what was typed | medium | True, and true of every form in the app since the iX field migration (#66). The acceptance criterion in this spec was written too broadly. | rejected (fix is to edit this spec); reported to the user |
| E5 | String comparison of `created_at` can disagree with the database order | low | Needs tied positions and a timestamp with exactly zero microseconds. | rejected (low, not reachable in practice) |

## Verification

**Commands:**
- `npm run supabase:reset` then `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/forms.e2e.ts` (and the new file if added), on a freshly reset database -- expected: the syllabus tests pass; the known "admin team names" failure (#93) is unrelated

**Manual checks (if no CLI):**
- Teacher syllabus page at 390 px: section list, edit form and move buttons usable; Tibetan titles not clipped.
