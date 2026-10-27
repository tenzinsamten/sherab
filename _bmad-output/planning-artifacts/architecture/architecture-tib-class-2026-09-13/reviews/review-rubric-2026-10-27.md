# Rubric Review: 2026-10-27 second-parent amendment

- **Target:** `ARCHITECTURE-SPINE.md` (AD-4, AD-9, AD-10, AD-11, AD-12, AD-13, AD-16, ERD, capability map, Deferred)
- **Decision log:** `.memlog.md`, entries from "2026-10-27 Update run started"
- **Driving input:** `specs/spec-second-parent/SPEC.md`, `brownfield.md`, `stories.yaml`
- **Brownfield checked:** migrations 0006, 0023, 0024, 0025, 0027, 0029, 0031, 0033, 0037, 0042, 0051; `src/routes/requests`, `admin/teachers`, `admin/parents`, `calendar`, `teacher/classes/[id]`
- **Reviewer:** independent (rubric walk + input reconciliation), 2026-10-27

## Verdict

The amendment is sound. The link table with slots, the partial unique indexes, the admin-only removal function that locks the student row, the invite functions with accept-time re-checks, and the rename to `registered_by_parent_id` cover most of the real divergence points. AD-4 and AD-12 amend the helpers so that existing policies pick up the second parent without per-policy edits, which fits the brownfield code (0025/0051 already route every policy through `is_parent_of`).

There are no critical findings. Five high findings need fixing before story 1 starts. Two of them conflict with the brownfield schema (a RESTRICT FK, and the `requested_by = auth.uid()` clause in the deletion SELECT policy). One is an expiry/index interaction that would block a child from ever getting a new invite. One is a concurrency gap in the zero-link rule. One leaves CAP-5's "point them to the invite" path unspecified while the AD-11 wording contradicts the existing pre-check.

## Rubric walk

| Check | Result |
| --- | --- |
| Fixes the divergence points for the 5 stories, misses none | Mostly. Missing: SELECT on `student_parents` (stories 2/4), how actor names are resolved (stories 2/4), the CAP-5 pre-check contract (story 5), story 1's transitional state after the rename |
| Every Rule is enforceable and prevents its divergence | Mostly. The zero-link trigger is not concurrency-safe as written. The one-pending invite index plus read-time expiry blocks re-invites |
| Nothing under Deferred lets two units diverge | One stale item: "Parent notifications: no push" contradicts AD-12's push recipients and spec CAP-3 |
| Ratifies, not contradicts, brownfield | Two conflicts: the 0024 `ON DELETE RESTRICT` FK, and the 0029 `deletion_requests_select` requester clause. Column name `set_by` vs. the actual `answered_by` (0027) |
| Covers spec-second-parent CAP-1..6 and all Constraints | Gaps listed in "Spec claims that did not land" below |
| No amended AD contradicts another | AD-12's "no write policy anywhere except" vs. existing own-row tables (low). Deferred vs. AD-12 on push (medium). AD-16's refusal set vs. the spec's four refusals (medium) |

## Spec claims that did not land (or landed incompletely)

1. **Constraint:** "Removing a parent's link leaves that parent's pending deletion request ... the removed parent does not [see it]." AD-9 adds `is_parent_of`, but the existing `requested_by = auth.uid()` clause stays, so the removed parent still sees the request (H-2).
2. **Constraint:** "Deleting a parent account ... When a co-parent remains, it removes only that parent's links." This is blocked by the `registered_by_parent_id` RESTRICT FK (H-1).
3. **Constraint:** "Two removals at the same time never yield ... zero." This holds only for the admin removal function, not for cascade deletes (H-4).
4. **Constraint:** "One pending invite per child ... expires after 30 days." Together with the partial unique index on `status = 'pending'`, an expired invite blocks every later invite (H-3).
5. **CAP-5:** "refuses ... and points them to the invite." No contract for how the refusal reaches the UI. `student_registration_state()` (0042) is not addressed (H-5).
6. **CAP-1:** four distinct refusals (not linked, two parents, own email, second pending invite). AD-16 says the only distinct refusals are two of them (M-1).
7. **CAP-6:** "A leave answer set by B shows B's name." There is no read path for a parent's display name to teachers or to the co-parent (M-3).
8. **CAP-4:** "lists both parents with inviter and date." No SELECT policy is stated for `student_parents` (M-2).
9. **Constraint:** "The app sends no invite email." This is only implied by the stale Deferred bullet. Not stated in AD-16 (L-6).
10. **Assumption:** "A parent the admin removed cannot be re-invited ... a re-invite cannot undo the admin's removal." Accept covers this, but the removed parent can still register a duplicate of the child at `/join` (M-6).

## Findings

### Critical

None.

### High

