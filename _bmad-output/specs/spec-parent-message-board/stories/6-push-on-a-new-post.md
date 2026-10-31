---
title: 'Push on a new post'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '6656bceb106194d600a567012081bfd5361b638e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Readers only learn about a new board post if they happen to open `/board`.

**Approach:** When a post is created, every subscribed browser of every board reader except the author gets one push notification that opens `/board`. This is SPEC CAP-5.
- It reuses the homework push pipeline: VAPID config, the subscription table, the batching and logging, and the database-started request through `trigger_homework_push`.
- It adds a board kind with its own targets and log, in a new migration `0062_board_push.sql`.

## Boundaries & Constraints

**Always:**
- **Migration `0062_board_push.sql`:**
  - The table `board_push_log`:
    - `post_id` → `board_posts` `on delete cascade`;
    - `recipient_id` → `profiles` `on delete cascade`;
    - `sent_at timestamptz default now()`;
    - primary key `(post_id, recipient_id)`;
    - RLS on, all rights revoked from `anon` and `authenticated`, so only the service role uses it.
  - The function `board_push_targets(p_post_id uuid)` returns `recipient_id` for every profile that:
    - has at least one `push_subscriptions` row;
    - would be a board reader: admin, teacher, approved student, or a user with an approved `parents` row. These are story 1's reader rules, checked for that profile rather than `auth.uid()`;
    - isn't the post's author;
    - has no `board_push_log` row for this post.

    It is `security definer` with `search_path = ''`, executable by `service_role` only, ordered by `recipient_id`.
  - `trigger_homework_push` is reused unchanged. The board passes `p_kind = 'board'` and `p_instance_id = post id`.
- **`push.ts`:**
  - `sendBoardPush(postId, deps)` reads the post (content, `content_language`, author name) and the targets with the admin client.
  - It sends in batches like `sendHomeworkPush`: whole recipients only, `PUSH_BATCH`, TTL, removing subscriptions the push service no longer knows, and counting failures.
  - It logs the recipients it delivered to in `board_push_log` (upsert, ignoring duplicates). It never throws.
