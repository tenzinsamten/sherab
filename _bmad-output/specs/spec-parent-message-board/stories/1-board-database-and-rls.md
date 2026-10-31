---
title: 'Board database and RLS'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '99ca1f229d7265ee2cb37b2954976d340e6f8963'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The school-wide board needs a database before any page can show it. That means posts, PDF attachments, and a posting grant that admins give to chosen parents. RLS must decide who reads, posts, edits and deletes.

**Approach:** Migration `0061_message_board.sql` adds:
- `board_posts`, `board_post_files` and the private bucket `board-files`;
- the column `parents.can_post_board`;
- the helpers `is_board_reader()` and `is_board_poster()`;
- the function `board_author_names(p_ids uuid[])`.

Policies follow SPEC CAP-1 to CAP-4. No UI is in this story.

## Boundaries & Constraints

**Always:**
- **Reader:** `is_board_reader()` is true for:
  - an admin;
  - any login with `profiles.role = 'teacher'`;
  - an approved student (`profiles.role = 'student'` and `status = 'approved'`);
  - an approved parent (`is_parent()`).

  Nobody else reads posts, files or objects, including `anon`, pending or rejected students, and pending parents.
- **Poster:** `is_board_poster()` is true for an admin, a teacher, or `is_parent()` with `parents.can_post_board`. Students are never posters.
- **Insert:** `board_posts` insert requires `is_board_poster()` and `author_id = auth.uid()`.
- **Update:** only the author may update, while still a poster, and only `content`, `content_language` and `updated_at`, which a column-level grant enforces. Admins and teachers never edit other people's posts.
- **Delete:** the author, an admin, or a teacher may delete a post. An author whose grant is revoked can still delete their own posts. Deleting a post cascades to its file rows.
- **Grant:** only an admin changes `can_post_board`, through the existing `parents_update_admin` policy, with the column grant widened to `(status, can_post_board)`. Default `false`. Turning it off leaves existing posts in place.
- **Files:**
  - `board_post_files` follows `homework_assignment_files`: `object_path` unique, `file_name` 1–255 characters, `size_bytes` from 1 to 5242880, `created_by`, and the timestamps.
  - A trigger refuses a third file per post with errcode `BF001`.
  - Inserting a file requires the caller to be the post's author and a poster. Readers can select files. The author, an admin or a teacher can delete them.
- **Bucket:** `board-files` is private, with a 5242880-byte limit and `application/pdf` only.
  - Object path: `<post_id>/<uuid>.pdf`, checked by a strict regex.
  - Read policy: `is_board_reader()`.
  - Insert policy: the author of that post, while still a poster.
  - Delete policy: the author, an admin or a teacher.
- **Post columns:**
  - `id` uuid primary key;
  - `author_id` → `profiles` `on delete set null`, so posts stay when an account goes;
  - `content` jsonb, not null, with the same object-and-size check as `homework_assignments.content`;
  - `content_language` limited to bo, en and de;
  - `created_at` and `updated_at` `timestamptz`.

  There is an index on `created_at desc`.
- **Author names:** `board_author_names(p_ids)` is `security definer`, with `search_path = ''`, and is granted to `authenticated` only. It returns `(id, display_name)` only for ids that have written at least one post, and only when the caller is a reader.
- **Conventions:** follow the ARCHITECTURE-SPINE "Database functions" row. Revoke all from `anon`. `src/lib/supabase/database.types.ts` is edited by hand.

