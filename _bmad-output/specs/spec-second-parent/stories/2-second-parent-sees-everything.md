---
title: 'Story 2: Second parent sees everything'
type: 'feature'
created: '2026-10-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3c46c69b177041178e5781185de4a5b10ac31366'
context:
  - '{project-root}/_bmad-output/specs/spec-second-parent/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1 stored up to two parent links, but some TypeScript readers still use `registered_by_parent_id`. A slot-2 parent gets an empty calendar and is listed without children on the admin parents page. Neither parent can see who asked for deletion or who set a leave answer (SPEC CAP-3).

**Approach:**
- Move the remaining TypeScript readers to the active links.
- Add `actor_display_name()` (spine AD-12) and drop `requested_by = auth.uid()` from the `deletion_requests` SELECT policy (AD-9).
- Show the requester's name on a pending deletion request, and the setter's name on each leave answer, on both parents' child page.

## Boundaries & Constraints

**Always:**
- Migration `0055_second_parent_reads.sql`:
  - Recreate `deletion_requests_select` without the `requested_by = auth.uid()` clause.
  - Add `actor_display_name(p_student_id uuid, p_actor_id uuid) returns text`.
    - `security definer`, `stable`, `search_path = ''`, EXECUTE granted to `authenticated` only.
    - Returns the actor's `profiles.display_name` only when the caller may read that student: the student themselves, `is_parent_of`, a teacher of the student, or the admin.
    - The actor must also have a `student_parents` row for that student, removed rows included.
    - Otherwise it returns null.
- No parent-scoped query reads `registered_by_parent_id` (AD-12). The parent calendar filters on `linked_children()` ids. The admin parents page groups active `student_parents` rows by `parent_id` in one query.
- The admin "own child" checks follow `has_link_to`: decide buttons and pending-deletion counts exclude a student the admin is linked to, whoever submitted the request. This covers `requests/+page.server.ts` (`ownChild`), `+layout.server.ts:125` and `admin/+page.server.ts:21`.
- A second request while one is pending shows "already requested" (the existing `deletion_error_duplicate` mapping on 23505). The pending block names the requester, or "you".
- Decision (human, 2026-10-27): every leave answer on the parent child page shows its setter. It shows "by you" when the viewer set it and "by <name>" otherwise, in single-parent families too. An answer whose name resolves to null shows no label.
- New text is localized in en, de and bo.
- New database functions are added to `database.types.ts` by hand.

**Never:**
- No invites (story 3).
- No link removal, no teacher contact list, no `student_parent_contacts()`, and no teacher-view setter names (story 4).
- No `/join` changes (story 5).
- No new `profiles` SELECT policy for co-parents.
- Never run `supabase:types`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slot-2 calendar | B linked as slot 2 opens `/calendar` | Same enrollments and leave answers as A | — |
| Admin parents page | A and B both linked to a child | The child is listed under both A and B | — |
| Pending deletion | A requested; B opens the child page | B sees "pending, requested by A"; A sees "requested by you" | — |
| Duplicate request | B submits while A's request is pending | "Already requested" message, no raw error | 23505 mapped |
| Leave setter | B marks a session on leave | Both parents see the answer with B's name | — |
| Name probe | A caller with no access to the student, or an actor never linked to them | `actor_display_name` returns null | — |
| Removed requester | Service role removes A's link after A requested | B still sees the request named A; A no longer reads it | — |
| Admin is co-parent | The admin is B; A requested deletion | No decide buttons and not counted for the admin | DB refuses anyway (42501) |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0029_deletion_requests.sql:65-73`: the current SELECT policy. `0054_student_parents.sql`: `has_link_to`, the `student_parents` RLS (:161), and the `registered_by_parent_id` column comment ("until story 2"), which should be reworded in 0055.
- `supabase/migrations/0027_*` (:143, :208): `session_leave_history.answered_by`, stamped with `auth.uid()`. Reuse it.
- Teacher-of-student check: reuse the existing helper used by the teacher profiles policy. Don't write a new one.
- `src/routes/calendar/+page.server.ts:201-226`: await `linked_children` first, then `.in('student_id', ids)` on both queries. Drop the embeds and rewrite the comments at 203-205.
- `src/routes/admin/parents/+page.server.ts:18,44-80`: read `student_parents` where `removed_at` is null, embedding `student:profiles!student_parents_student_id_fkey(display_name, registration_name, status)`. Reword the comment at 44-47.
- `src/routes/parent/children/[id]/+page.server.ts`:
  - :190-210: add `answered_by` to the leave select.
  - :237-248: add `requested_by` to the deletion select.
  - Resolve each distinct actor id once with `rpc('actor_display_name')`. Add the new fields to the `ChildSession` type (~:40).
- `src/routes/parent/children/[id]/+page.svelte`: deletion block at :500-571, and the session rows.
- `src/routes/requests/+page.server.ts:102`, `src/routes/+layout.server.ts:125`, `src/routes/admin/+page.server.ts:21`: compute the admin's active-link student ids once and exclude them. Leave the sick and join flags alone; they already use `has_link_to`.
- `src/lib/server/testing/link-parent.ts`, `e2e/fixtures.ts:44-77`: drop the "until story 2" wording.
- `messages/{en,de,bo}.json` (deletion keys at en :993-1006): add keys for "requested by {name}", "requested by you", "set by {name}" and "set by you".
- Tests:
  - `calendar/page.server.spec.ts` (:737, 885, 888, 998) and `page.server.db.spec.ts`.
  - `admin/parents/page.server.spec.ts:84-235`.
  - `parent/children/[id]/page.server.spec.ts:639+`.
  - `requests/page.server.spec.ts`.
  - `rls.spec.ts`: 7-6 deletion at :11802, 7-4 leave at :10518.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0055_second_parent_reads.sql` -- add the policy and function as described under Always, and reword the column comment -- AD-9, AD-12.
