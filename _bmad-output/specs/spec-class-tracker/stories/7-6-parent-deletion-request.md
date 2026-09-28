---
title: '7-6 Parent deletion request (shared deletion queue)'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'cee62e7edeb23003c9cd23b6813b3c5ab1782d67'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CAP-8 promises data erasure after admin approval, but no request path exists; 5-1 deferred the flow.

**Approach:**
- Build one shared `deletion_requests` queue (AD-9).
- An approved parent submits a request for a linked child.
- The admin approves it, and a database trigger erases the child's account and every student-keyed record.
- The request row survives, de-identified.
- The parent's account remains.

Scope: split from story 7-6. The guardian email change is deferred to its own story.

**Decision 1 — parents only:**
- Students cannot request deletion, neither in the UI nor in the database.
- Only the child's approved parent submits.
- This is narrower than CAP-8 ("a student, or their parent") by the user's choice.

**Decision 2 — no withdrawal:** a pending request stays until the admin decides.

**Size:** the full spec was kept, not split.

## Boundaries & Constraints

**Always:**
- **Migration `0029_deletion_requests.sql`:**
  - **`deletion_requests` table:**
    - id; student_id (FK → `profiles` `ON DELETE SET NULL`; NULL is the de-identified placeholder); requested_by (FK → `profiles` `ON DELETE SET NULL`); requester_role (check `parent` only; the column keeps the AD-9 audit field); status (`pending`/`approved`/`rejected`); requested_at; reviewed_by (the admin, FK `ON DELETE SET NULL`); reviewed_at.
    - A partial unique index allows only one `pending` request per student.
  - **BEFORE INSERT trigger:**
    - Stamps `requested_by = auth.uid()`, `requested_at = now()` and `status = 'pending'`.
    - Sets `requester_role = 'parent'`, and refuses (42501) unless `is_parent_of(student_id)`.
  - **BEFORE UPDATE trigger:**
    - Only `pending` → `approved`/`rejected` is allowed.
    - Stamps `reviewed_by = auth.uid()` and `reviewed_at = now()`.
    - Every other column change is refused.
  - **RLS:**
    - INSERT with check `is_parent_of(student_id)` only.
    - SELECT for the requester, `is_parent_of(student_id)`, the student themselves, and the admin.
    - UPDATE for the admin only, with check `not is_parent_of(student_id)` (the AD-4 self-decision guard).
    - No DELETE. Teachers have no access.
  - **Erasure on approval:**
    - An AFTER UPDATE trigger (security definer) deletes the student's `auth.users` row when the status becomes `approved`. The existing FK cascades then remove `profiles` and every student-keyed table.
    - `student_id` becomes NULL through `SET NULL`; the parent's `requested_by` stays.
    - `requester_role`, `reviewed_by`, `requested_at` and `reviewed_at` stay as the audit trail.
    - The parent's `profiles` and `parents` rows are untouched.
  - **Functions:** all new ones use `search_path = ''` with explicit revokes and grants.
- **Parent:**
  - On `/parent/children/[id]`, a "Request deletion" card explains that the admin reviews the request and that approval erases all of the child's data for good.
  - It submits after a confirm step.
  - It then shows "Deletion requested · Pending" or "Rejected".
  - After approval, the child disappears from `/parent` (the account is gone).
- **Admin:**
  - `/requests` gets an admin-only "Deletion requests" section: student name, the requesting parent, date, and Approve (with a confirm step) or Reject.
  - A DECIDED history shows de-identified approved rows as "Deleted student".
  - Pending deletion requests count toward the admin nav badge and the admin dashboard tile.
- **i18n:** every new string exists in en, de and bo. Copy is terse, with no exclamation marks.