**Never:**
- No routes, UI, messages or push in this story.
- No approval queue, replies, pins or expiry.
- Don't change existing policies other than widening the `parents` column grant.
- Never regenerate `database.types.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reader roles | admin, teacher, approved student, approved parent | select posts, files and objects | N/A |
| Non-readers | anon, pending student, pending parent | 0 rows; object download refused | RLS |
| Post by poster | admin, teacher, or granted parent; own `author_id` | row inserted | N/A |
| Post by non-poster | student, or ungranted parent | refused | 42501 |
| Forged author | poster with another `author_id` | refused | 42501 |
| Edit own post | author, still a poster | `content` updated | N/A |
| Edit another's post | admin or teacher on someone else's post | 0 rows updated | RLS |
| Delete | author, admin or teacher | post and file rows gone | N/A |
| Delete by other | another parent or a student | 0 rows deleted | RLS |
| Grant change | admin sets `can_post_board` | saved | N/A |
| Grant by non-admin | parent sets their own flag | refused | 42501 |
| Grant revoked | parent with posts, flag off | old posts still readable; new insert refused; own delete allowed | 42501 |
| Third file | post already has 2 files | refused | BF001 |
| File on another's post | poster, not the author | refused | 42501 |
| Author names | reader passes the ids | names of authors with posts | non-reader → empty |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0053_homework_files.sql` -- template for the bucket insert (`on conflict do update`), the path-id helper (:205), the storage policies (:228-270), the files table (:51-71), the column grants, and the `HF001` limit trigger.
- `supabase/migrations/0023_parents.sql:45-69,107` -- `parents` policies and grants (`grant update (status)`), and `is_parent()`.
- `supabase/migrations/0001_init.sql:86` -- `is_admin()`. There is no global teacher helper; check `profiles.role = 'teacher'` inside the new helper.
- `supabase/migrations/0002_student_registration.sql:20,54` -- `profiles.status`, which only matters for students.
- `supabase/migrations/0034_homework_content.sql` -- the `content` jsonb check and the `content_language` check to copy.
- `supabase/migrations/0060_parent_managed_homework.sql` -- latest style for `security definer` helpers and grants.
- `src/lib/supabase/database.types.ts` -- add the tables, the `parents.can_post_board` column, and the three functions.
- `src/lib/server/rls.spec.ts` -- use the local helpers `createSignedInUser` (:64), `createApprovedParent` (:594), `createPendingParent` (:619) and `signUpStudent` (:653), and the 42501 asserts (:3359). Add a new `describe('message board')`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0061_message_board.sql` -- tables, column, helpers, function, bucket, policies, grants, trigger, comments.
- [x] `src/lib/supabase/database.types.ts` -- hand-added types.
- [x] `src/lib/server/rls.spec.ts` -- one test per matrix row, including storage upload and download as reader, non-reader and non-author.

**Acceptance Criteria:**
- Given a fresh `npx supabase db reset`, when the migrations run, then 0061 applies with no error.
- Given the existing RLS tests, when they run, then they pass unchanged.

## Implementation Notes

- Matrix row "Grant by non-admin" expects 42501. The mandated mechanism, the existing `parents_update_admin` policy, filters the row instead: no error, 0 rows, flag unchanged. The refusal holds. The error code would need a change to an existing policy, which the Never list forbids. The test asserts the silent refusal, and the user was told.
- Insert on `board_posts` is limited by a column grant to `(author_id, content, content_language)`, so clients can't backdate `created_at`. The app inserts first, then uses the returned id for file paths.
- Deleting a post cascades to its file rows only. Stored objects must be removed through the Storage API first (story 5).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | verification-gap, blind | Direct file-row delete by author, admin or teacher is never tested | medium (gap) | "Delete" only removes rows through the FK cascade, which bypasses the policy | patch: test |
| 2 | verification-gap, blind | Object removal by the author or a teacher is never tested | medium (gap) | Only the admin's `remove` is asserted | patch: test |
| 3 | blind, edge-case | Storage insert lets an author upload unlimited objects into their post folder | medium | The "Third file" test shows the third upload succeeding; the trigger counts rows only | patch: count objects in the insert policy |
| 4 | blind, edge-case | `board_post_files` has no insert column grant, so a client can set `created_at` and reorder files | low | Only update is revoked; direct grant correction | patch |
| 5 | blind, edge-case | Hand-written Insert/Update types allow columns the grants refuse | medium | Type-checked calls would fail at runtime with 42501 in stories 3–5 | patch |
| 6 | blind | Rejected students untested as non-readers | low | Named in the spec; one more fixture | patch: test |
| 7 | blind | Upload by a never-granted parent untested (CAP-2) | low | Only the revoked case is covered | patch: test |
| 8 | blind, edge-case | Test setup ignores errors; refused uploads that succeed leak objects | low | `newStudent`, the `display_name` update, `edit.error`, cleanup list | patch |
| 9 | blind, edge-case | Matrix says 42501 for a non-admin grant change; the test asserts a silent 0-row refusal | low | The refusal holds; the fix would edit the frozen spec or an existing policy | rejected: spec-level, reported to the user |
| 10 | blind, edge-case | `updated_at` is client-set, with no trigger | low | Same as the repo's existing tables (0039, 0053); the app owns it | rejected |
| 11 | blind | `board_post_files.updated_at` never changes | low | Mirrors the homework-files template | rejected |
| 12 | blind | Rows without an object are not detected | low | Caused by the test's admin object removal; the app removes object and row together (story 5) | rejected |
| 13 | blind, edge-case | The author can't delete objects once the post row is gone | low | Story 5 removes objects before the row; admins and teachers can still clean up | rejected |
| 14 | edge-case | A row can be inserted for an object never uploaded, or with a wrong size | low | Only the post's own author can, through app code that does both; the guard adds complexity | rejected |
| 15 | edge-case | An author who loses reader status can't delete their posts | false | Parents can't return to pending (`parents_stamp_review`); rejecting a parent-only login deletes the user, so `author_id` becomes null; teachers stay readers | rejected |
| 16 | blind | `board_author_names` accepts an array of any size and allows probing | false | Readers already see every post's `author_id`; names come only for authors with posts | rejected |
| 17 | blind | Table constraints (language, size, path shape) untested | low | Plain CHECKs copied from 0034 and 0053; not in the matrix | rejected |
| 18 | blind, edge-case | `board_file_post_id` has no type entry | low | Used only by policies; no app RPC needs it | rejected |
| 19 | verification-gap | RLS suite skipped when Supabase is unreachable | low | Existing convention; the verify step resets the DB first | rejected |

## Design Notes

`author_id on delete set null` keeps posts permanent (SPEC Non-goals). Story 3 shows a null author as an unnamed member. `board_author_names` exists because readers can't select other users' `profiles` rows.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