- [x] `src/lib/supabase/database.types.ts` -- add `actor_display_name` in alphabetical order.
- [x] `src/routes/calendar/+page.server.ts` and its two specs -- switch the parent queries to the links.
- [x] `src/routes/admin/parents/+page.server.ts` and its spec -- group by active links.
- [x] `src/routes/parent/children/[id]/+page.server.ts`, `+page.svelte` and the spec -- show the requester and the setter.
- [x] `src/routes/requests/+page.server.ts`, `src/routes/+layout.server.ts`, `src/routes/admin/+page.server.ts` and their specs -- base the own-child exclusion on links.
- [x] `messages/{en,de,bo}.json` -- add the new keys.
- [x] `src/lib/server/rls.spec.ts` -- add a test for each matrix row with a slot-2 parent linked through `linkParent`.

**Acceptance Criteria:**
- Given a reset database, when `test`, `check` and `build` run, then all of them exit 0.
- Given the change, when `grep -rn registered_by_parent_id src --include='*.ts' --include='*.svelte'` runs, then only `database.types.ts`, registration code, fixtures and specs match.

## Implementation Notes

- The admin "own child" exclusion lives in `src/lib/server/own-children.ts` (`readOwnLinkedStudentIds`, `countDecidableDeletions`). The nav badge and the dashboard tile now read pending `student_id`s plus the admin's active links in parallel and count in code, instead of a `head` count with `.neq('requested_by', …)`. They still take one round. If the links read fails, nothing is counted and `/requests` shows no deletion rows; both flag the error. (Review fix.)
- The parent calendar keeps all its reads in one round. Enrollments and answers filter on the caller's own active link through an embed (`student:profiles!…!inner(student_parents!student_parents_student_id_fkey!inner(parent_id))`, `.eq(parent_id, userId)`, `.is(removed_at, null)`), not on the `linked_children()` ids. (Review fix.)
- `actor_display_name` also admits a teacher of the student's `class_id`, the same as `profiles_select_admin_or_teacher_of_student_class` (`is_teacher_of_class`, `is_teacher_of_student`).
- Labels resolve once per distinct actor id. The viewer's own id is never sent to the RPC; it shows as "you". Only a pending request shows its requester.
- Behaviour change (AD-9): a parent no longer sees their own de-identified request after approval, because `student_id` is null and the `requested_by` clause is gone. The 7-6 "Approve" RLS assertion was updated to match. No app page read that row.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind | The parent calendar awaits `linked_children()` before the other reads: one extra serial round trip, and the #104h "all start at once" test was relaxed | medium | `readParentView` awaits the RPC first. That undoes the spec-navigation-latency batching for every parent calendar load. Embedding the caller's active link keeps one batch | patch |
| 2 | blind | The calendar sends `.in('student_id', [])` when there are no children or the RPC fails | low | Moot once #1 removes the ids list | reject |
| 3 | edge, blind | A failed read of the admin's links counts as "no own children": own-child requests are counted in the badge and tile, and /requests shows decide buttons for them | low | `ownLinkedIds` returns an empty set on error. The error is flagged, but the rows and count are still used; the DB refuses the decision (42501). Direct correction | patch |
| 4 | edge, blind | `countDecidableDeletions` fetches every pending row, which max-rows (1000) can truncate | low | The pending deletion queue is a handful of rows at one school. The fix (a SQL count function) adds new surface | reject |
| 5 | verification-gap, blind | No test checks the rendered `deletion-requested-by` / `leave-set-by` labels | medium | Pre-verified: only the .svelte file references them; the e2e tests at parent-mobile :427 and :613 check only "On leave ·" and "Pending" | patch |
| 6 | blind | `actor_display_name` has no email fallback for a null display name | low | Parent sign-up stores `display_name` from metadata (0054:402). A fallback would expose the co-parent's email, which AD-12 keeps to `student_parent_contacts` (story 4) | reject |
| 7 | blind | Leave set by a student, teacher or admin gets no label | false | AD-13 / 0027:159: only `is_parent_of` may insert `session_leave_history`, so `answered_by` is always a parent | reject |
| 8 | blind | The 0055 header does not record that the requesting parent loses read access to their de-identified row after approval | low | True (the 7-6 assertion was flipped). Direct correction: one comment line | patch |
| 9 | blind | The teacher check in `actor_display_name` copies the profiles policies; the legacy `class_id` branch is untested | low | It reuses the same two helpers as the policy. Drift needs a policy change, and the legacy path is pre-existing | reject |
| 10 | blind | The parent child page runs `actorLabels` after the reads, adding serial round trips | low | An RPC fires only for answers or requests by the other parent, so single-parent families make no extra call. At most two short serial calls otherwise | reject |
| 11 | blind | The RLS tests never check that a removed link hides the child on the admin parents page | low | Admins read removed rows, so `.is('removed_at', null)` is the only guard, and no test covers it. Adding one test is a direct addition | patch |
| 12 | blind | Duplicate request: the slot-2 action path is untested | false | The 23505 mapping in the action does not depend on which parent submits, and it is asserted at page.server.spec.ts:821 | reject |
| 13 | blind | A rejected request names no one | low | Matches the frozen rule ("the pending block names the requester") | reject |
| 14 | blind | The story file is untracked and missing from the diff | false | The diff was scoped to code on purpose; the spec is committed with the change | reject |
| 15 | blind | `actor_display_name` revokes `service_role`, unlike `is_parent_of` | false | Under the service role `auth.uid()` is null, so the function returns null anyway; nothing is lost | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0, 0055 applies.
- `npm run test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