**H-1. `registered_by_parent_id` keeps 0024's `ON DELETE RESTRICT`, which blocks the spec's co-parent deletion rule**
- **Location:** AD-10, bullets 2 and 4. Brownfield: `0024_parent_first_registration.sql` (`references public.parents (id) on delete restrict`).
- **Problem:** AD-10 says deleting a parent account removes only that parent's links when a co-parent remains. The renamed column still has a RESTRICT FK to `parents`. Deleting the registering parent (A) therefore fails even when B is linked, so the spec's Constraint ("When a co-parent remains, it removes only that parent's links") cannot hold. One story will hit this and fix it locally: dropping the FK, setting null, or keeping RESTRICT. Each choice changes 0042's uniqueness behaviour differently.
- **Fix:** Add to AD-10: "The rename changes the FK to `ON DELETE SET NULL`. The last-link refusal comes only from the zero-link trigger, never from this FK. 0042's unique index ignores null `registered_by_parent_id` (it already filters `is not null`)." Also state that the "registered by" display shows a neutral label when the value is null.

**H-2. AD-9 does not remove 0029's `requested_by = auth.uid()` SELECT clause, so a removed parent keeps seeing the request**
- **Location:** AD-9, final two sentences. Brownfield: `0029_deletion_requests.sql:65-72`.
- **Problem:** The spec requires that the removed parent no longer sees their pending deletion request. The existing policy is `requested_by = auth.uid() or is_parent_of(student_id) or student_id = auth.uid() or is_admin()`. AD-9 only says "SELECT covers every `is_parent_of`", so story 2 will add nothing and the requester clause will keep showing the request to B after removal. This is a privacy gap in the exact scenario the spec calls out (admin removal).
- **Fix:** Add to AD-9: "SELECT is `is_parent_of(student_id) or is_admin()` (plus the student). The `requested_by = auth.uid()` clause is dropped, so a removed requester loses sight of the request. `requested_by` is display only." Add an RLS test: B requests, admin removes B, B reads zero rows and A reads one.

**H-3. The partial unique index on `status = 'pending'`, combined with read-time expiry, blocks every invite after one has expired**
- **Location:** AD-16, bullet 1 ("A partial unique index allows one pending invite per student. Expiry is evaluated at read and accept time").
- **Problem:** An expired invite keeps `status = 'pending'` because there is no `expired` status and no cron job. The index then rejects any new invite for that child forever. Create's "no pending invite" check is also ambiguous: does it count expired rows or not? Stories 3 and 5 (the CAP-5 trigger check of a "pending invite") will each define "pending" differently.
- **Fix:** Define one predicate in AD-16: "An invite is live when `status = 'pending' and expires_at > now()`. Create, list-mine, accept, the CAP-5 sign-up check and the UI all use this predicate (one SQL helper). Inside the student-row lock, create first sets any expired pending invite for the student to `status = 'expired'` (add the value), then inserts." Alternatively, cancel expired invites inside create. Either way, the index can then stay on `status = 'pending'`.

**H-4. The zero-link deferred trigger is not concurrency-safe for cascade deletes**
- **Location:** AD-10, bullet 2.
- **Problem:** The admin removal function locks the student's `profiles` row, but parent-account deletion removes links through FK cascade, which does not take that lock. Two concurrent transactions (deleting A's account and B's account, or deleting A's account while the admin removes B) each count the other's link as still active at commit under READ COMMITTED. Both pass, and the student is left with zero links. This violates the spec's explicit "two removals at the same time never yield ... zero".
- **Fix:** Add to AD-10: "The zero-link constraint trigger locks the student's `profiles` row (`select ... for update`) before counting active links, so every path that ends a link (admin removal, parent deletion cascade, any future path) serializes on the same row as accept." Add a concurrency test with two sessions.

**H-5. The CAP-5 refusal path has no contract, and the AD-11 wording contradicts the existing `student_registration_state()` pre-check**
- **Location:** AD-11 ("The server action's pre-check exists only to show the 'No parent account found' message and returns only found/not-found"). Brownfield: `0042_student_unique_per_parent.sql`, `student_registration_state()`, which returns `available`/`pending`/`approved`/`rejected` and joins `s.parent_id`.
- **Problem:** CAP-5 needs `/join` to "point B to the invite". The spine puts the check only inside the auth-user trigger, which raises and rolls back the sign-up, and AD-11 says the pre-check returns only found/not-found. The brownfield already has a second, richer pre-check that story 5 would naturally extend, against the AD-11 wording. If it is not extended, the trigger's raw exception reaches the user. Story 5 will either extend the function to read invites (by email), parse the trigger error, or add a new RPC. These are three incompatible shapes.
- **Fix:** Add to AD-11: "`student_registration_state(guardian_email, registration_name)` (service role only) is the single pre-check for duplicates. It returns `invited` when the approved parent with that email holds a live invite (H-3 predicate) or an active link to a student with that trimmed, case-insensitive name. The trigger raises a stable error (`errcode 23505`, hint `already_invited`) for the race, and `/join` maps both to the same message." Reword "returns only found/not-found" to apply only to the parent-account check.

