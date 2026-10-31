---
title: 'PDF attachments on posts'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '467437ccaf1b576cdbf6ec314984789b81166ba9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Board posts are text only. Posters can't share a flyer or a letter, and SPEC CAP-2 promises up to 2 PDFs per post.

**Approach:** The `/board` post form gets a PDF file field. The `post` action checks the files, inserts the post, then stores each file in `board-files` and records it in `board_post_files`. Readers see each post's files with open and download links, served through signed URLs. This reuses the homework create-with-files code.

## Boundaries & Constraints

**Always:**
- **Limits:** the homework rules: PDF only (magic-byte check), at most `MAX_HOMEWORK_FILE_BYTES` (5 MB) each, at most 2 per post.
  - The client checks the count and size before sending and shows a local error.
  - The server checks everything again.
- **Body cap:** the `post` action reads the body with `readFileForm` and a cap of 2 × 5 MB + `MAX_CONTENT_BYTES` + overhead. Too large gives `fail(413)`; a broken body gives `fail(400)`.
- **Order:** check content and language, then check the files (`readPdfUpload` for each; more than 2 gives the limit message), then insert the post, then attach the files. A file refusal stores nothing and inserts no post.
- **Attaching:**
  - `storeObject` goes to folder `<post_id>` with the store `{bucket: 'board-files', label: 'board file'}`.
  - Then a `board_post_files` row `{post_id, object_path, file_name, size_bytes, created_by: user.id}`.
  - If the row fails, the object is removed (`removeOrLog`). `BF001` means the limit.
  - The post is kept even if a file fails. The action returns `{posted: true, notAttached: [names]}`, and the page shows a warning toast naming them.
- **Reading:**
  - The load reads `board_post_files` (`id, post_id, file_name, size_bytes`) for the posts on the page in one query, ordered by `created_at`, and attaches `files` to each post.
  - If the files read fails, the posts still render with no files, and the error is logged.
- **Serving:** a new endpoint `src/routes/files/board/[fileId]/+server.ts` mirrors `/files/homework/[fileId]`.
  - It reads the row under RLS, signs it with `signObject` (60 s), and redirects. `?download` makes it a download.
  - A missing or forbidden row, or a bad UUID, gives 404. A signing failure gives 500.
- **Display:** each post lists its files: name and size, an open link and a download link, using the same markup as `HomeworkFiles`, read-only. Either generalise `HomeworkFiles` with a link-base prop (the default keeps the homework links unchanged), or add a `BoardFiles` component.
- **Shared code:** put the board file code (store, form read, file checks, attach, load, signed URL) in a new `src/lib/server/board-files.ts`, reusing the `pdf-files.ts` helpers.
- **Text:** new strings go in `board_file_*` keys in en, de and bo, reusing the homework file messages where the wording fits.

**Never:**
- No migration change.
- No edit, replace or delete of files (story 5).
- No other file types.
- No change to how homework files behave.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Post with 2 PDFs | poster, valid files | post plus 2 objects and 2 rows; listed under the post | N/A |
| Post with no file | empty file field | post only | N/A |
| 3 files | 3 chosen | `fail(400)` limit; nothing stored; no post | localized |
| Not a PDF | `.docx` | `fail(400)` naming the file; no post | localized |
| File over 5 MB | 5,242,881 bytes | `fail(400)` naming the file; no post | localized |
| Body over the cap | huge request | `fail(413)` | localized |
| Row insert fails | DB error or `BF001` | object removed; post kept; `notAttached` names it | warning toast |
| Store fails | upload error | post kept; `notAttached` | warning toast |
| Files read fails | DB error | posts shown without files | logged |
| Open file | reader, valid id | 303 to a signed URL | N/A |
| Download | `?download` | signed URL with download name | N/A |
| Forbidden or missing | non-reader, or unknown id | 404 | N/A |
| Bad id | not a UUID | 404 | N/A |
| Client check | 3 files, or one too large | local error; nothing sent | localized |

</frozen-after-approval>

## Code Map

- `src/lib/server/homework-files.ts`:
  - `readCreateForm` :433, `MAX_CREATE_POST_BYTES` :57, `readCreateFiles` :278, `problemMessages` :60, `attachCreatedFiles` :306, `attachOne` :113 (with rollback), `HF001` :49, `loadHomeworkFiles` :331, `signedFileUrl` :412.
  - The patterns to copy for the board.
- `src/lib/server/pdf-files.ts` -- `PdfStore` :19, `readPdfUpload` :58, `readFileForm` :87, `storeObject` :137, `signObject` :218, `removeOrLog` :207. These work with any bucket.
- `src/lib/homework-files.ts` -- the limits and message helpers. `src/lib/pdf-files.ts` -- `formatFileSize`, `PdfFile`.
- `src/routes/files/homework/[fileId]/+server.ts` -- the endpoint to mirror.
- `src/lib/components/HomeworkFiles.svelte` -- reader markup (links at :140 and :152).
- `src/routes/teacher/classes/[id]/homework/new/+page.svelte` -- copy from here:
  - `enctype` (:155);
  - the file input (:183-199);
  - the client check in `submitCreate` (:75-89).
