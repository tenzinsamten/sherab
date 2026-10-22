---
title: 'Homework files: PDF attachments per homework'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a4777660ae32679aef1f090c16d15a10e443de90'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-syllabus-section-pdf.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A teacher can attach a PDF to a syllabus section (#95) but not to homework, so a worksheet, lyrics sheet or reading for one homework has to go through an outside link (user, 2026-10-22: "we need option to upload pdf file for homework").

**Approach:** A class's teacher or the admin attaches PDF files when creating a homework or later on its page, replaces one, or removes it. Students the homework is set for, and their approved parents, open them from their homework pages. Files live in a new private Supabase Storage bucket and reuse #95's checks, signed-link serving and cleanup.

## Boundaries & Constraints

**Always:**
- Files belong to the homework (assignment), not to one copy: a weekly homework shows the same files on every copy, as it does its content and links.
- Decided (user, 2026-10-22): at most 5 MB (5,242,880 bytes) per file and at most 2 files per homework; parents of targeted students can open the files (partly reverses #72's "parents see title and links only"); files can be attached on the create form as well as on the homework page.
- Create form: files are checked before the homework is created. A refused file creates nothing and returns the form with everything typed kept (the teacher re-picks the files). If storing a valid file fails after the homework was created, the homework stays, the teacher is told which file was not attached and can add it on the homework page.
- A file is accepted only if its content starts with `%PDF-`, whatever its name or declared type. Size and count limits are checked by the server, and size and type by the bucket too.
- Files are private: the admin and the class's teachers upload, replace and remove; students the homework is set for and their approved parents read; nobody else, signed in or not, can list or fetch one. Enforced by table and storage policies, not only by pages. No public URLs; files open through a short-lived signed link.
- Deleting the class removes the stored objects; nothing is left in the bucket. Archiving a copy keeps the files.
- The original file name is shown and used for download; it is never the storage path.
- Works at 390 px without sideways scrolling. New text in en, de and bo (Tibetan is the assistant's draft, recorded as unreviewed), with Tibetan digits under the Tibetan interface.

**Never:**
- No other file types, no upload by students or parents (no homework submissions). No files on the homework edit form itself; files are managed in their own list on the homework page.
- No new service or dependency beyond Supabase Storage.
- Do not regenerate `database.types.ts`. Do not push the migration, touch the hosted project, or commit before the verification gate passes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload | Valid PDF on a homework with 0 or 1 files | Listed with name and size for teacher, admin, targeted students and their parents | N/A |
| Create with files | New homework (one-off or weekly) with 2 valid PDFs | Homework created with both files | N/A |
| Create, bad file | New homework with an invalid or over-5 MB file | Nothing created; form keeps typed values | File message on the form |
| Create, 3 files | Three PDFs chosen | Nothing created | Message naming the limit of 2 |
| Too large | PDF over 5 MB | Nothing stored | Message naming 5 MB |
| Not a PDF | `.docx`, or `.pdf` whose content is not PDF | Nothing stored | "PDF files only" |
| Third file | Homework already has 2 | Nothing stored; upload control hidden | Message naming the limit of 2 |
| Replace | Valid PDF for an existing file | Same position, new name and size; old object removed | Invalid file: old one stays |
| Remove | Confirmed | Row and stored object gone | Cancelled: nothing happens |
| Weekly copy | New copy made by the nightly job | Shows the series' files | N/A |
| Outsider | Other class's teacher, student not set the homework, parent of an untargeted child, signed out, guessed link | Not found | No object, no signed link |
| Wrong class | File id from another class in a post | Nothing changed | 400, generic error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0039_syllabus_section_files.sql` -- model to copy: private bucket via `insert into storage.buckets ... on conflict`, files table with `object_path` regex check, count-limit trigger (`SF001`), path-id helper `syllabus_file_path_id`, `storage.objects` select/insert/delete policies, no update policy, no SQL delete cleanup (`storage.protect_delete`). New migration `0053_homework_files.sql`: bucket `homework-files`, table `homework_assignment_files` (`assignment_id` fk cascade), path `<class_id>/<assignment_id>/<file_id>.pdf`.
- RLS helpers: `is_admin()` (0001:86), `is_teacher_of_class` (0001:104), `is_targeted_for_homework_assignment` (0004:153), `is_parent_targeted_for_homework_assignment` (0025:66). Read policy mirrors `homework_assignments` select (0025:158-175), parent branch included. Bucket `file_size_limit` 5242880; trigger limit 2.
- `src/lib/server/syllabus-files.ts` -- generic: `isUuid`, `cleanFileName`:51, `readPdfUpload`:67, `readFileForm`:120 (body byte cap, 413; the cap must become a parameter: homework page posts ~5 MB + 64 KB, the create post 2 x 5 MB plus the rich-text content), `storeObject`:190, `isGone`, `removeObjects`:239. Move these into a shared `src/lib/server/pdf-files.ts` parameterised by bucket, limit and messages; syllabus behaviour and its tests stay unchanged. New `src/lib/server/homework-files.ts` for upload/replace/delete/list/signed link/`removeStoredFiles`.
- `src/lib/syllabus-files.ts` -- `formatFileSize`, limit messages; share the same way.
- `src/routes/files/syllabus/[fileId]/+server.ts` -- serving pattern; new `src/routes/files/homework/[fileId]/+server.ts` (303 to a 60 s signed URL, `?download`, 404 otherwise).
- `src/lib/components/SyllabusFiles.svelte` -- list and multipart forms; generalise or add `HomeworkFiles.svelte`.
- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.server.ts` (actions incl. `editAssignment`:219) and `+page.svelte` (links :173, edit form :199) -- add `uploadFile`, `replaceFile`, `deleteFile` and the list. No admin homework route exists.
- `src/routes/teacher/classes/[id]/homework/new/` -- `createAssignment`:49 (one-off insert :124, series insert :236), form :105 becomes `enctype="multipart/form-data"`; check files first, attach after the insert.
- `src/routes/student/homework/[instanceId]/` -- load reads the assignment (:29); render files after `TextWithLinks` (:105-112). Files key on `assignment_id`.
- `src/routes/parent/homework/` -- list files next to the links (mapped :71, rendered `+page.svelte`:120-122).
- `src/routes/admin/classes/+page.server.ts:267` -- class delete; also remove homework objects first.
- `src/lib/supabase/database.types.ts` -- add the table by hand. `messages/{en,de,bo}.json` -- new `homework_file_*` keys.
- Tests: `src/lib/server/syllabus-files.spec.ts` (pattern), `rls.spec.ts`, `src/routes/admin/classes/page.server.spec.ts`, `e2e/syllabus-files.e2e.ts` (pattern for a new `e2e/homework-files.e2e.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0053_homework_files.sql` -- bucket, table, RLS, count trigger, storage policies -- storage and access.
- [x] `src/lib/supabase/database.types.ts` -- add `homework_assignment_files` by hand -- typed queries.
- [x] `src/lib/server/pdf-files.ts` (new), `syllabus-files.ts` -- extract shared helpers, syllabus behaviour unchanged -- reuse.
- [x] `src/lib/server/homework-files.ts` (new) -- upload, replace, delete, list, signed link, `removeStoredFiles` for a class -- server logic.
- [x] Teacher homework detail `+page.server.ts` / `+page.svelte` -- `uploadFile`, `replaceFile`, `deleteFile`, list -- manage files.
- [x] Teacher `homework/new` `+page.server.ts` / `+page.svelte` -- optional file picker (up to 2), checked before create, attached after -- attach on create.
- [x] Student `homework/[instanceId]` and `parent/homework` load and pages -- list files with open and download -- read access.
- [x] `src/routes/files/homework/[fileId]/+server.ts` -- private serving.
- [x] `src/routes/admin/classes/+page.server.ts` -- remove homework objects before class delete -- no orphans.
- [x] `messages/*.json` -- `homework_file_*` keys.
- [x] `src/lib/server/homework-files.spec.ts`, `rls.spec.ts`, `page.server.spec.ts`, `e2e/homework-files.e2e.ts` -- every matrix row, storage access per role.
- [x] `docs/deployment-and-costs.md`, `_bmad-output/manual-verification-issues.md` -- new bucket and limits; log #110 "built, to verify".

**Acceptance Criteria:**
- Given weekly homework with two files, when the nightly job makes the next copy, then a targeted student sees both files on it.
- Given a class with homework files, when the admin deletes the class, then the bucket holds no object for it.
- Given the existing syllabus file tests, when the shared helpers are extracted, then they pass unchanged.

## Implementation Notes

- Built 2026-10-22 by the implementation subagent; log entry #110 in `_bmad-output/manual-verification-issues.md`.
- Object names are `<class_id>/<assignment_id>/<random uuid>.pdf` (not the row id), as in #95: a replace stores a new object and repoints the row.
- Shared code: `src/lib/server/pdf-files.ts` (uuid check, file name, PDF check with a size parameter, capped form reading with a size parameter and the caller's refusals, store, remove, remove-or-log, signed link) and `src/lib/pdf-files.ts` (`formatFileSize`, `PdfFile`). `syllabus-files.ts` keeps its exports as thin wrappers; `syllabus-files.spec.ts` is unchanged and passes.
- Post caps: homework page 5 MB + 64 KB; create form 2 x 5 MB + 1,000,000 bytes (rich-text cap) + 128 KB.
- Create form: file problems return `fileError` (shown under the field) and `error` (the usual toast); the browser refuses more than 2 files or one over 5 MB before posting. Files are attached after every rollback point of the one-off path (and before the "new homework" announcement); for a series right after the insert. Files that could not be attached go to the list page as `notAttached` parameters and a warning toast names them.
- Class delete: syllabus objects first, then homework objects; a homework storage failure refuses the delete with the existing `syllabus_file_error_storage` text.
- The create form now posts as multipart; `capturePosts` in `e2e/teacher.e2e.ts` and `e2e/teacher-mobile.e2e.ts` read it through the new `postedFields` helper in `e2e/fixtures.ts`.
- Verified on a reset database: `npm test` 1658 tests exit 0, `npm run check` 0 errors, `npm run build` exit 0, `npx playwright test e2e/homework-files.e2e.ts e2e/syllabus-files.e2e.ts` 17 passed (after a second reset), homework tests in `teacher.e2e.ts` and `teacher-mobile.e2e.ts` 43 passed. Full browser suite not run.
- Not verified: the hosted project (bucket and `storage.objects` rules via `db push`), a real phone's file picker, the Tibetan wording. Not committed, not pushed.

- Review pass 1 (2026-10-22): 8 patches applied (class-delete "removed, not finished" wording; remove-specific messages `homework_file_error_remove_failed` / `_remove_unfinished`; `fileError` on the create 413; `formatFileSize` switches to MB at 1024 KB; memory peak in the docs; tests for the notAttached toast, attach-after-rollback and the update policy), 1 deferred, 13 rejected. The `formatFileSize` fix changes one assertion in `syllabus-files.spec.ts` (`MAX_FILE_BYTES - 1` now "1.0 MB", was "1024 KB"): a deliberate behaviour fix, so that AC holds except for that line.
- Verified after the patches on a reset database: `npm test` 1663 tests, `npm run check`, `npm run build` exit 0; browser tests homework-files, syllabus-files, teacher and teacher-mobile: 112 passed, 1 failed. The failure ("Reset PIN", #88) also fails on `main` a477766 and is logged as #112; not caused by #110.
- Found and logged, not fixed: #111 (homework list crashes on a direct load with `?created=`, pre-existing).

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-22). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| E1 / B4 | Class delete: syllabus files removed, then homework removal fails; class stays without its syllabus files, admin told only "stopped" | medium | `admin/classes/+page.server.ts:268-273` removes syllabus objects and rows before the homework removal can fail | patch: "removed, delete did not finish" wording when anything was removed; test |
| B1 | Remove failures say "Could not save the file"; a row left after its object was removed is not explained | low | `deleteFile` returns `homework_file_error_failed` on every failure | patch: remove-specific and half-removed messages |
| E3 | 413 on the create post has no `fileError`, so the file field is not marked | low | `readCreateForm` tooLarge returns `error` only | patch |
| E4 | 1,048,064-1,048,575 bytes shows "1024 KB" | low | `formatFileSize` rounds to 1024 below `BYTES_PER_MB` | patch (direct correction) |
| B5 | Docs understate the create post's memory peak | low | `readFileForm` holds chunks and joined bytes, then FormData and PDF copies | patch (docs) |
| V1 | notAttached warning and URL cleanup untested | low | Filed: only the redirect string is asserted | patch (test) |
| V2 | Attach-after-rollback order untested | medium | Filed: empty roster mock, the all-failed rollback never runs | patch (test) |
| V3 / B9a | Update policy folder check and column grant untested | medium | Filed: only insert-side folder test exists | patch (test) |
| V4 | Files read error (`filesError`, `loadError`) untested | low | Filed: parent spec ids are not uuids, no load spec for student/teacher | defer (as filed) |
| E2 / B3 | `deleteFile` reads its form without a size cap | low | Same as syllabus `deleteFile` (`syllabus-files.ts:308`) and every other action in the app | rejected (pre-existing pattern) |
| E5 / B6 | Crafted `notAttached` link puts text in a teacher's toast | low | Rendered as text, needs a teacher to open a crafted link; fix needs server-side flash state | rejected (low) |
| E6 | Rowless objects from failed cleanups survive class delete | low | Only after a logged storage failure; orphan query in 0053 header, as #95 B8 | rejected (low, documented) |
| B2 | Row whose object is gone gives a storage error page | low | Needs a failed row delete right after object removal; same as syllabus | rejected (low) |
| B7 | `cleanFileName` keeps format characters; cuts mid-grapheme | low | Moved unchanged from #95; teacher-chosen names | rejected (pre-existing, low) |
| B8 | Storage read policy does not check class/homework pairing in the path | low | Insert policy enforces the pairing; only service role could write a mismatched path | rejected (low) |
| B9b | No RLS test for pending parent or student who left the class | low | Reuses `is_parent_targeted_*` / `is_targeted_*` helpers already covered by the 0025 tests | rejected (low) |
| B10 | No file indicator on list pages | low | Intent: files are opened from the homework pages | rejected (intent) |
| B11 | Parent files error uses the generic load message | low | Needs a failed read; generic message still signals a problem | rejected (low) |
| B12 | Limits defined in four places without a drift check | false | Bucket size and the 2-file trigger are each pinned by RLS tests (`rls.spec.ts` 0053 block) | rejected |
| B13 | File endpoint has no unit test | low | e2e covers open, download and outsiders' 404 | rejected (low) |
| B14 | Tibetan text unreviewed | low | Already recorded in the #110 log entry; not code | rejected (recorded) |

## Verification

**Commands:**
- `npm run supabase:reset` then `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npx playwright test e2e/homework-files.e2e.ts e2e/syllabus-files.e2e.ts` -- expected: all pass