- **Message,** in each subscription's locale:
  - title `board_push_title({author})` ("New on the message board" with the author's name; "Former member" when there is none);
  - body: the post's plain text, with whitespace collapsed and clipped to about 120 characters with an ellipsis;
  - `url: '/board'`, `tag: 'board-<postId>'`, `lang` = the locale.
- **Run endpoint:** `runHomeworkPush` (used by `/api/push/run`) also handles `{kind: 'board', instanceId}`. It checks the UUID, sends one batch, and while recipients are left it asks for the next batch through `trigger_homework_push('board', id, depth + 1)`, up to `PUSH_MAX_DEPTH`. The scheduled run never sends board notices.
- **Announce:** `announceBoardPost(postId)` calls `trigger_homework_push('board', postId)` with the admin client. It does nothing without VAPID config and never throws. The `/board` `post` action calls it after a successful insert and file attach.
- **Off switch:** with the `VAPID_*` variables unset, nothing is sent. This is the existing behaviour.
- **Text:** new strings go in `board_push_*` keys in en, de and bo.
- **Types:** `src/lib/supabase/database.types.ts` is edited by hand for the new table and function. It is never regenerated.

**Never:**
- No push on edit or delete.
- No push to the author.
- No change to how homework pushes are targeted or worded.
- No new cron job.
- No new secret.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New post | 3 readers subscribed plus the author | 3 recipients get one push each; logged | N/A |
| Author subscribed | author's own browser | not targeted | N/A |
| Non-readers | pending student, pending parent | not targeted | N/A |
| Already logged | run again for the same post | nobody gets it twice | N/A |
| Over one batch | more than `PUSH_BATCH` sends | next batch requested via trigger, depth + 1, up to `PUSH_MAX_DEPTH` | N/A |
| Push off | no VAPID config | nothing sent, no trigger | N/A |
| Gone subscription | 404 or 410 from the push service | subscription deleted | counted |
| Targets read fails | DB error | nothing sent | logged |
| Bad id | `instanceId` not a UUID | nothing | N/A |
| Locale | `bo` subscription | `bo` title and body | N/A |
| Long body | 500 characters | clipped about 120 with an ellipsis | N/A |
| Edit | post edited | no push | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/server/push.ts`:
  - `PUSH_BATCH` :34, `PUSH_MAX_DEPTH` :37, `pushConfig` :47;
  - `buildPushMessage` :129 (the `clip` helper), `sendHomeworkPush` :219-350 (the batch loop to copy or factor out: subscriptions read, whole-recipient choice, send, removal of gone subscriptions, log upsert);
  - `runHomeworkPush` :375, `announceHomework` :415.
  - Factoring the shared batch-send into a helper is fine if homework behaviour and tests stay unchanged.
- `src/routes/api/push/run/+server.ts` -- it calls `runHomeworkPush` and needs no change beyond what `runHomeworkPush` does.
- `supabase/migrations/0037_push_notifications.sql` -- `push_subscriptions` :31, `push_notification_log` :61, `trigger_homework_push` :278 (it posts `{kind, instanceId, depth}`).
- `supabase/migrations/0054_student_parents.sql:585` -- `homework_push_targets` style.
- `supabase/migrations/0061_message_board.sql` -- `is_board_reader()`; its reader rules, to apply per profile.
- `src/lib/rich-text.ts` -- the document shape; write or reuse a plain-text extractor for the body.
- `src/routes/board/+page.server.ts` -- the `post` action, where `announceBoardPost` is called.
- Tests: `src/lib/server/push.spec.ts` (deps injection: `admin`, `send`, `config`, `rotate`), `src/routes/api/push/run/server.spec.ts`, `src/lib/server/rls.spec.ts` (for `board_push_targets` against the real DB), `src/routes/board/page.server.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0062_board_push.sql` -- the log table, the targets function, grants and comments.
- [x] `src/lib/supabase/database.types.ts` -- hand-added types.
- [x] `src/lib/server/push.ts` -- `sendBoardPush`, the message builder, the board branch in `runHomeworkPush`, `announceBoardPost`.
- [x] `src/routes/board/+page.server.ts` -- call `announceBoardPost` after a successful post.
- [x] `messages/{en,de,bo}.json` -- the `board_push_*` keys.
- [x] `src/lib/server/push.spec.ts`, `src/routes/api/push/run/server.spec.ts`, `src/routes/board/page.server.spec.ts` -- every matrix row except the DB targeting rows.
- [x] `src/lib/server/rls.spec.ts` -- `board_push_targets` includes subscribed readers of each role, and excludes the author, non-readers, unsubscribed users and logged recipients. It isn't callable by `authenticated`.

**Acceptance Criteria:**
- Given the existing homework push tests, when they run, then they pass unchanged.

## Implementation Notes

- The shared batch send became a private `sendBatch` helper. `sendHomeworkPush` behaves as before.
- `save_push_subscription()` (0037) accepts only students and approved parents. Teachers and admins therefore can't subscribe, and in practice they get no board push. The RLS tests insert staff subscriptions with the service role. This is deferred, with a user decision needed.
- The notification's `lang` is the browser locale. The body stays in the post's own language.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | verification-gap | The fake ignores the post and author filters, so a wrong-row lookup passes | medium (gap) | `single()` ignores `eq` arguments | patch: test |
| 2 | blind | `askForNextBatch` can throw out of `runHomeworkPush` | low | Not in try/catch; the module never throws | patch |
| 3 | edge-case | Recipients past the depth cap are dropped silently | low | Same cap as homework; fixed by logging | patch: log |
| 4 | blind, edge-case | `clip` splits Tibetan stacks and emoji | low | UTF-16 slice; Tibetan is a main language | patch: grapheme clip (board only) |
| 5 | blind | The German and Tibetan titles are ambiguous | low | Wording | patch |
| 6 | blind | 404 and author-read-error cases are untested | low | Matrix row says 404 or 410 | patch: tests |
| 7 | blind | Staff can't subscribe; opt-in copy says homework | medium | `save_push_subscription` (0037) | defer (user decision) |
| 8 | blind, edge-case | No backstop for lost batches, read errors or transient send failures | medium | The scheduled run skips the board; same as homework "added" | defer |
| 9 | blind, edge-case | The body is tagged with the browser locale, not `content_language` | low | One `lang` per notification; the title is in the browser locale | rejected |
| 10 | blind, edge-case | Overlapping runs can send twice | low | Needs a pg_net retry; the `tag` replaces the duplicate on screen | rejected |
| 11 | blind | Helper duplication with the homework branch | low | The spec says homework stays unchanged | rejected |
| 12 | edge-case | An author read error says "Former member" | low | Rare; a test is added for the fallback | rejected |
| 13 | edge-case | An empty body for unreadable content | low | `parseContent` requires text on insert | rejected |
| 14 | edge-case | Post deleted mid-send gives an FK error on the log | low | Logged once; harmless | rejected |
| 15 | blind | Other error-branch test gaps (log upsert, subscriptions read, `waitUntil` promise) | low | Shared `sendBatch` paths are tested through homework | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