**Never:**
- Erasing anything without an admin approval.
- Approval by the student's own parent.
- Deleting or changing the parent account.
- Hard-deleting the request row.
- Teacher access to the queue.
- The guardian email change (deferred).
- A student-side deletion request, in the UI or the database.
- Withdrawing a request.
- Editing old migrations, or pushing to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Parent submits | approved parent, approved child | pending row, requester_role `parent`, requested_by = parent | N/A |
| Not own child | parent for another student; pending child; teacher; the student themselves | refused | RLS 42501 |
| Duplicate | second request while one is pending | refused | 23505 → message |
| Approve | admin approves | child's auth user, profile, enrollments, history, streaks, badges, leave gone; request row kept with student_id NULL, role/reviewed_by/timestamps kept; parent account intact | N/A |
| Reject | admin rejects | nothing erased; status `rejected`; a new request is allowed later | N/A |
| Self-decision | admin who is the child's parent approves | refused | RLS |
| Not admin | teacher or parent updates a request | refused | RLS |
| Frozen | admin changes an approved/rejected row or edits student_id | refused | trigger error |
| Read | requester, parent, student, admin; other parent/teacher | rows / none | RLS |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0001_init.sql:35` -- `profiles.id` → `auth.users` ON DELETE CASCADE.
- Student-keyed cascades (confirm them all in the Approve test): `0003:32,54`, `0004:74`, `0007:41`, `0008:63`, `0016:19`, `0027:136`, `0028:36`.
- `supabase/migrations/0024_parent_first_registration.sql`:
  - `:41` `parent_id` ON DELETE RESTRICT (child side: deleting the child never touches the parent).
  - `:264` `is_parent_of`.
- `supabase/migrations/0023_parents.sql:50-58,87-90` -- admin decision policy and BEFORE UPDATE stamping pattern.
- `supabase/migrations/0028_sick_leave_decisions.sql:56-92` -- policy, grant and self-decision guard pattern.
- No migration deletes from `auth.users` yet. Prove the security-definer trigger can (owner postgres) in the Approve test; if it can't, stop and report rather than moving the erasure into app code.
- `src/routes/requests/+page.server.ts`:
  - `:61-71` admin-only guard helper; `:125-145` admin-only parents block; `:160-168` return and `loadError`; actions `:172+` (the `approveParent`/`rejectParent` pattern).
  - `+page.svelte:360-482` admin-only parents section; `:91` header count.
  - Plus `page.server.spec.ts`.
- `src/routes/+layout.server.ts:50-57` -- admin-only parents count, the pattern for the new count; the spec is `src/routes/layout.server.spec.ts`.
- `src/routes/admin/+page.server.ts:14-45` -- dashboard counts (`pendingParentsCount` pattern) plus its spec.
- `src/routes/parent/children/[id]/+page.server.ts:52-150` (load) and `:151+` (actions); `+page.svelte` (add the card after the sessions section); plus its spec.
- `src/lib/server/rls.spec.ts` -- helpers `createApprovedParent` :510, `signUpStudent` :544; the 7-5 block :9366 (`createClass` 9387, `newParent` 9405, `child` 9410).
- `src/lib/supabase/database.types.ts` -- add the table by hand.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0029_deletion_requests.sql` -- the table, triggers, RLS and erasure.
- [x] `src/routes/parent/children/[id]/` (server, page, spec) -- the request card and `requestDeletion` action.
- [x] `src/routes/requests/` (server, page, spec) -- the admin section, approve/reject actions and decided history.
- [x] `src/routes/+layout.server.ts`, `src/routes/admin/+page.server.ts` (+ specs) -- the counts.
- [x] `src/lib/server/rls.spec.ts` -- `describe('7-6 deletion requests')`, one test per matrix row.
- [x] `messages/{en,de,bo}.json`, `database.types.ts`.

**Acceptance Criteria:**
- Given an approved parent with two children, when the admin approves a deletion request for one, then `/parent` shows only the other child, and the parent can still sign in.
- Given a freshly reset local DB, when `npm test` and `npm run check` run, then all pass with 0 errors.

## Implementation Notes

