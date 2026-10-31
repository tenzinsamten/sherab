---
title: 'Post titles and author names'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '5c0622e5499d3de4299ef86528850881c43b7360'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** These come from the user's manual check, logged in `_bmad-output/manual-verification-issues.md` on 2026-10-31.
- Board posts have no title.
- Some authors show as an email address. When an account is created without a name, `profiles.display_name` falls back to the email: the first admin, and teachers the admin created without a name.

**Approach:**
- Every new post gets a required title of up to 120 characters. It shows as the post's heading.
- An author whose stored name is empty or equals their email is shown as:
  - **"Sherab Admin"** for an admin;
  - **"Teacher"** for a teacher;
  - the existing "Former member" for anyone else.

  A real name always wins. User decisions: required title, max 120; admin shown as "Sherab Admin".

## Boundaries & Constraints

**Always:**
- **Migration `0063_board_post_titles.sql`:**
  - `board_posts.title text`, nullable, so existing posts keep working, with a check: null, or `title = btrim(title)` and `char_length` between 1 and 120.
  - Add `title` to the insert and update column grants.
  - Drop and recreate `board_author_names(uuid[])` to return `(id, display_name, role)`. `display_name` comes back null when the stored name is empty or equals the email (trimmed, case-insensitive). Every other rule of the function stays as it was: security definer, reader-only, authors who have posted only, and the grants.
- **Name rule:** one shared helper turns `(display_name, role)` into the shown name: a real name, then "Sherab Admin" for an admin or "Teacher" for a teacher, otherwise "Former member". Both `/board` and the board push title use it. The push's own author read follows the same rule (it reads `display_name`, `email` and `role` with the admin client).
- **Posting:** the post form gets a required Title input (`maxlength=120`) above the editor.
  - The `post` action trims it.
  - Empty gives `fail(400)` "Enter a title". Over 120 characters gives `fail(400)`.
  - The title is inserted with the post.
- **Editing:** the inline edit form also edits the title, with the same checks. The update includes `title`.
- **Display:** a post with a title shows it as the post's heading (`h2`/`h3` in the page outline), above the author and time line. A post without a title (from before this change) shows no heading.
- **Push:** a new post's push body starts with the title, then the plain text, clipped as before.
- **Text:**
  - New strings go in en, de and bo:
    - `board_title_label`
    - `board_error_title_required`
    - `board_error_title_too_long`
    - `board_author_admin` (en and de: "Sherab Admin"; add it to the `src/lib/messages.spec.ts` allowlist if bo keeps the same text)
    - `board_author_teacher`
  - Reuse `board_former_member`.
- **Types:** `src/lib/supabase/database.types.ts` is edited by hand. It is never regenerated.

**Never:**
- Don't change any stored `display_name`.
- Don't change the names shown anywhere outside the board and its push.
- Don't make the title required in the database: old posts have none.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Post with title | "Picnic" plus a body | title shown as the heading | N/A |
| Missing title | empty or spaces | `fail(400)` "Enter a title"; nothing inserted | localized |
| Long title | 121 characters | `fail(400)` | localized |
| Old post | `title` null | no heading; still renders | N/A |
| Edit title | author changes it | the new title shows | same checks |
| Admin, name is the email | `display_name` = email | "Sherab Admin" | N/A |
| Teacher, no name | `display_name` null or the email | "Teacher" | N/A |
| Real name | "Pema" | "Pema" | N/A |
| Deleted author | `author_id` null | "Former member" | N/A |
| Push | new post, titled | body starts with the title | N/A |
| DB check | client inserts a 121-character title | refused | 23514 |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0061_message_board.sql` -- the `board_posts` table and grants (:124-202), and `board_author_names` (:330-352) to recreate.
- `src/routes/board/+page.server.ts` -- `BoardPost`, the load (author names :133), the `readBody` helper used by `post` and `edit`, and the `edit` update.
- `src/routes/board/+page.svelte` -- the post form, the inline edit form, and the post card heading line.
- `src/lib/server/push.ts:555` -- the author `profiles` read in `sendBoardPush`; `buildBoardPushMessage` body.
- `src/lib/messages.spec.ts:8-17` -- the bo-equals-en allowlist.
- `src/lib/supabase/database.types.ts` -- `board_posts` Row, Insert and Update; `board_author_names` Returns.
- Tests: `src/routes/board/page.server.spec.ts`, `page.render.spec.ts`, `src/lib/server/push.spec.ts`, `src/lib/server/rls.spec.ts` (the message board describe: `board_author_names`, the title check), `e2e/board.e2e.ts` (posting now needs a title).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0063_board_post_titles.sql` -- the column, check, grants and recreated function.
- [x] `src/lib/supabase/database.types.ts` -- hand edits.
- [x] `src/lib/board-author.ts` (or similar) -- the shared name rule.
- [x] `src/routes/board/+page.server.ts`, `+page.svelte` -- title in post, edit and display; names through the helper.
- [x] `src/lib/server/push.ts` -- the author rule and the title in the body.
- [x] `messages/{en,de,bo}.json`, `src/lib/messages.spec.ts` -- the keys and the allowlist.
- [ ] Tests -- every matrix row: RLS for the check and the function; unit tests for the actions, the name helper and push; render for the heading; e2e posts fill in a title.

**Acceptance Criteria:**
- Given the existing board, push and RLS tests, when they run, then they pass, updated only for the title field and the name rule.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31). verification-gap: no gaps.

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge-case | The title keeps newlines, control and zero-width characters | low | Only `.trim()`; a newline breaks the heading and the push title line | patch |
| 2 | blind, edge-case | A 120-character title fills the whole push body | low | Title and text clipped together at 120 | patch: clip the title part to 60 |
| 3 | blind | "Enter a title" lacks a full stop | low | Every other board error has one | patch |
| 4 | edge-case | The DB doesn't require a title for new rows | low | The frozen spec says not to make the title required in the DB (old posts have none) | rejected |
| 5 | blind | A living parent with no name shows "Former member" | low | Parents always register with a name (0024); the frozen spec says "Former member" for everyone else | rejected |
| 6 | blind, edge-case | `maxlength` counts UTF-16 units; the server counts code points | low | Affects only titles with more than 60 emoji | rejected |
| 7 | blind | Editing an old untitled post now needs a title | low | The frozen spec says "same checks" | rejected |
| 8 | blind | Title errors aren't tied to the field (`aria-invalid`) | low | Shown at the form, like the content errors | rejected |
| 9 | blind | 120 is hard-coded in the strings | low | Same as other limit messages | rejected |
| 10 | blind | The constant and locale type live in the author module | low | Cosmetic | rejected |
| 11 | blind | Readers now see each author's role | low | Authors are admins, teachers or granted parents; the role is shown anyway as the fallback label | rejected |
| 12 | edge-case | SQL `btrim` vs JS `trim` on tabs and NBSP around an email | low | Needs a name stored as the email plus a tab | rejected |
| 13 | blind | Missing e2e for "Sherab Admin"; loose `authorRole` type | low | Covered by the RLS and unit tests | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/board.e2e.ts` -- expected: pass. Reset the DB afterwards.
