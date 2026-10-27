# Adversarial review: second-parent amendment (2026-10-27)

- **Target:** `ARCHITECTURE-SPINE.md` (AD-10 rewritten, AD-16 new, AD-4/9/11/12/13 touched), `.memlog.md` entries from "2026-10-27 Update run started"
- **Units one level down:** `specs/spec-second-parent/stories.yaml` stories 1-5 (SPEC.md, brownfield.md)
- **Checked against:** `supabase/migrations/0023`, `0024`, `0029`, `0033`, `0037`, `0042`, `0051`; `src/routes/requests/+page.server.ts` (`rejectParent`), `src/routes/admin/teachers/+page.server.ts` (Remove)
- **Lens:** build two stories that each obey every AD to the letter but still don't fit together; find lifecycle and concurrency paths where the ADs conflict with each other or with built migrations.

## Verdict

The link-table design is sound, and the partial unique indexes make a third active link impossible. But the "at least one link" rule only holds on paths that take the student-row lock, and several paths don't. The lifecycle edges are also left open: parent rejection or un-approval, account deletion, the FK the renamed column keeps, and stale invites. Two stories can follow the spine exactly and still build mismatched behaviour there. There is one critical finding and seven high ones. Close them before story 1 starts.

## Critical

### C-1. Zero active links is reachable under concurrency: the deferred trigger has no lock, and the cascade paths skip the lock

- **Failure path:** Student S has links A (slot 1) and B (slot 2).
  - T1: the admin's remove function locks S's `profiles` row and sets `removed_at` on B. It still sees A as active.
  - T2: A's account is deleted (the `rejectParent` retry of a `rejected` row, a teacher Remove whose `parents` row is no longer approved, or any `deleteUser`). The FK cascade deletes A's link. Nothing in this path locks S's row.
  - Both deferred constraint triggers run at commit, each in its own snapshot. T1 sees A still active and T2 sees B still active, so both pass. S ends up with zero links.
  - AD-10 calls the last-link rule concurrency-proof only because the remove function locks the row. The cascade path never takes that lock.
- **Incompatible pair:** Story 1 (constraint trigger, FK cascade) and story 4 (remove function with lock) each follow AD-10 to the letter, and together they break SPEC Constraint 1 ("two removals at the same time never yield ... zero").
- **AD fix (AD-10):** The deferred zero-link trigger must itself run `select ... from profiles where id = student_id for update`. That lock waits for any concurrent link mutation to commit. It must then count active links in a new statement (READ COMMITTED takes a fresh snapshot per statement). If the row is gone, the student was deleted, so pass. State the rule as: "every path that changes `student_parents`, including FK cascades, serializes on the student's `profiles` row. The constraint trigger takes that lock, so the rule holds however the change started." Add an RLS/concurrency test that runs a removal and a parent-account deletion in two connections.

## High

### H-1. The renamed `registered_by_parent_id` keeps 0024's `ON DELETE RESTRICT`, which contradicts "deleting a parent removes only that parent's links"

- **Failure path:** A registered S, and B was linked later. The admin deletes A's account (B remains). AD-10 says this should remove only A's links. But 0024's FK `profiles.parent_id references parents(id) on delete restrict` survives a column rename. It fires immediately, before any deferred trigger, so the delete is refused.
- **Incompatible pair:** Story 1 renames "mechanically" (memlog: "Story 1 renames references mechanically"). A deletion test in story 4 or story 2 then expects the co-parent case to succeed.
- **AD fix (AD-10):** "The rename changes the FK to `ON DELETE SET NULL`. The last-link rule is enforced only by the `student_parents` constraint trigger, never by the `registered_by_parent_id` FK." Note that a set-null registrar drops out of the 0042 index, which is acceptable. The guard trigger still lets RI actions through, because they run as the table owner.

### H-2. The column rename breaks every function body that names `parent_id`, and two stories both own rewriting them

