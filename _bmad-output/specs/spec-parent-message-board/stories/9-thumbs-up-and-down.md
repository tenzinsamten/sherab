---
title: 'Thumbs up and down on posts'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '5065b985e6e69818a06d186bb064b4c3c8c72c69'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Readers can't respond to a post at all. The user asked for 👍 and 👎 with visible counts (`_bmad-output/manual-verification-issues.md`, 2026-10-31, item 5).

**Approach:** Every board reader can give a post one reaction, 👍 or 👎.
- Tapping your current reaction removes it. Tapping the other one switches.
- Everyone sees both counts.
- Who reacted is never shown, and reactions send no push.

## Boundaries & Constraints

**Always:**
- **Migration `0065_board_reactions.sql`:**
  - The table `board_post_reactions`:
    - `post_id` → `board_posts` `on delete cascade`;
    - `user_id` → `profiles` `on delete cascade`;
    - `value smallint not null check (value in (1, -1))`;
    - `created_at` and `updated_at timestamptz default now()`;
    - primary key `(post_id, user_id)`.
  - RLS:
    - **select:** your own rows only (`user_id = auth.uid()`), so who reacted isn't readable;
    - **insert:** `user_id = auth.uid()` and `is_board_reader()`;
    - **update:** own rows, still a reader, `value` only (column grant);
    - **delete:** own rows.
    - All rights are revoked from `anon`.
  - The function `board_reaction_counts(p_ids uuid[])` returns `(post_id, up_count, down_count)` for the given posts. It is `security definer` with `search_path = ''`, returns nothing to a non-reader, and is granted to `authenticated` only.
- **Load:** one `board_reaction_counts` call for the page's posts, plus one select of the caller's own reactions for them. Each post gets `reactions: {up, down, mine: 1 | -1 | null}`. A failed read gives zero counts and `mine: null`, logged.
- **Action `react`:** reads `postId` (UUID) and `value` (`up` or `down`).
  - Not signed in: 401. Bad input: 400.
  - Same as the current reaction: delete it. Different, or none: upsert `{post_id, user_id: user.id, value}`.
  - 42501, or an FK or not-found error: 403 or 404 with a localized message. Any other error: 500.
  - Returns `{reacted: true}` with no toast; the counts update on reload.
- **UI:** on each card, below the image or preview and above Edit and Delete, two small toggle buttons: 👍 with the up count, and 👎 with the down count.
  - `aria-pressed` reflects `mine`.
  - Accessible names, for example "Like this post, 3 so far" and "Dislike this post, 1 so far", in `board_react_*` keys.
  - They use `createPending`, keyed per post, disabled while pending.
  - Counts show "0" too.
  - They show for every reader, students included.
- **Text:** new strings go in en, de and bo.
- **Types:** `src/lib/supabase/database.types.ts` is edited by hand.

**Never:**
- No list of who reacted.
- No push or notification for reactions.
- No other emoji.
- No change to post, edit or delete behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First 👍 | no reaction | up +1, `mine` = 1, 👍 pressed | N/A |
| Tap 👍 again | `mine` = 1 | reaction removed; up −1 | N/A |
| Switch | `mine` = 1, tap 👎 | up −1, down +1, `mine` = −1 | N/A |
| Student reacts | approved student | allowed | N/A |
| Non-reader | pending parent, by API | insert refused | 42501 |
| Read others' reactions | reader selects the table | own rows only | RLS |
| Forge user | insert with another `user_id` | refused | 42501 |
| Counts | 3 up, 1 down | "3" and "1" shown to everyone | N/A |
| Counts as non-reader | RPC by a pending user | empty | N/A |
| Post deleted | reactions exist | removed by cascade | N/A |
| Bad input | `value=love`, or a bad id | 400 | localized |
| Not signed in | — | 401 | localized |
| Counts read fails | DB error | zero counts; page renders | logged |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0061_message_board.sql` -- `is_board_reader()`, and the `board_author_names` pattern for a reader-only `security definer` function.
- `src/routes/board/+page.server.ts` -- the load (posts, names and files in parallel), `actions` (copy the session, UUID and `fail` shapes from `edit`/`delete`).
- `src/routes/board/+page.svelte` -- the post card (preview, image, then the controls), `createPending`.
- `src/lib/supabase/database.types.ts` -- the new table and function.
- Tests: `src/lib/server/rls.spec.ts` (the message board describe and its helpers), `src/routes/board/page.server.spec.ts` (`fakeSupabase`), `page.render.spec.ts`, `e2e/board.e2e.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0065_board_reactions.sql` -- the table, policies, grants and counts function.
- [x] `src/lib/supabase/database.types.ts` -- hand edits.
- [x] `src/routes/board/+page.server.ts` -- reactions in the load; the `react` action.
- [x] `src/routes/board/+page.svelte` -- the two toggle buttons with counts.
- [x] `messages/{en,de,bo}.json` -- the `board_react_*` keys.
- [ ] Tests -- every matrix row: RLS for the policies and the function; unit tests for the action and load; render for the buttons; one e2e where a student likes, switches and un-reacts.

**Acceptance Criteria:**
- Given the existing board tests, when they run, then they pass, with fixtures extended only by `reactions`.

## Implementation Notes

- "Upsert" is done as a read, then update `value` or insert. A real upsert writes every column and is refused by the value-only update grant (42501, covered by an RLS test). The outcome is the same.
- A trigger sets `updated_at` on update, because the column grant leaves it out.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | edge-case, blind | Toggle-off deletes whatever value is stored, undoing a switch from another tab | low | Delete without a value filter | patch |
| 2 | blind, edge-case | `PGRST116` → 404 is unreachable; 23505 then 0 rows says "not found" | low | `maybeSingle` on the PK | patch |
| 3 | blind | A failed reactions load shows `mine` unpressed, and pressing it removes the reaction | medium | Both reads dropped together | patch: disable the buttons |
| 4 | blind | The per-post form becomes a landmark; button names change with the count | low | a11y | patch |
| 5 | blind | The bo genitive is fixed on `{author}` | low | Tibetan grammar | patch |
| 6 | verification-gap, blind | The update→insert fallback and the delete and update error branches are untested | medium (gap) | The fake's default update is non-empty | patch: tests |
| 7 | verification-gap, blind | The update policy's reader check is untested | medium (gap) | No demoted-member case | patch: RLS test |
| 8 | blind | `board_reaction_counts` has no `p_ids` cap | low | The page sends at most 30; counts only | rejected |
| 9 | blind | Types use `number`, not `1 \| -1` | low | A runtime filter covers it | rejected |
| 10 | blind, verification-gap | The `updated_at` trigger is untested | low | Nothing reads it | rejected |
| 11 | blind | The e2e has no error path; the seeded reaction isn't cleaned up | low | Unit tests cover the errors; the cascade on post delete cleans it | rejected |
| 12 | blind | Spec wording: upsert and the 404 | low | Recorded in Implementation Notes | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx supabase db reset`, then `npx playwright test e2e/board.e2e.ts` -- expected: pass. Reset the DB afterwards.