- The AFTER UPDATE erasure trigger (security definer, owner `postgres`) can delete from `auth.users` locally; the Approve test proves it (auth user, profile and every student-keyed row gone).
- The BEFORE UPDATE freeze trigger lets through only the `ON DELETE SET NULL` actions of `student_id` / `requested_by` / `reviewed_by` (the referenced profile no longer exists), so the erasure's own de-identification is not refused.
- The erasure trigger also refuses a non-student target (belt and braces).
- Nav badge, dashboard tile and header counter skip pending requests the admin submitted themselves (own child: only the child's parent submits), like 7-5's own-child Sick rule.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | vgap | The `/requests` load spec ignores query filters: dropping `.eq('status','pending')` passes, which would put decided rows under live Erase buttons | medium | patch | The fake chain in the `load: deletion requests section` block discards arguments and returns fixtures in call order. |
| 2 | blind | New German parent/admin strings use "Sie"; the app's German copy uses "du" | low | patch | `de.json` has `deletion_intro` and `deletion_error_not_allowed` ("Ihr/Sie") and `requests_deletion_own_child` ("Ihr eigenes Kind"), while `parent_empty_body` and `requests_sick_own_child` use "Deine/Dein". A direct string fix. |
| 3 | vgap | The erasure and permission guarantees are tested only when local Supabase is up | medium | defer | Pre-existing convention (`describe.skipIf(!reachable)` for every RLS story); needs CI with a Supabase service. |
| 4 | blind, edge ×2 | Badge counts use `.neq('requested_by', uid)`, which drops rows whose `requested_by` is NULL | false | reject | `requested_by` can't become NULL while pending: the requester is the child's parent, and `profiles.parent_id … ON DELETE RESTRICT` (0024:41) blocks deleting that parent while the child exists. |
| 5 | blind | `ownChild` uses `requested_by` instead of `is_parent_of` and diverges after relinking | false | reject | No relink path exists (the guardian email change is deferred); the requester is always the child's current parent. |
| 6 | blind | Approval doesn't re-check that the requester is still the parent | low | reject | The same RESTRICT keeps the requester linked; no unlink path exists yet. |
| 7 | blind, edge ×2 | A pending row with `student_id` NULL gets stuck with a blank name, and Approve fails | false | reject | Requests need an approved child (`is_parent_of`); no path deletes an approved student (5-1 deferred direct deletion; CLEAR REJECTED only removes rejected registrations). |
| 8 | edge | The self-decision guard is bypassed when the admin's parent status or the child's approval changes | low | reject | A parent row with linked children can't be deleted (RESTRICT), and no path un-approves an approved student. |
| 9 | blind | A single admin who is the child's parent leaves the request pending forever | low | reject | Inherent to the AD-4 self-decision guard; raise as a governance question. |
| 10 | blind | No rejection reason, and the parent isn't told about approval or shown dates | low | reject | Enhancement; the spec defines Pending/Rejected status only. |
| 11 | blind, edge | The decided list has no limit and no reviewer column | low | reject | Deletion requests are rare at school scale. |
| 12 | edge | `toLocaleDateString()` without the app locale or Berlin time zone | low | reject | Pre-existing pattern on the same page (`requests/+page.svelte:164,524`). |
| 13 | blind | Wrong status codes (duplicate 400 vs 409; a stale decision shows "not found") | low | reject | Messages are still correct for the duplicate case; a stale decision needs two admins racing. |
| 14 | blind | The approval toast shows a client-posted name | low | reject | Affects only the caller's own toast (7-5 triage #13). |
| 15 | blind | No index for non-pending `student_id` lookups or for `reviewed_by` | low | reject | School scale. |
| 16 | blind | bo strings are English | false | reject | Project convention. |
| 17 | blind | Tests miss the NULL-requester, relink and orphan cases | false | reject | Those states are unreachable (#4, #5, #7). |
| 18 | edge | The admin dashboard count includes own-child rows when there is no user | false | reject | The admin route's layout guard already requires a signed-in admin. |

## Design Notes

- **De-identification through `ON DELETE SET NULL`:** the erasure itself NULLs `student_id`, so no separate de-identify step can be forgotten. The parent requester's id stays: they are not the erased person, and AD-9 keeps the submitter.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0029 applies cleanly.
- `npm test` -- expected: all pass (fresh DB).
- `npm run check` -- expected: 0 errors.