- **Failure path:** PL/pgSQL and plain SQL function bodies are stored as text and not rewritten on `ALTER ... RENAME COLUMN`.
  - `guard_profile_link_columns()` (0024) reads `new.parent_id` on **every** `profiles` UPDATE. After the rename, every profile update fails, including registration approval, `team_id` and tours.
  - These also break at call time: `handle_new_user()`, `is_parent_of()`, `linked_children()` (0024), `student_registration_state()` (0042), and the homework push recipients function (0037:233).
  - Story 1 owns the rename. Story 2 owns "move every brownfield.md reader", which includes 0037. Between the two stories, push notifications are broken, or both stories rewrite the same functions.
- **AD fix (AD-10, ownership line):** "The migration that renames the column also recreates, in the same migration, every database function and trigger that names `parent_id`. `guard_profile_link_columns`, `handle_new_user`, `is_parent_of`, `linked_children`, `student_registration_state` and the 0037 recipient function move onto `student_parents` or `registered_by_parent_id` there. Story 2 owns only the TypeScript readers." Pin the brownfield grep (`grep -rn parent_id supabase/migrations`) as a check in story 1.

### H-3. The self-decision guard is vacuous for pending students and for un-approved parents

- **Failure path:**
  - AD-4's guard is "not from an actor who `is_parent_of` that student". The amended `is_parent_of` requires the student to be **approved** and the parent row to be **approved**.
  - Pending student: is_parent_of is always false, so a teacher of the class who registered the child can approve their own child's registration. The built `profiles_update_registration_review` (0051) has no guard clause at all.
  - Un-approved parent: the SPEC assumption says such a parent "keeps the link but has no access". A teacher-parent whose `parents` row is no longer approved therefore passes `not is_parent_of` and can decide their own child's Sick leave (0028) or a class join (0031).
- **Incompatible pair:** Story 2 applies the guard through `is_parent_of` exactly as AD-4 says. Story 1's tightened `is_parent_of` silently weakens it.
- **AD fix (AD-4):** Add a helper `has_link_to(student_id)` that is true for any active `student_parents` row for the caller, whatever the student or parent status. Every self-decision `WITH CHECK` uses `not has_link_to(...)`, never `not is_parent_of(...)`. Add that clause to `profiles_update_registration_review`. Keep `is_parent_of` for granting access only.

### H-4. Expired or orphaned pending invites block the child's only invite slot forever

- **Failure path:**
  - AD-16 evaluates expiry at read time and has no job. The partial unique index is on `status = 'pending'`, and the status enum has no `expired`. An invite that expires after 30 days stays `pending`, so create refuses "no pending invite", and the parent can't invite again. The two allowed refusals don't even let the UI say why.
  - The same happens to an invite for a removed parent's email (create refuses only the caller's own email and the active parents' emails; accept refuses a removed link). It also happens to an invite whose inviter was removed concurrently with the create: create doesn't take the student lock, so the removal trigger can't see the uncommitted invite.
- **Incompatible pair:** Story 3 (create refuses while pending exists) and story 3's own expiry-at-read rule. Story 4's removal trigger misses an invite created in parallel.
- **AD fix (AD-16):** "Create locks the student's `profiles` row (the AD-10 lock). In the same transaction it marks `cancelled` (or a new `expired` status) every pending invite for the student that is expired or whose inviter is no longer actively linked, before it checks and inserts. A pending invite counts as pending only while it is unexpired and its inviter is linked. The partial unique index stays as the backstop." Also refuse, or silently accept but never deliver, invites to emails with a removed link. Pick one, because a refusal there would reveal something.

### H-5. Parent rejection and un-approval have three conflicting rules

- **Conflict:**
  - AD-4 says rejecting a parent deletes the `parents` row, plus the auth user for a parent-only login.
  - SPEC Assumptions say a parent who loses approval keeps the link without access.
  - AD-10 says deleting a parent who is a student's last link is refused.
  - In the built code, `stamp_parent_review` (0023) allows approved to rejected, and the admin can make that change directly through `parents_update_admin`. `rejectParent` then retries `deleteUser` for any `rejected` row of a parent-only login. For a sole parent, `deleteUser` now fails with a generic 500 forever. For a co-parent, the cascade **deletes** the links: no `removed_by`/`removed_at`, the removal-cancels-invites trigger doesn't fire (it is "on removal"), and the "no re-invite after admin removal" record is gone.
  - The spine also doesn't say whether `student_parents.parent_id` references `parents(id)` or `profiles(id)`. With `parents(id)`, deleting a teacher-parent's `parents` row cascades their links. With `profiles(id)`, the links stay.
