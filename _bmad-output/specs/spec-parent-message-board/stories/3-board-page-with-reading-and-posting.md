---
title: 'Board page with reading and posting'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '5c7effe83011aa1aaf3c718ce8e718c1e564151c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The board's database exists (story 1), but no page shows posts or lets anyone write one.

**Approach:** Add `/board`. Every board reader sees posts newest first. Admins, teachers and granted parents see a post form at the top, with a rich-text body and a content language. Every role's navigation gets a Board link. This is SPEC CAP-1 and CAP-2, text only: no files (story 4), no edit or delete (story 5).

## Boundaries & Constraints

**Always:**
- **Guard:**
  - Signed out: redirect `303` to `/login`.
  - Pending students are already redirected by the hook.
  - The load calls the RPC `is_board_reader()`. False or an error gives `error(403)` with a localized message.
  - It also calls `is_board_poster()`, which becomes `canPost`. An error there means `canPost = false`.
- **List:**
  - It reads `board_posts` (`id, author_id, content, content_language, created_at`), ordered by `created_at desc` then `id desc`, at most 30 posts.
  - When 30 come back, the page shows an "Older posts" link to `/board?before=<created_at of the last post>`. That link loads posts strictly older than that time. A `before` value that isn't a valid ISO timestamp is ignored.
  - Author names come from one `board_author_names` call per load with the distinct non-null ids. A null author, or an id with no returned name, shows "Former member".
  - If the posts query fails, the page still renders with `loadError` and a localized message.
  - Each post shows the author name, `formatInstant(created_at, true)` in a `<time datetime>`, and the body through `RichText` with its `lang`.
- **Empty board:** an `EmptyState` with a localized message.
- **Post form:** shown only when `canPost` is true.
  - It has `ContentLanguageSelect` (default `DEFAULT_CONTENT_LANGUAGE`), `RichTextEditor` (`name="content"`, required) and a Post button. They use the `createPending` and `unsaved` patterns from the homework create page.
  - The `post` action:
    - Not signed in: `fail(401)`.
    - `parseContent` returns `required`, `too_large` or `invalid`: `fail(400)` with the matching localized message.
    - Bad language: `fail(400)`.
    - Insert `{author_id: user.id, content, content_language}`, then `.select('id').single()`.
    - Error code 42501: `fail(403)` with a "you can't post on the board" message. Any other error: `fail(500)`.
  - **Success:** a toast, the form resets, and the new post appears first after reload.
- **Navigation:** add `board` to `destinations()` in `src/lib/nav.ts` with a new `NavIcon` `'board'`, mapped in `shell/icons.ts` to a lucide icon such as `MessagesSquare`.
  - Side nav: after calendar for every role.
  - Mobile bottom bar:
    - admin and teacher: in the More sheet, before Help;
    - student and parent: as a tab after calendar.
  - Labels: `nav_board`, both long and short.
- **Page:** `ui.page` → `header` (kicker, `h1`, subtitle) → form card → list. `<svelte:head>` title is "… — Sherab".
- **Text:** new strings go in `board_*` keys in en, de and bo.

**Never:**
- No migration change.
- No file upload, edit, delete or push.
- Never render content as HTML; use `RichText` only.
- Never trust a client-sent author.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reader, not poster | approved student | posts listed; no form | N/A |
| Poster | admin, teacher or granted parent | form and posts | N/A |
| Not a reader | `is_board_reader` false (pending parent) | 403 page | localized |
| Signed out | — | redirect `/login` | N/A |
| Empty board | 0 posts | empty state | N/A |
| 31+ posts | first load | 30 shown, "Older posts" link | N/A |
| `?before=` | valid ISO | strictly older posts | invalid → ignored |
| Unknown author | `author_id` null or no name returned | "Former member" | N/A |
| Posts load error | DB error | page with load-error message | logged |
| Post ok | poster, valid doc | inserted; toast; reset | N/A |
| Empty body | no text | `fail(400)` required | localized |
| Too large | over `MAX_CONTENT_BYTES` | `fail(400)` too_large | localized |
| Refused | 42501 (grant revoked meanwhile) | `fail(403)` | localized |
| Nav | each role | Board link placed per Always | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/leaderboard/+page.server.ts:5-9` -- the plain multi-role guard. `src/routes/calendar/+page.server.ts:58-81` -- `parent()` profile and role use.
- `src/routes/teacher/classes/[id]/homework/new/+page.svelte:74,129-172,295-298` -- page header, `RichTextEditor`, `ContentLanguageSelect`, the `unsaved.submit(pending.submit(...))` pattern.
- `src/lib/server/homework-details.ts:44-58` -- `parseContent` and `isContentLanguage` handling of form data.
- `src/lib/rich-text.ts` -- `parseContent` :164, `readContent` :187, `readContentLanguage` :197, `MAX_CONTENT_BYTES` :33.
- `src/lib/components/RichText.svelte`, `EmptyState`, `PageBreadcrumb` -- rendering pieces.
- `src/lib/format.ts:91` -- `formatInstant`. `src/lib/pending.svelte.ts:35`, `src/lib/unsaved.svelte.ts`, `src/lib/toast.ts:10`.
- `src/lib/nav.ts` -- `NavIcon` :11-23, `destinations()` :62 (calendar :76), the role groups :129-166, `navItems` :179, `tabItems` :212. `src/lib/components/shell/icons.ts` -- icon map. `src/lib/nav.spec.ts` -- nav tests.
- `src/lib/supabase/database.types.ts` -- `board_posts`, `board_author_names`, `is_board_reader` and `is_board_poster`, from story 1.
- Test patterns: `src/routes/calendar/page.server.spec.ts:16,161` (local `fakeSupabase`), `src/routes/leaderboard/page.render.spec.ts` (`svelte/server` render).

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/board/+page.server.ts` -- the guard, load (list, cursor, names) and `post` action.
- [x] `src/routes/board/+page.svelte` -- the page, form and list.
- [x] `src/lib/nav.ts`, `src/lib/components/shell/icons.ts` -- the Board link and icon for every role.
- [x] `messages/{en,de,bo}.json` -- `nav_board` and the `board_*` keys.
- [x] `src/routes/board/page.server.spec.ts` -- every load and action row of the matrix.
- [x] `src/routes/board/page.render.spec.ts` -- the form only with `canPost`; posts with name, time and body; "Former member"; empty state; the "Older posts" link.
- [x] `src/lib/nav.spec.ts` -- Board placement for each role.
- [x] `e2e/board.e2e.ts` -- a granted parent posts; a student signs in and sees it; the student has no form.

