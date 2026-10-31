---
title: 'Preview list, expand in place, one image per post'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: 'a0548f4d62111a3bf55f005dbbe69b677d91dd20'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The user's manual check (`_bmad-output/manual-verification-issues.md`, 2026-10-31, items 3 and 4) found two things:
- the board shows every post in full, which makes the list long;
- PDFs are the wrong kind of attachment for a school board.

**Approach:** Two changes, both decided by the user:
- **List:** each post shows its title, author and time, a short text preview, and its image.
  - Clicking "…see more" (or the preview) expands the full text in place, like LinkedIn. "See less" collapses it. There's no details page.
- **Image:** a post carries **at most 1 image** (JPEG, PNG or WebP, up to 5 MB) instead of up to 2 PDFs.
  - The image shows in the list under the preview. Tapping it opens it full size.

## Boundaries & Constraints

**Always:**
- **Migration `0064_board_images.sql`:**
  - Bucket `board-files`: `allowed_mime_types` = `image/jpeg`, `image/png`, `image/webp`; limit 5242880.
  - The `board_post_files.object_path` check, and the storage insert name regex, accept `<post_id>/<uuid>.(jpg|png|webp)`. The table check also still accepts `.pdf`, for rows made before this change.
  - The file-row limit trigger refuses a second file with `BF001`.
  - The storage insert policy allows an upload only when the post's folder holds 0 objects.
  - Every other rule from stories 1 and 5 is unchanged.
- **Server checks:**
  - One `image` form field.
  - The type comes from magic bytes, never the name or the MIME type sent:
    - JPEG starts `FF D8 FF`;
    - PNG starts `89 50 4E 47 0D 0A 1A 0A`;
    - WebP is `RIFF????WEBP`.
  - Any other type is refused with 400 and a message naming the allowed types.
  - Over 5 MB gives 400. More than one file gives 400.
  - The body cap is 5 MB + `MAX_CONTENT_BYTES` + overhead, with a 413 message naming the limits.
  - Order and rollback as in story 4: everything is checked before the insert, and the image is attached after it. A failed attach keeps the post and returns `notAttached`.
- **Storing:** upload with the detected content type to `<post_id>/<uuid>.<ext>`, `upsert: false`. Use a board image helper; don't change `storeObject` in `pdf-files.ts`, which homework uses.
- **Reading:**
  - The load signs the images on the page in one `createSignedUrls` call, valid for 1 hour, and gives each post `image: {id, url, name} | null`.
  - A signing failure shows the post without its image, and logs it.
  - A legacy `.pdf` row still shows as a download link through `/files/board/[fileId]`.
- **List card, top to bottom:**
  - the title as a heading;
  - the author, time and "Edited" line;
  - the preview;
  - the image;
  - the controls (Edit, Delete) as now.
- **Preview:**
  - Collapsed, the body is clamped to 3 lines with CSS (`line-clamp-3`).
  - A "…see more" button shows when the post is long: the server sets `long` when the body's plain text is over 200 characters or has more than 3 blocks.
  - The button toggles `aria-expanded` and controls the body's id. Expanded, the full body shows and the button reads "See less".
  - Clicking the preview text also expands it.
  - Expanded state is per post and isn't remembered across loads.
- **Image in the list:**
  - `<img>` with `loading="lazy"`, `alt` = the post title (or "Image" for an untitled legacy post), a max height of about 24rem, `object-cover`, full card width, rounded.
  - It is wrapped in a link to the signed URL (`target="_blank" rel="noopener"`) to open it full size.
- **Post form:**
  - One file input (`accept="image/jpeg,image/png,image/webp"`, not `multiple`), labelled "Image (optional)", with a hint naming the types and 5 MB.
  - A client check of size and type refuses before sending, with an inline error, as story 4 did.
- **Editing** doesn't change the image. Delete removes the image object first, as in story 5.
- **Text:** new `board_image_*` keys in en, de and bo. Remove the PDF-only board strings that are no longer used.
- **Tests:**
  - Update the story 4 PDF tests to images, using small valid JPEG, PNG and WebP byte headers.
  - Keep `BoardFiles.svelte` only if legacy PDFs need it. Otherwise delete it and its `tailwind.css` `@source` entry.

**Never:**
- No details page.
- No more than one image.
- No image editing or replacing in edit mode.
- No image resizing or processing on the server.
- No change to homework files.
- No change to push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Post with JPEG | valid 2 MB JPEG | stored `.jpg`; shown in the list | N/A |
| PNG / WebP | valid files | stored `.png` / `.webp` | N/A |
| No image | empty field | text post | N/A |
| Wrong type | PDF or GIF bytes | 400 naming the types; no post | localized |
| Renamed file | `photo.jpg` with PDF bytes | 400 | localized |
| Too big | 5,242,881 bytes | 400; no post | localized |
| Two files | 2 in the field | 400 | localized |
| Body over the cap | huge request | 413 | localized |
| Second upload by API | folder already has 1 object | refused by storage RLS | N/A |
| Second row by API | post already has a file row | `BF001` | N/A |
| Long post | 500-character body | clamped, with "…see more"; expands and collapses | N/A |
| Short post | 50 characters, 1 block | no button | N/A |
| Signing fails | storage error | post without its image | logged |
| Legacy PDF row | `.pdf` file | download link | N/A |
| Delete post with image | author | object removed, then the post | as story 5 |
| Client check | 6 MB or GIF chosen | inline error; nothing sent | localized |