- **Incompatible pair:** Story 1 (FK target choice) and story 4 (admin removal audit). The existing `rejectParent` and teacher Remove (`demote_teacher_to_parent` requires approved, otherwise `deleteUser`).
- **AD fix (AD-4 and AD-10):**
  - "A `parents` row with an active link can't move out of `approved` and can't be deleted. The admin first removes its links through the AD-10 function, which is refused for the last link. `stamp_parent_review` refuses approved to rejected while active links exist."
  - Pin `student_parents.parent_id references profiles(id) on delete cascade`.
  - The removal trigger fires on both `UPDATE` of `removed_at` and `DELETE`.
  - Replace the SPEC assumption about losing approval, or state that the path is unreachable.

### H-6. Deletion-request visibility for a removed parent contradicts the built policy

- **Failure path:** 0029's `deletion_requests_select` is `requested_by = auth.uid() or is_parent_of(student_id) or ...`. SPEC says the removed parent no longer sees their request. AD-9 only says SELECT "covers every `is_parent_of`" and that a request "survives its requester's link removal". A story that only adds the second parent (already covered by `is_parent_of`) leaves the `requested_by` clause in place, so removed parent B keeps seeing the child's pending deletion and its outcome.
- **Incompatible pair:** Story 2 (both parents see it, minimal diff) against the SPEC constraint, which story 4's removal tests assert.
- **AD fix (AD-9):** "SELECT on `deletion_requests` is `is_parent_of(student_id) or student_id = auth.uid() or is_admin()`. The `requested_by = auth.uid()` clause is dropped."

### H-7. Showing another parent's name has no owned read path

- **Failure path:**
  - CAP-3 shows the deletion requester to the other parent, and AD-13 shows `set_by` "in parent and teacher views". Parents have no SELECT on a co-parent's `profiles` row, and teachers have none on parents' rows.
  - Story 2 will add a `profiles` SELECT policy "co-parent may read". Story 4 uses `student_parent_contacts()`. That gives two read paths for the same fact, which AD-12 forbids.
  - `student_parent_contacts()` returns **active** parents only, so a leave answer or deletion request from a removed parent B can't be named by anyone. It also hands email addresses where only a name is needed.
- **AD fix (AD-12):** "Actor names on leave and deletion rows (`set_by`, `requested_by`) resolve through one security-definer `actor_display_name(student_id, actor_id)`. It returns a display name when the caller may see the student (self, `is_parent_of`, class teacher, admin) and the actor is or was linked to that student (removed links count), or is staff. No new `profiles` policy for co-parents."

## Medium

### M-1. Two owners of `handle_new_user`, and AD-11's "found/not-found only" pre-check contradicts CAP-5 and 0042

Story 1 rewrites `handle_new_user` (link insert, rename). Story 5 adds the AD-11 duplicate check (invite or link with the same name) to the same function. AD-11 says the pre-check returns only found/not-found, but 0042's `student_registration_state` already returns `pending`/`approved`/`rejected`, and CAP-5 must "point B to the invite". **Fix (AD-11):** Story 1 owns the whole `handle_new_user` rewrite, including the invite and link name check. Story 5 owns only `student_registration_state` and `/join`. The pre-check returns `not_found | available | pending | approved | rejected | invited`, and it stays service-role-only.

### M-2. Accept doesn't check name duplicates