**Acceptance Criteria:**
- Given the existing nav and page tests, when they run, then they pass, with expectations updated only for the added Board entry.

## Implementation Notes

- The editor's hidden `content` field is not cleared by a form reset, so after a successful post the language select and editor sit in a `{#key}` block that is bumped (and the language set back to `DEFAULT_CONTENT_LANGUAGE`) inside the submit callback, before the unsaved guard takes its new snapshot.
- `before` is passed to `.lt('created_at', ...)` as the raw string (microseconds kept); the "Older posts" link encodes it, so the `+00:00` offset survives the query string.
- `board_author_names` is skipped when no post has a non-null author (an empty board).
- Existing e2e expectations updated only for the added Board entry: `e2e/shell.e2e.ts` (nav lists, More sheets, student bar label count) and `e2e/credentials.e2e.ts` (student nav link count 5 -> 6).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind | A pending parent sees a Board link that leads to a 403 | medium | The parent shell admits every parent status; `is_board_reader()` is false while pending | patch: nav option |
| 2 | blind | "Older posts" appears with exactly 30 posts and leads to an empty "No posts yet." page | low | `olderBefore` is set whenever 30 rows come back; fixed by fetching 31 | patch |
| 3 | blind | A `?before=` page has no way back, and a post made there doesn't appear | low | No link to `/board`; the post is newer than the cursor | patch: "Newest posts" link |
| 4 | edge-case | Impossible dates (Feb 30) pass `parseBefore`, then Postgres errors | low | `Date.parse` rolls them over; one more check | patch |
| 5 | verification-gap | The `board_author_names` error branch is untested | medium (gap) | The fake never returns a names error | patch: test |
| 6 | blind | `console.error` spies leak between tests, so `toHaveBeenCalled` proves nothing | low | No restore; direct correction | patch |
| 7 | edge-case | The e2e uses `posts.first()`, which a parallel test's post can displace | low | Flake source; locate by text | patch |
| 8 | blind, edge-case, verification-gap | Equal `created_at` on a page boundary skips posts | low | The frozen spec says "strictly older than that time". App posts are separate transactions with microsecond `now()`, so ties need bulk inserts | rejected |
| 9 | blind, edge-case, verification-gap | A names RPC failure shows every author as "Former member" | low | The frozen spec maps a missing name to "Former member"; the error is logged | rejected |
| 10 | blind | An unreadable body renders an empty card | low | Content is validated on insert by `parseContent` and the DB CHECK | rejected |
| 11 | blind | The posts query runs before the reader check | low | RLS returns nothing to a non-reader; one wasted query on the 403 path | rejected |
| 12 | blind | The "Former member" render test can't fail | low | The load tests cover the fallback logic | rejected |
| 13 | blind | e2e misses roles and flows (ungranted parent, pending, teacher, pagination) | low | Covered by unit and RLS tests | rejected |
| 14 | blind | The student bar has 6 tabs; the bo short label is long | low | The 44px target and no-scroll checks pass at 375px | rejected |
| 15 | blind | The kicker repeats the heading | low | Cosmetic | rejected |
| 16 | blind | No focus move or per-post heading after posting | low | Same as the existing create pages | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/board.e2e.ts` -- expected: pass.