- `src/routes/teacher/classes/[id]/homework/new/+page.server.ts:58,98-121` -- the route flow with `notAttached`.
- `src/routes/board/+page.server.ts` (`post` action, load), `+page.svelte` (form, list) -- story 3's code to extend.
- Tests: `src/routes/teacher/classes/[id]/homework/new/page.server.spec.ts` (`pdf()` helper :239; a fake storage log at :299-306; order asserts :352, :394, :417); `src/lib/server/homework-files.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/board-files.ts` -- the store, form read, file checks, attach with rollback, load by post ids, signed URL.
- [x] `src/routes/board/+page.server.ts` -- the post action with files; `files` per post in the load.
- [x] `src/routes/board/+page.svelte` -- the multipart form, file input and hint, the client check, the warning toast, the file list per post.
- [x] `src/routes/files/board/[fileId]/+server.ts` -- the signed-URL redirect.
- [x] `src/lib/components/HomeworkFiles.svelte` (generalised) or a new `BoardFiles.svelte` -- the reader list.
- [x] `messages/{en,de,bo}.json` -- the `board_file_*` keys.
- [x] `src/lib/server/board-files.spec.ts`, `src/routes/board/page.server.spec.ts`, `src/routes/files/board/[fileId]/server.spec.ts` -- every server row of the matrix.
- [x] `src/routes/board/page.render.spec.ts` -- the file list under a post; the form is multipart with the file input.
- [x] `e2e/board.e2e.ts` -- a parent posts with a PDF; a student sees it and opening the file works.

**Acceptance Criteria:**
- Given the homework file tests, when they run, then they pass unchanged.

## Implementation Notes

- `BoardFiles.svelte` is a new read-only component, so `HomeworkFiles` is unchanged.
- `src/lib/ui/tailwind.css` gains `@source` entries for `BoardFiles.svelte` and for `routes/board/+page.svelte`. The board page from story 3 was missing from the source list, so some of its classes may not have been generated.
- On the file endpoint, a DB error while reading the row gives 500 (logged), the same as a signing failure.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | verification-gap, blind | The client refusal and the inline file error are untested in a browser | medium (gap) | The render spec always passes `form: null`; the e2e covers only the happy path | patch: e2e |
| 2 | blind | An oversize body (3 × 4 MB without JS) gets the single-file "too large" message | low | The 413 reuses the homework per-file text; the real problem is the count or total | patch: new message |
| 3 | edge-case | Refusal messages show the raw file name | low | `cleanFileName` adds `.pdf`, which misnames a refused Word file ("notes.docx.pdf"), so the patch strips only the path and control characters | patch (revised) |
| 4 | edge-case | A stale file error stays after a new selection | low | Cleared only on submit | patch |
| 5 | blind | Every post's file list has the same accessible name | low | A static label; homework names its list | patch |
| 6 | blind | The not-attached warning gives no next step | low | Wording; story 5 adds delete | patch |
| 7 | blind | Over-long doc comment; needless `?? []` | low | Direct correction | patch |
| 8 | verification-gap | The `notAttached` warning toast is untested | medium (gap) | Needs fault injection in e2e; the server return value is tested | defer |
| 9 | edge-case | Insert succeeds but returns 0 rows, so the object is removed while the row exists | false | The insert's returning select runs under `board_post_files_select_reader`; every poster is a reader | rejected |
| 10 | blind | A files read failure isn't shown to readers | low | The frozen spec says posts render without files; the error is logged | rejected |
| 11 | blind | The post is visible before its files attach, with no rollback | low | The frozen spec keeps the post and reports `notAttached` | rejected |
| 12 | blind | Hard-coded quotes and comma around names | low | Same as the homework `notAttached` text | rejected |
| 13 | edge-case | Without JS, the not-attached warning is never shown | low | The rich-text editor needs JS anyway | rejected |
| 14 | blind | Non-PDFs are refused only after upload | low | The server checks the magic bytes; `accept` filters the picker | rejected |
| 15 | blind | A failed cleanup leaves an orphan object | low | `removeOrLog` logs it; the migration header has the orphan query | rejected |
| 16 | blind | Deleting a post leaves stored files | low | Story 5 removes objects before rows (stories.yaml note) | rejected |
| 17 | blind | A signed-out file link gives a bare 404 | low | Same as homework files | rejected |
| 18 | verification-gap | The file input may not clear after a post | maybe-false | Would need `pending.submit`'s reset checked; the e2e posts once | rejected (low if true) |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/board.e2e.ts` -- expected: pass.