### Medium

**M-1. AD-16's refusal set contradicts CAP-1**
- **Location:** AD-16, bullet 3 ("the only distinct refusals are 'not your child' and 'child already has two parents'").
- **Problem:** CAP-1 lists four refusals: not linked, two parents, own email, second pending invite. None of them depends on whether the email has an account. If "only two distinct refusals" is read literally, the own-email and pending-invite cases must show a generic or misleading message. Stories 3 (function) and the UI will also invent their own error codes.
- **Fix:** List the error contract: `not_your_child` (42501), `two_parents`, `own_email`, `invite_pending` (22023 hints). State the invariant as: "no refusal or success differs by whether `invited_email` has an account." Note that refusing the active parents' emails reduces to `own_email`, because an invite is possible only with one active link.

**M-2. No SELECT policy for `student_parents`**
- **Location:** AD-10, AD-12, ERD.
- **Problem:** CAP-4 (admin: inviter and date) and story 2 fixtures and story 4 views need to read links. The spine says who writes, but not who reads the base table. Story 1 may leave it closed (functions only) while story 4 adds a policy for the admin, the co-parent, or teachers. That opens a second contact path beside `student_parent_contacts()`.
- **Fix:** Add to AD-10: "SELECT on `student_parents` is admin only (active and removed rows). Every other reader goes through `linked_children()`, `is_parent_of()` and `student_parent_contacts()`."

**M-3. No read path for the actor's name in "which parent set each answer"; column name mismatch**
- **Location:** AD-13, bullet 4 ("`set_by` (AD-5) identifies the parent and is shown in parent and teacher views"). Brownfield: `0027_session_leave.sql:143`, where the column is `answered_by`.
- **Problem:** Teachers cannot read parent `profiles` rows: `profiles_select_admin_or_teacher_of_student_class` covers students, and `profiles_select_parent_of_child` covers children only. Story 2 (parent view) and story 4 (teacher view) will each pick a way to turn `answered_by` into a name, for example a new profiles policy (broad exposure) or a function. A parent who has since been removed will also not appear in `student_parent_contacts()`. The spine also names a column that does not exist.
- **Fix:** Use `answered_by`. Add: "Actor names are resolved only through a security-definer function (e.g. extend `student_parent_contacts()` or add `leave_answer_actors(student_id)`). It returns the display name for any `answered_by` on that student's leave rows to the same audience, including parents removed since. No new `profiles` SELECT policy."

**M-4. Story 1's rename leaves AD-10 broken until story 2**
- **Location:** AD-10, bullet 4. The memlog ("Story 1 renames references mechanically; story 2 moves the brownfield.md readers onto links") was not carried into the spine.
- **Problem:** Renaming the column breaks SQL and plpgsql function bodies stored as text: the push recipient query (0037), `student_registration_state` (0042), `linked_children`, and `is_parent_of`, plus the calendar and admin-parents queries. A "mechanical" rename makes them read `registered_by_parent_id` for access, which AD-10 forbids. Story 1 is then either non-compliant or silently does story 2's work.
- **Fix:** State the split in the spine. Story 1 rewrites every DB-side reader (helpers, 0037 push recipients) onto links inside the same migration. Only TypeScript readers listed in `brownfield.md` may keep a temporary `registered_by_parent_id` read until story 2, and story 2 must delete them. Alternatively, require story 1 to move all readers.