B registered their own "Tenzin" earlier (or concurrently: registration locks B's `parents` row, but invite create doesn't). A invites B to A's Tenzin, and B accepts, so B is now linked to two Tenzins. CAP-5 only guards `/join`. **Fix (AD-16):** Accept locks the caller's `parents` row (the same lock AD-11 registration takes) and refuses when the caller already has an active link, or `registered_by_parent_id`, to a student with the same normalised `registration_name`. The refusal points to the existing child. Or record this as an accepted non-goal.

### M-3. Lock order isn't specified, so deadlocks are possible

- Accept: student `profiles` row, then the FK key-share on the caller's `parents` row.
- Parent reject or delete: the `parents` row first, then the cascade, then (with C-1) the student row.
- Registration: the `parents` row, then a new profile.

**Fix (Consistency Conventions):** "Lock order: student `profiles` row(s) by id, then `parents` row(s) by id. Functions that need both take them in that order up front."

### M-4. "Only AD-11 and AD-16 create links" contradicts the migration and story 2's service-role fixtures

The migration inserts links, and story 2 is told to "test with links created by service-role fixtures". A strict story 1 could enforce "only trusted functions" with a trigger and break story 2's tests. AD-11's "inserts the slot-1 link **or raises**" has no carve-out for app_metadata fixtures without a parent, which 0024 and the SPEC keep. **Fix (AD-10, AD-11):** List the writers: sign-up trigger, accept, the remove function, the migration, and the service role, which is test fixtures only. The sign-up trigger raises only for user-metadata students.

### M-5. Values of migrated and registration links are undefined, but the admin view depends on them

Story 4 shows "who invited each one and when". AD-10 doesn't say what `invited_by` and `linked_at` hold for slot-1 links from sign-up or the migration. **Fix (AD-10):** `invited_by is null` means a registration link. `linked_at` is the student's `created_at` for migrated rows and `now()` otherwise. The UI shows "registered" for those.

### M-6. Invite cancellation runs on a status change that can't happen, and nothing runs on a student delete that leaves links behind

Approved students can't become rejected (the 0051 review policy only touches `pending`), and invites exist only for approved children. So "rejecting the student cancels its pending invites" is dead, and story 3 or 4 could each build a trigger for it. **Fix (AD-16):** Name one owner. State the trigger as "any change of the student's `status` away from `approved`" (future-proofing), owned by story 3, or drop the clause.

### M-7. The accept email check reads a `profiles.email` that is never re-synced

0006 syncs only `email_confirmed_at`. The `profiles.email` copied at sign-up never follows an auth email change, and the admin does call `updateUserById` on teachers. A teacher-parent whose login email changed accepts against the old address. **Fix (AD-16):** Accept compares against `auth.users.email`, confirmed and read inside the security-definer function, or the spine adds an email-sync trigger.

### M-8. Deleting and re-registering bypasses "no re-invite after admin removal"

The removed-link record is keyed by `parent_id` and cascades away when the account is deleted. A new account with the same email can be re-invited. **Fix (AD-16):** Also refuse accept when a removed link exists for the student whose parent email (snapshot `removed_email` on removal) equals `invited_email`. Or record this as accepted.

## Low

- **L-1.** Slot semantics are unstated. Some code (contacts order, "primary" parent, push) could treat `slot = 1` as the registrant after A is removed and B holds slot 2. **Fix:** "`slot` exists only for the uniqueness index and carries no meaning; display order is `linked_at`."
- **L-2.** A rejected child's link keeps its parent undeletable, because the last-link rule covers rejected students, until a teacher clears the row. **Fix:** State that this is intended, or exempt students whose status is `rejected` from the last-link rule.
- **L-3.** AD-16 doesn't say who may cancel: the inviter only, any linked parent, or the admin. **Fix:** Any linked parent of the student, plus the admin.
- **L-4.** The migration's "stop if a row would break the new rules" doesn't list which rules: a link to a non-approved `parents` row, a non-student with `parent_id`. **Fix:** List the pre-checks in AD-10 the way 0042 does.
- **L-5.** The last-link refusal surfaces through GoTrue `deleteUser` as a generic 500. **Fix:** Server actions pre-check the last link and map the error to a localized message.

## Counts

Critical 1, High 7, Medium 8, Low 5.