</frozen-after-approval>

## Code Map

- `src/lib/server/board-files.ts` -- `readPostForm` :61, `readPostFiles` :77 (it uses `readPdfUpload` :88), the attach code (it uses `storeObject` :121), `attachPostFiles` :151, `loadBoardFiles` :173, `removePostObjects` :207, `signedBoardFileUrl` :233.
- `src/lib/board-files.ts` -- the client-side limits and messages.
- `src/lib/server/pdf-files.ts` -- the generic helpers (`readFileForm`, `removeObjects`). Don't change their PDF behaviour.
- `src/routes/board/+page.server.ts` and `+page.svelte` -- the load, `post`, `edit` and `delete`; the post form; the post card.
- `src/lib/components/BoardFiles.svelte`, `src/lib/ui/tailwind.css` -- the old file list and its source entry.
- `src/routes/files/board/[fileId]/+server.ts` -- the legacy file endpoint. Keep it working for any row.
- `supabase/migrations/0061_message_board.sql` -- the checks, policies, `board_file_object_count` and the limit trigger being changed.
- Tests: `src/lib/server/board-files.spec.ts`, `src/routes/board/page.server.spec.ts`, `page.render.spec.ts`, `src/routes/files/board/[fileId]/server.spec.ts`, `src/lib/server/rls.spec.ts` (the message board block: bucket, uploads, the third file), `e2e/board.e2e.ts` (the PDF upload tests become image tests).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0064_board_images.sql` -- the bucket, checks, policies and limit.
- [x] `src/lib/server/board-files.ts`, `src/lib/board-files.ts` -- the image read, magic-byte check, store, signed URLs, limits and messages.
- [x] `src/routes/board/+page.server.ts` -- one image in `post`; `image` and `long` per post in the load.
- [x] `src/routes/board/+page.svelte` -- the card layout, preview clamp, see more and see less, image, form field and client check.
- [x] `messages/{en,de,bo}.json` -- the keys added and removed.
- [ ] Tests -- every matrix row, at the right layer (RLS, unit, render, e2e).

**Acceptance Criteria:**
- Given the existing board, homework file and push tests, when they run, then they pass, with the board PDF tests converted to images.

## Implementation Notes

- Only `long` posts are clamped, so a short post is never cut without a "see more" button.
- `BoardFiles.svelte` is kept for legacy `.pdf` rows.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge-case | Signed image URLs expire after 1 hour; lazy images and links break | medium | 3600 s token; no refresh | patch: use the `/files/board/{id}` endpoint |
| 2 | blind | The table still accepts new `.pdf` rows | medium | The check allows `.pdf` for every insert; the bucket refuses PDFs, so the row points at nothing | patch: `NOT VALID` image-only check |
| 3 | blind, edge-case | The client check trusts `file.type`, and checks size before type | low | An empty type refuses a valid image; a GIF is told "too large" | patch |
| 4 | blind, verification-gap | The stored name's extension can disagree with the real type; truncation is untested | low | `odd.jpg` with PNG bytes | patch |
| 5 | verification-gap, blind | The delete confirmation says "files"; image-only wording is untested | low | Wording; no assert | patch |
| 6 | edge-case, blind | Drag-selecting text expands the preview | low | Any click expands | patch |
| 7 | blind | The image link's only name is the title; it opens a new tab silently | low | a11y | patch |
| 8 | verification-gap | The not-attached warning toast is untested | medium (gap) | Already deferred in story 4 | defer (existing entry) |
| 9 | verification-gap, blind | A link click inside the preview is untested | low | Cosmetic | rejected |
| 10 | blind, edge-case | `long` is a server guess; Tibetan counted in code points | low | The frozen spec sets the rule (200 characters / 3 blocks) | rejected |
| 11 | blind | Each view re-downloads full images; no width/height | low | Same-size images; no server resizing (Never) | rejected |
| 12 | blind | The e2e image fixture isn't decodable | low | Bytes and content type are checked | rejected |
| 13 | blind | Image types are defined in several places | low | Migration vs TS can't share a constant | rejected |
| 14 | blind | `notAttached` is a list for one image | low | Cosmetic | rejected |
| 15 | blind | A failed cleanup blocks later uploads | low | Edit can't add images anyway; the post can be reposted | rejected |
| 16 | blind | The 413 message is vague | low | Wording | rejected |
| 17 | edge-case | Delete confirm wording when signing fails | low | Superseded by #1 (no load-time signing) | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx supabase db reset`, then `npx playwright test e2e/board.e2e.ts` -- expected: pass. Reset the DB afterwards.
