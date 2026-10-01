---
title: '#72-#74 Homework content: rich text, no limit, content language'
type: 'feature'
created: '2026-10-01'
status: 'built'
baseline_commit: 'd47976d7319a20d1061785322caf7138e210c692'
route: 'direct'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Homework had one optional plain-text Description capped at 2000 characters (#72, #73), and Tibetan homework only showed in the Tibetan font when the viewer's interface was Tibetan (#74).

**Approach:** A required rich-text Content field replaces Description. The teacher picks the language the homework is written in; that language sets the font of the title and content for every viewer. The content is stored as the editor's document in JSON and drawn element by element.

## Boundaries & Constraints

**Always:**
- Content is required on create and on edit, for one-off and weekly homework.
- Toolbar: bold, italic, underline, two heading sizes, bullet list, numbered list, link.
- Languages: Tibetan (`bo`), English (`en`), German (`de`); default the teacher's interface language.
- The language applies to the content and to the title wherever homework is listed (teacher, student, parent).
- No length limit a teacher can see. A safety cap of 1 MB per homework stays in the server check, with a 2 MB database backstop.
- Links only over `http`, `https` or `mailto`.
- Tiptap's MIT packages only.

**Never:**
- No `{@html}` and no stored HTML.
- No Tiptap Cloud, paid extensions, account or key.
- Don't change the class syllabus (it keeps plain text).
- Don't drop `description` or `reference_link` in this change.
- Don't push migration 0034 to the hosted database or deploy (user step).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create with content | text, formatting, language `bo` | Saved; student sees it formatted, in the Tibetan font, under any interface language | N/A |
| No content | empty editor, or only blank lines | Nothing saved | toast "Content is required." |
| Long content | far more than 2000 characters | Saved | N/A |
| Over the cap | more than 1 MB of JSON | Nothing saved | toast "The content is too large to save…" |
| Not a document | hand-made post: HTML, unknown node, `javascript:` link | Nothing saved | toast "The content could not be read…" |
| Unknown language | `contentLanguage` missing or not offered | Nothing saved | toast "Choose the language of the homework." |
| Old homework with a description | before 0034 | Description shown as content, one paragraph per line | N/A |
| Old homework without one | `content` null | No content shown; the first edit must add it | N/A |
| Server error on save | e.g. invalid due-date offset | Typed content stays in the editor | existing toast |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0034_homework_content.sql` -- `homework_assignments.content` (jsonb, nullable) and `content_language` (default `en`), backfill from `description`, Tibetan-script detection for the language, `grant update (content, content_language)`.
- `src/lib/rich-text.ts` -- document types, `cleanDoc` (allow-list; drops unused attributes and trailing empty paragraphs), `parseContent`, `readContent`, `hasText`, `isSafeHref`, `CONTENT_LANGUAGES`, `readContentLanguage`.
- `src/lib/server/homework-details.ts` -- `parseHomeworkContent(formData)` returns the document and language or the message to show. `parseDescription` stays for the syllabus and now takes its maximum explicitly.
- `src/lib/components/RichText.svelte` -- display, recursive snippets, `lang` on the wrapper.
- `src/lib/components/RichTextEditor.svelte` -- Tiptap loaded in the browser, toolbar, link panel, hidden `content` field with the JSON.
- `src/lib/components/ContentLanguageSelect.svelte` -- `contentLanguage` select with a bindable value.
- `src/routes/teacher/classes/[id]/homework/new/` and `.../[assignmentId]/` -- forms and actions.
- `src/lib/server/homework-view.ts`, `src/lib/server/student-homework.ts` -- `content` / `contentLanguage` on `AssignmentView`, `AssignmentSummary`, `StudentHomeworkItem`; `STUDENT_ASSIGNMENT_COLUMNS`.
- Title `lang`: teacher list and detail, `StudentHomeworkRows.svelte`, student detail, `parent/homework`, `parent/children/[id]`.
- `src/app.css` -- reverse font rule for English or German homework inside a Tibetan interface.
- `src/lib/ix.ts` -- toolbar icons. `src/lib/supabase/database.types.ts` -- hand-edited columns.
- `messages/{en,de,bo}.json` -- content, language and toolbar strings; the description strings are removed. The new `bo` strings are in English, like the rest of that file's homework section.

## Tests

- `src/lib/rich-text.spec.ts` -- allow-list, refused nodes / marks / links, nesting depth, required, byte cap, read-side fallbacks, and the exact HTML `RichText` renders (no whitespace added inside a line, text escaped).
- `src/lib/server/homework-details.spec.ts` -- `parseHomeworkContent`.
- `src/lib/server/rls.spec.ts` -- the class's teacher can update `content` and `content_language`; another teacher cannot; bad values are refused; `whole_class` stays closed.
- `e2e/teacher.e2e.ts` -- existing homework tests moved to the editor; "content is required"; Tibetan homework with bold text, a long paragraph and a list, read by a student with an English interface in the Tibetan font.

## Verification (2026-10-01, local)

- `npm run supabase:reset`, then `npm test` (865 passed), `npm run check`, `npm run build`: all exit 0.
- `npx playwright test` on a freshly reset database: 72 passed.
- 0034 applied with `supabase migration up` to a database holding sample descriptions: content and language backfilled as specified.
- `npm run lint` fails on formatting in files outside `src` (tooling and docs); `prettier --check` and `eslint` pass on `src`, `e2e`, `messages` and `supabase/migrations`.

## Known limits

- The title in the breadcrumb and inside the title input keeps the interface font: both sit inside iX components.
- Parents see title and links only, as before.
- Run the browser tests on a freshly reset database. The unit tests leave class days around today, which break the attendance test in `e2e/teacher.e2e.ts`.

## Extension: syllabus (#75, 2026-10-01)

Requested after the build above: "i also need same in add sylabus section".

- `supabase/migrations/0035_syllabus_content.sql` -- `class_syllabi.content_doc` (jsonb) and `content_language`, backfill from the plain-text `content` (kept, unused), `grant update (content_doc, content_language)`.
- `src/lib/server/class-syllabus.ts` -- `Syllabus.content` is the document, plus `contentLanguage`; `parseSyllabusForm` reads the editor's `content` and `contentLanguage`. The text stays optional: an empty editor saves null.
- `SyllabusForm.svelte` (language select + editor), `SyllabusDetail.svelte` and the student class page (`RichText`), `SyllabusList.svelte` (one-line preview through `firstLine()` in `src/lib/rich-text.ts`).
- `ContentLanguageSelect.svelte` takes a `label`. `TextWithLinks.svelte` now shows links only. `parseDescription` and `MAX_SYLLABUS_LENGTH` are removed: no plain-text field is left.
- Tests: `class-syllabus.spec.ts`, `rich-text.spec.ts` (`firstLine`), `e2e/forms.e2e.ts` (a Tibetan syllabus with a bold line, saved, shown in the Tibetan font, reopened).
- Verified locally after a reset: 868 unit tests, check and build exit 0. Browser tests: 58 passed in the full run; one calendar test (`e2e/calendar.e2e.ts:318`) timed out on a dialog click and stopped the 13 after it, and the calendar file re-run alone passed all 22.

## Rollout (user steps)

1. Push `0034_homework_content.sql` and `0035_syllabus_content.sql` to hosted.
2. Deploy straight after: homework created on the old deployed app after the push has no content, and a syllabus edited there would not show its changes in the new app.
