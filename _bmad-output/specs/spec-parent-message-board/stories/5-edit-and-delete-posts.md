---
title: 'Edit and delete posts'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '144e1638d2f4311667a074dfe60e340ba05de29d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Once posted, a board post can't be fixed or removed. Authors can't correct a mistake, and admins and teachers can't take down an unsuitable post.

**Approach:** On `/board`:
- the author of a post gets Edit and Delete;
- an admin or a teacher gets Delete on every post.

Edit changes the body and its language in place. Delete, after a confirmation, removes the post's stored files first, then the post. This is SPEC CAP-3. RLS (story 1) stays the barrier.

## Boundaries & Constraints

**Always:**
- **Who sees which control:**
  - The load gives each post `mine` (`author_id === user.id`).
  - It also gives `canModerate` for the page: the profile's role is `admin` or `teacher`, read through `parent()`. RLS checks `profiles.role`, not the active role.
  - Edit shows only when `mine` and `canPost`.
  - Delete shows when `mine` or `canModerate`.
  - Admins and teachers never get Edit on someone else's post.
- **Edit:**
  - The Edit button swaps the post body for a form inside the card: `ContentLanguageSelect` and `RichTextEditor`, filled with the current content, plus Save and Cancel. Only one post is in edit mode at a time. Cancel restores the view.
  - The `edit` action reads `postId`, `content` and `contentLanguage`:
    - Not signed in: 401.
    - Bad UUID: 400.
    - `parseContent` and the language are checked as in `post`, giving 400 messages.
    - It updates `{content, content_language, updated_at: now}` where `id = postId`, with `.select('id')`. 0 rows or 42501 gives 403 with a localized message. Any other error gives 500.
  - Success: a toast, and edit mode closes.
  - Files are unchanged by an edit.
- **Edited marker:** when `updated_at` is more than 1 minute after `created_at`, the post shows "Edited" after its time. The load exposes `updatedAt`.
- **Delete:**
  - A destructive `ConfirmDialog` asks first.
  - The `delete` action reads `postId`:
    - Not signed in: 401.
    - Bad UUID: 400.
    - It reads the post's `board_post_files.object_path`, then removes those objects with `removeObjects` (the board store).
    - If the removal doesn't confirm every object is gone: 500, and the post is kept, so no orphans.
    - Then it deletes the post with `.select('id')`. 0 rows gives 403 (not allowed, or already gone). File rows cascade.
  - Success: a toast; the post is gone after reload.
- **Pending UI:** both actions use `createPending`, with keys per post. Buttons have accessible names that include the author.
- **Text:** new strings go in `board_edit_*` and `board_delete_*` keys in en, de and bo.

**Never:**
- No migration change.
- No push (story 6).
- No adding, replacing or removing single files while editing.
- No edit by moderators.
- Don't delete the post row before its objects are confirmed gone.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Author, still a poster | own post | Edit and Delete shown | N/A |
| Author, grant revoked | own post, `canPost` false | Delete only | N/A |
| Admin or teacher | another's post | Delete only | N/A |
| Student or other parent | another's post | no controls | N/A |
| Edit ok | valid doc | updated; toast; "Edited" shown | N/A |
| Edit empty | no text | 400 required | localized |
| Edit refused | 0 rows or 42501 | 403 | localized |
| Delete ok with files | 2 files | objects removed, then the post; toast | N/A |
| Object removal fails | storage error | 500; post kept | localized |
| Delete refused | 0 rows (another parent, or already gone) | 403 | localized |
| Bad id | not a UUID | 400 | localized |
| Not signed in | either action | 401 | localized |

</frozen-after-approval>

## Code Map

- `src/routes/board/+page.server.ts`:
  - `BoardPost` :40, load :57 (`canPost` :90, posts mapping :133, return :144), and the `post` action :148, whose content and language checks to reuse.
  - Use `parent()` for the profile role, as in `src/routes/calendar/+page.server.ts:58-81`.