**M-5. The Deferred "Parent notifications" bullet contradicts AD-12 and spec CAP-3**
- **Location:** Deferred ("Parent notifications: PRD non-goal; no email/push beyond Supabase Auth's own emails").
- **Problem:** Homework push to parents exists (0037, #92). AD-12 now routes push recipients through links, and the spec requires that B receives push. A reader of Deferred will conclude that push to parents is out of scope.
- **Fix:** Reword it to: "No email beyond Supabase Auth's own (no invite email, spec-second-parent). Homework push (#92) goes to every actively linked approved parent per AD-12."

**M-6. A removed parent can register a duplicate of the child, and "no removed link" is checked only at accept**
- **Location:** AD-11 (the CAP-5 clause covers "pending invite or active link"), AD-16 accept.
- **Problem:** The spec assumes a re-link cannot undo an admin's removal. After removal, B can register "Tenzin" again at `/join`. The CAP-5 check ignores removed links, so B gets a new duplicate student with a slot-1 link, which is the duplicate CAP-5 exists to prevent. A's invite to a removed B also sits in `list mine` for 30 days and is unacceptable, with no defined message.
- **Fix:** Extend the AD-11 CAP-5 clause to "live invite, active link, **or removed link**", with the same refusal. In AD-16, specify that list-mine omits invites the caller cannot accept (removed link, inviter no longer linked) and that accept returns one generic `invite_unavailable`.

**M-7. FK actions on actor columns and the invite-cancel trigger on hard deletes are unspecified**
- **Location:** AD-10 (`invited_by`, `removed_by`), AD-16 (`parent_invites.invited_by`; "trigger on removal").
- **Problem:** If `invited_by`/`removed_by` are RESTRICT, deleting an inviting parent or the admin who removed someone fails, and stories will diverge on the choice. The "cancel on removal" trigger is written for the `removed_at` update. A link ended by cascade delete does not fire it, and a pending invite by the deleted parent would then hold the one-pending slot until it expires.
- **Fix:** State "`invited_by` and `removed_by` (both tables) are `ON DELETE SET NULL`. Cancelling an invite fires on any end of the inviter's link (update to `removed_at` or delete)." Also state that `parent_invites.invited_by` set to null makes the invite unacceptable.

**M-8. The zero-link invariant at creation is left implicit**
- **Location:** AD-10, bullet 2. AD-11 (app_metadata students "may have no parent", 0024).
- **Problem:** The spec says "at least one while the student exists". It also says link-less service-role fixtures stay untouched. The spine's "refuses leaving ... zero" only governs transitions. Someone may add a check on `profiles` insert (breaking fixtures and the app_metadata branch) or nothing at all.
- **Fix:** Add: "The invariant is that the count never goes from ≥1 to 0. Students created through the app_metadata branch with no parent (fixtures) are legal with zero links, and no constraint fires on `profiles` insert."

**M-9. Spec capability IDs collide with v1 CAP-1..6**
- **Location:** Frontmatter `binds`, AD-10/AD-16 `Binds`, the capability map row, and the memlog ("CAP-5 of spec-second-parent").
- **Problem:** spec-second-parent numbers its capabilities CAP-1..6, the same IDs as the spine's v1 CAP-1..6. "Binds: CAP-1" in AD-10 is ambiguous, and stories citing "CAP-5" could mean Badges or the Join check.
- **Fix:** Namespace them (e.g. `SP-CAP-1..6`) in Binds and in the map row, and list which AD governs each one: SP-CAP-1/2 → AD-16; SP-CAP-3 → AD-4, AD-9, AD-12, AD-13; SP-CAP-4 → AD-10; SP-CAP-5 → AD-11; SP-CAP-6 → AD-12, AD-13.

### Low

- **L-1. AD-12's "Parents get no INSERT/UPDATE/DELETE policy anywhere except ..."** contradicts existing own-row tables (push subscriptions 0037, tours_seen 0044, badges_seen 0050). Fix: say "on student-keyed or shared data".
- **L-2. AD-9 still says "the student, or their parent" submits**, but 0029 allows only `requester_role = 'parent'` (Story 7-6). Fix: "parent only".
- **L-3. ERD is missing relationships:** `PARENTS ||--o{ PARENT_INVITES : "invited_by"` and `PARENTS ||--o{ STUDENT_PARENTS : "invited_by"`. Fix: add both edges.
- **L-4. The capability map's second-parent row omits AD-2 and AD-5.** The spec cites AD-2 for database enforcement, and AD-5 stamps `answered_by`. AD-2's `Binds` also lacks the spec. Fix: add both.
- **L-5. The AD-16 "list mine" requirements are unstated.** It should require an approved `parents` row and a confirmed email, as accept does (CAP-2: B sees the invite only after approval). Fix: state it.
- **L-6. "The app sends no invite email"** should be stated in AD-16, not left to Deferred. Fix: add one line.
- **L-7. Create does not take the student row lock.** It is harmless for the link limits (the indexes hold), but a concurrent accept can leave a live invite on a full child. Fix: create also locks the student's `profiles` row.
- **L-8. Performance.** `is_parent_of` runs per row (0051 note) and now joins `student_parents`. Fix: require a partial index `student_parents(parent_id, student_id) where removed_at is null`.
- **L-9. "Rejecting the student cancels its pending invites"** can never fire. Invites exist only for approved students, and `profiles_update_registration_review` rejects only pending ones. Harmless; mark it as belt-and-braces or drop it.
- **L-10. The self-decision guard keys on `is_parent_of`**, which requires an approved `parents` row. A linked teacher whose parent approval was revoked could then decide about their own child. This is pre-existing and now applies to two parents. Fix (optional): base the guard on an active link, regardless of approval.

## Counts

Critical 0, High 5, Medium 9, Low 10.
