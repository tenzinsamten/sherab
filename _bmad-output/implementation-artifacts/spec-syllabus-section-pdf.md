---
title: 'Syllabus section files: PDF upload per section'
type: 'feature'
created: '2026-10-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a3dc010ff5e8ffdccd87468881dc51a2848f513e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A syllabus section holds text and links only. A teacher cannot attach a document of their own (lyrics sheet, worksheet, notes) to it (user, 2026-10-08: "option to upload pdf file of any document that teacher wants as part of sylabus").

**Approach:** A teacher or admin uploads PDF files to a section, replaces one with a newer version, or removes it. Enrolled students open them from their class page. Files live in a private Supabase Storage bucket; this is the app's first file storage.

## Boundaries & Constraints

**Always:**
- PDF only, at most 1 MB (1,048,576 bytes) per file, at most 5 files per section. All three are checked by the server, and size and type also by the bucket.
- A file is accepted only if it really is a PDF (content starts with `%PDF-`), whatever its name or declared type.
- Files are private: the admin and the class's teachers upload, replace and remove; enrolled students read; nobody else, signed in or not, can list or fetch one. Enforced by storage and table policies, not only by pages. No public URLs.
- Deleting a file, its section, its syllabus or its class also removes the stored objects; nothing is left behind in the bucket.
- The original file name is shown and used for the download; it is never used as the storage path.
- Teacher and admin pages keep sharing components and server helpers. New text in en, de and bo (Tibetan is the assistant's draft, recorded as unreviewed).

**Never:**
- No other file types, no images, no upload by students or parents, no parent access.
- No new service or dependency beyond Supabase Storage.
- Do not regenerate `database.types.ts`. Do not push the migration, touch the hosted project, or commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload | 300 KB PDF on a section with 0 files | Listed under the section with name and size; toast | N/A |
| Too large | PDF over 1 MB | Nothing stored | Message naming the 1 MB limit |
| Not a PDF | `.docx`, or a `.pdf` whose content is not PDF | Nothing stored | Message "PDF files only" |
| Sixth file | Section already has 5 | Nothing stored; upload control hidden at 5 | Message naming the limit of 5 |
| No file chosen | Empty post | Nothing stored | Field message |
| Replace | New valid PDF for an existing file | Same list position, new name and size; old object removed | Invalid file: old one stays |
| Remove | Confirmed | Row and stored object gone | Cancelled: nothing happens |
| Delete section / syllabus / class | Has files | Stored objects removed with it | Storage removal fails: the delete is refused with an error |
| Student opens file | Enrolled | PDF opens in a new tab under its original name | N/A |
| Outsider | Other class's teacher, non-enrolled student, parent, signed out, guessing the link | Not found | No object, no signed link |
| Wrong class | File id from another class in a post | Nothing changed | 400, generic error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0038_syllabus_sections.sql` -- `class_syllabus_sections` and its policy shape (through `class_syllabi.class_id`, `is_admin()`, `is_teacher_of_class`, `is_enrolled_in_class`). New migration is `0039_syllabus_section_files.sql`.
- Storage locally: schema `storage` exists with `storage.foldername(name)`; no buckets or `storage.objects` policies yet. `supabase/config.toml:114` storage enabled, 50 MiB global limit. Create the bucket in the migration (`insert into storage.buckets`, `public = false`, `file_size_limit`, `allowed_mime_types`), and put the class id first in the object path (`<class_id>/<section_id>/<file_id>.pdf`) so `storage.objects` policies can check the class.
- `src/lib/server/class-syllabus.ts` -- `SyllabusSection`, `SYLLABUS_COLUMNS`, `toSyllabus`, `syllabusInClass`, `SectionActionContext`, `deleteSection` (:~430), `deleteSyllabus` (:~255). Put file logic in a new `src/lib/server/syllabus-files.ts`.
- `src/routes/admin/classes/+page.server.ts:233` -- class delete; must remove the class's stored files first.
- Both `syllabus/[syllabusId]/+page.server.ts` (teacher, admin) -- section actions via `sectionContext`; add the file actions the same way.
- `src/lib/components/SyllabusDetail.svelte` -- section view and forms, shared `pending`, `confirmWith`; `TextWithLinks.svelte` -- link list pattern (`target="_blank" rel="noopener noreferrer"`).
- `src/routes/student/classes/[classId]/+page.svelte:66-80` -- student section view.
- Hosting is Cloudflare (`@sveltejs/adapter-cloudflare`): the upload arrives as a multipart form post and is forwarded with the user's Supabase client, so storage policies apply. Serve files through a short-lived signed URL (redirect from an app route that first reads the file row under RLS), not by streaming through the worker.
- No file input exists in the app and `@siemens/ix` ships no upload component here: use a native `<input type="file" accept="application/pdf">`.
- `src/lib/server/rls.spec.ts`, `class-syllabus.spec.ts`, `e2e/syllabus-sections.e2e.ts` -- tests to extend. `src/lib/supabase/database.types.ts` -- hand-maintained.
- `docs/deployment-and-costs.md` section 4 ("If file upload is added") -- now true; update it.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0039_syllabus_section_files.sql` -- private bucket (1 MB, `application/pdf`); table `class_syllabus_section_files` (`section_id` fk cascade, `object_path` unique, `file_name`, `size_bytes`, `created_by`, timestamps) with RLS like sections; `storage.objects` policies for that bucket keyed on the class id in the path; a database-side limit of 5 files per section -- storage and access.
- [x] `src/lib/supabase/database.types.ts` -- add the table by hand -- typed queries.
- [x] `src/lib/server/syllabus-files.ts` (new) -- validate (size, `%PDF-`, count), upload, replace, remove, signed link, and `removeStoredFiles` for a section, syllabus or class; an upload whose row insert fails removes its object again -- server logic.
- [x] `src/lib/server/class-syllabus.ts`, `src/routes/admin/classes/+page.server.ts` -- load each section's files; remove stored objects before deleting a section, syllabus or class -- no orphans.
- [x] Both `syllabus/[syllabusId]/+page.server.ts` -- actions `uploadFile`, `replaceFile`, `deleteFile` -- routes.
- [x] New route for opening a file (for example `src/routes/files/syllabus/[fileId]/+server.ts`) -- reads the row under RLS, redirects to a signed URL valid for about a minute, 404 otherwise -- private access.
- [x] `src/lib/components/SyllabusDetail.svelte` (or a new `SyllabusFiles.svelte`), student `+page.svelte` -- file list with name and size; upload, replace, remove for teacher and admin; open link for students -- UI.
- [x] `messages/en.json`, `de.json`, `bo.json` -- new `syllabus_file_*` keys -- translations.
- [x] `src/lib/server/syllabus-files.spec.ts`, `rls.spec.ts`, `e2e/syllabus-sections.e2e.ts` (or a new e2e file) -- every matrix row; storage access per role against the local bucket -- tests.
- [x] `docs/deployment-and-costs.md`, `_bmad-output/manual-verification-issues.md` -- file upload now exists (limits, what a push needs on the hosted project); new numbered log entry "built, to verify" -- records.

**Acceptance Criteria:**
- Given a teacher on a section, when they upload two PDFs, then both are listed for the teacher, the admin and an enrolled student, and each opens as a PDF.
- Given a file's link copied by a student, when someone not in the class opens it, then they get "not found" and no file.
- Given a section with files, when it is deleted, then the bucket holds no object for it.
- Given a phone at 390 px, when the teacher uploads from the section, then the control and the file list fit without sideways scrolling.

## Implementation Notes

- Built 2026-10-08 by the implementation subagent; details in log entry #95 of `_bmad-output/manual-verification-issues.md`.
- Beyond the spec: the file name opens the PDF in a new tab and a separate Download link saves it under its original name (a signed link can show a file or name it, not both); a replace stores a new object and repoints the row; `.pdf` is appended to a name without it.
- Review pass 1: 16 fixes applied, 1 deferred, 10 rejected, see the triage log. A post is read with a byte cap whether or not it declares its length, so an upload does not depend on the `Content-Length` header reaching the Worker.
- Verified after the fixes on a reset database: 1120 unit and database tests, `npm run check` and `npm run build` exit 0; browser tests `syllabus-files.e2e.ts` (9) and `syllabus-sections.e2e.ts` (6) pass on a second reset. The full browser suite was not rerun after the fixes.
- Not verified: the hosted project (whether `db push` may create the bucket and the `storage.objects` policies there), a real phone's file picker and PDF viewer, the 60-second link expiry in the running app (tested with a 1-second link).
- Not committed and not pushed; migration 0039 is local only.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-08). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 / E4-E6 / V-other | Stored files are removed before the section, syllabus or class delete is known to succeed | medium | True of all three callers. The order is the frozen rule (storage failure refuses the delete). Reached only when the final delete fails after removal: a database error, or for a class a student enrolling between the friendly check (`+page.server.ts:200-218`) and the delete. The user is then told only "could not delete". | patch: say that the files were removed and the delete did not finish |
| B2 | "…so nothing was deleted" can be untrue | low | `removeStoredFiles` works in batches and `removeObjects` stops at the first object still there; earlier ones are gone. | patch (wording) |
| B3 / E8 / E9 | Two replaces at once, or a remove racing a replace, leave an object without a row | low | The row update and delete filter on `id` and `section_id`, not on the `object_path` read before. | patch (one filter each) |
| B4 / E1 | `removeObjects` ignores an error from `bucket.exists` | medium | Only `data` is read (`syllabus-files.ts`); a failed lookup counts as "already gone", the row is deleted and the object stays. | patch |
| B5 / E2 / V-other | A post without `Content-Length` skips the size pre-check | low | `Number(null)` is 0, so the body is buffered whole before `readPdfUpload` refuses it. Signed-in callers only (the 401 comes first). | patch |
| B6 | A class teacher could write to the bucket directly, past the content check and the limit of 5 | low | True: the storage insert policy is theirs by design and the bucket checks size and declared type only. Staff acting against their own class; closing it means uploading with the service role. | rejected (low) |
| B7 | `created_by` is not checked against the caller and is not updated by a replace; its foreign key is missing from the hand-written types | low | True; nothing reads `created_by`. | rejected (low) |
| B8 / E10 / E14 / E7 | Objects whose row is gone (failed cleanup, an upload racing a section delete, an old object left by a replace) are only logged and never swept | low | True: `removeStoredFiles` is row-driven. Needs a storage failure or a same-moment race. | patch: log the path and put the check query into the deploy notes; defer the sweep |
| B9 | A signed-out visitor gets a bare "not found" page in a new tab | low | True, and it is what the frozen matrix asks for ("signed out … Not found"). | rejected (intent); reported to the user |
| B10 | `formatFileSize` switches to MB at 1,000,000 bytes but divides by 1,048,576; German shows "1.0 MB" | low | True of `src/lib/syllabus-files.ts`. | patch |
| B11 | The limits are literal text in the messages; Tibetan shows Latin "5" and "1" beside Tibetan-digit sizes | low | True (`messages/bo.json` 194-212); the user asked for Tibetan numbers under the Tibetan interface (#80). | patch |
| B12a | `%PDF-` must be at byte 0 | false | That is the frozen rule ("content starts with `%PDF-`"). | rejected |
| B12b | Fallback name `document.pdf` is not translated; two files may share a name | low | True; cosmetic. | rejected (low) |
| B13a | The student's file list has no heading or label | low | The heading is drawn only with `pending`. | patch (`aria-label`) |
| B13b | The file link opens a new tab unannounced | low | Same as every external link in the app (`TextWithLinks.svelte`). | rejected (pre-existing pattern) |
| B13c | The file input is not disabled while a post runs | false | Disabling it would drop the file from a plain form post; the buttons are disabled. | rejected |
| B13d / E12 | A browser-side "too large" message stays and hides later server messages | low | `shown = localError ?? error`; only the same form's next submit clears it. | patch |
| B14 | The docs say files cost no Worker time; uploads do pass through the Worker. No egress, rollback or orphan note | low | True of `docs/deployment-and-costs.md`. | patch (docs) |
| B15 | `SyllabusDetail.svelte`'s header comment omits the file actions | low | True. | patch |
| E3 | `request.formData()` on a malformed body throws (500, not 400) | low | True of every action in the app. | rejected (pre-existing pattern) |
| E11 | After a refused replacement, choosing the same file again does nothing | low | The hidden input keeps its value, so no `change` fires. | patch |
| E13 | Files sorted by comparing `created_at` strings | low | Needs two uploads in the same second, one with zero microseconds. | rejected (not reachable in practice) |
| V1 | The class delete's refusal when stored files cannot be removed is untested | medium | Filed evidence: `page.server.spec.ts` has no delete case; the e2e covers success only. | patch (test) |
| V2 | The e2e cannot tell the browser-side "over 1 MB" refusal from the server's | low | Filed evidence: same text in the same element; no request assertion. | patch (test) |
| V3 | File route, action wiring and component behaviour are covered by the browser suite only, which is run by hand | low | Pre-existing; already in `deferred-work.md` ("Make `npm run test:e2e` … part of the pre-commit rule"). | rejected (already deferred) |

## Verification

**Commands:**
- `npm run supabase:reset` then `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/syllabus-sections.e2e.ts` (and any new e2e file) on a freshly reset database -- expected: all pass

**Manual checks (if no CLI):**
- Open an uploaded PDF as teacher and as student in the local app; confirm the signed link stops working after it expires.