- `src/routes/board/+page.svelte` -- the post list (:212-230), `createConfirm` and `ConfirmDialog` (:27, :56, :256), and the post form (:141) to reuse for the inline editor.
- `src/lib/server/board-files.ts` -- the store constants. Add a helper that removes a post's objects, using `removeObjects` from `src/lib/server/pdf-files.ts:179` (true only when every object is confirmed gone).
- `src/lib/components/RichTextEditor.svelte` -- check how it takes an initial document.
- An existing destructive-confirm example: `src/routes/admin/parents/+page.svelte` remove form (`confirm.ask(…, { destructive: true })`).
- Tests: `src/routes/board/page.server.spec.ts` (local `fakeSupabase` with a storage fake), `page.render.spec.ts`, `src/lib/server/board-files.spec.ts`, `e2e/board.e2e.ts`. The e2e `afterAll` already removes objects before posts.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/board-files.ts` -- the remove-post-objects helper.
- [x] `src/routes/board/+page.server.ts` -- `mine`, `canModerate` and `updatedAt` in the load; the `edit` and `delete` actions.
- [x] `src/routes/board/+page.svelte` -- the controls, the inline edit mode, the confirm dialog, the toasts, the "Edited" marker.
- [x] `messages/{en,de,bo}.json` -- the new keys.
- [x] `src/routes/board/page.server.spec.ts`, `src/lib/server/board-files.spec.ts` -- every action and load row of the matrix, including the order: objects before the row.
- [x] `src/routes/board/page.render.spec.ts` -- which controls show for each viewer; the "Edited" marker.
- [x] `e2e/board.e2e.ts` -- the author edits, then deletes a post with a PDF (the object is gone); a teacher deletes a parent's post; a student sees no controls.

**Acceptance Criteria:**
- Given the story 3 and 4 board tests, when they run, then they pass, with fixtures extended only by the new fields.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | all three | A non-author deleting a post with files gets 500, not 403 | medium | Storage RLS filters the remove silently and `removeObjects` sees the object still there; the matrix says 403 | patch: permission pre-check |
| 2 | verification-gap | An edit keeping a non-default language is untested | medium (gap) | The e2e post uses `en`; the render spec never opens the form | patch: e2e |
| 3 | blind, edge-case | Pressing Edit on another post discards unsaved changes | medium | Other Edit buttons stay enabled; the unsaved guard covers navigation only | patch: disable them |
| 4 | blind | Edit filters only by `id` | low | One `.eq` gives defense in depth for "moderators never edit" | patch |
| 5 | blind | Edit and delete buffer the body with no cap | low | `request.formData()` directly; the post action caps its body | patch |
| 6 | blind | The delete confirmation always mentions files | low | Wording variant | patch |
| 7 | all three | Objects removed, then a row delete failure leaves broken file links | low | A non-RLS DB error after the storage removal; a retry succeeds because missing objects count as gone | rejected |
| 8 | blind, edge-case | `updated_at` uses the app clock, `created_at` the DB clock | low | The 1-minute threshold absorbs normal skew; the frozen spec forbids a migration | rejected |
| 9 | blind | Saving with no change marks the post "Edited" | low | Needs a compare branch; rare | rejected |
| 10 | blind | No focus management on edit, cancel or delete | low | Same as the existing inline forms | rejected |
| 11 | blind | No e2e for a moderator deleting a post with files | low | The story 1 RLS "Objects" test covers teacher removal against real storage | rejected |
| 12 | edge-case | Folder objects without rows survive a delete | low | Only from a failed story 4 cleanup, which is logged | rejected |
| 13 | edge-case | Editing a post deleted meanwhile says "can't edit" | low | The message is still true | rejected |
| 14 | blind | No component-level edit form test | low | The e2e covers fill, save and close | rejected |
| 15 | blind | "Edited" has no edit time | low | Not in the spec | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/board.e2e.ts` -- expected: pass. Reset the DB again afterwards, before any `npm test`.
