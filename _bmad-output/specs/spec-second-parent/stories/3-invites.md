---
title: 'Story 3: Invites'
type: 'feature'
created: '2026-10-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '9de46963f779c9b22a3f70d0443e771b70afb4fb'
context:
  - '{project-root}/_bmad-output/specs/spec-second-parent/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A child can hold two parent links (stories 1–2), but the only path that creates a link is sign-up. There is no way for a parent to bring in the second parent (SPEC CAP-1, CAP-2).

**Approach:** Follow spine AD-16.
- A linked parent invites an email from the child page, sees the pending invite there, and can cancel it.
- An approved parent whose confirmed email matches sees the invite on `/parent` and accepts it.
- Accepting creates the slot-2 link through a trusted function.

## Boundaries & Constraints

**Always:**
- Migration `0056_parent_invites.sql`, per AD-16:
  - **Table `parent_invites`:**
    - `student_id` → profiles, on delete cascade.
    - `invited_email` is stored as `lower(btrim())`.
    - `invited_by` → profiles, on delete set null.
    - `created_at`, `expires_at`, and `status` (`pending` / `accepted` / `cancelled` / `expired`).
    - A partial unique index allows one `pending` row per student.
    - RLS allows SELECT only, for the student's active parents and the admin. There is no write policy.
  - **Invite lifetime:** setting `parent_invite_days` (`{"days": 30}`) in `app_settings`. Read it with a typed fallback of 30.
  - **One live-invite helper:** pending, unexpired, and the inviter still actively linked. Create, cancel, list and accept all use it.
  - **Functions:** `create_parent_invite(student, email)`, `cancel_parent_invite(invite)`, `list_my_parent_invites()` and `accept_parent_invite(invite)`.
    - All are plpgsql, `security definer`, `search_path = ''`, VOLATILE, and EXECUTE `authenticated` only.
    - "Not found" and "not allowed" both raise `42501`. Business refusals raise `22023` with a stable hint.
  - **Create:**
    - Requires `is_parent_of(student)`.
    - Locks the student's `profiles` row.
    - Marks stale pending rows `expired`.
    - Refuses with exactly four hints: `not_your_child`, `child_has_two_parents`, `own_or_linked_email`, `invite_pending`. None depends on whether the email has an account.
  - **Cancel:** any active parent of the student may cancel a pending invite.
  - **List mine:** the live invites whose `invited_email` equals the caller's confirmed `auth.users` email, for a caller with an approved `parents` row. It returns the invite id, the child's name, the inviter's display name and `expires_at`.
  - **Accept:**
    - Locks the caller's `parents` row first, then the student's `profiles` row.
    - Re-checks every AD-16 condition and inserts the link into the free slot with `invited_by` set.
    - Marks the invite `accepted`.
    - Refusal hints: `invite_not_live`, `child_has_two_parents`, `removed_parent`, `duplicate_child_name`.
  - **Triggers:**
    - Removing a link cancels that parent's pending invites for the student.
    - Setting a student to `rejected` cancels the student's pending invites.
- **Child page (overview tab):**
  - An invite card: an email form when the child has one active parent and no live invite; the pending invite (email and expiry) with a Cancel button when one exists; nothing when the child has two parents.
  - Plain FormData actions `inviteParent` and `cancelInvite`, following `requestDeletion`.
  - The email is checked with `isValidParentEmail`.
- **`/parent`:** an invites card above the state chain, shown only when `state === 'approved'`, so an invitee with no children still sees it. Each invite has an Accept button (action `acceptInvite`). After accepting, the child appears in the list.
- **Errors:** one TS mapper per action in `src/lib/server/parent-invites.ts` (hint → message, `42501` → not allowed, otherwise failed).
- **Text:** all new text is in en, de and bo.
- **Types:** the new table and functions are added to `database.types.ts` by hand.
- Decision (agent, 2026-10-27): the invitee has no Decline action. AD-16 has no declined status, and an ignored invite expires.

**Never:**
- No email is sent.
- No admin linking, no link removal (story 4), and no `/join` or `handle_new_user` changes, including the `already_invited` hint (story 5).
- No policy matches on email text.
- No refusal or response reveals whether an email has an account. Never use `emailHasLogin`.
- Never run `supabase:types`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Invite | A, the only parent, invites `B@x.de ` | Pending invite for `b@x.de`, shown with its expiry | — |
| Refusals | Not A's child / two parents / A's own email / a second invite | Refused with the matching message | Hints `not_your_child`, `child_has_two_parents`, `own_or_linked_email`, `invite_pending` |
| Unknown email | The email has no account | Same success as any other email | — |
| Cancel | A cancels | The invite is gone; the form is back | — |
| Accept | B is approved with a confirmed, matching email | B sees the invite on `/parent`; after Accept the child is listed and A and B both have links | — |
| Wrong email | An approved parent C with another email | C lists nothing; accepting B's invite id is refused | `42501` |
| Not live | Expired, cancelled, or inviter link removed | Not listed; accept refused | `invite_not_live` |
| Race | Two accepts, or an accept while two links already exist | At most two links | `child_has_two_parents` |
| Removed parent | B's earlier link to the child was removed | Accept refused | `removed_parent` |
| Same name | B already has a child with the same `registration_name` | Accept refused | `duplicate_child_name` |
| Student rejected | A pending invite, then the student is rejected | The invite becomes `cancelled` | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0054_student_parents.sql`:
  - `student_parents` (:84, `invited_by` :103) and its triggers. The BEFORE INSERT trigger (:181) already locks `parents` `for share`.
  - Removal (:226), keep-one (:279/:313), `has_link_to` (:132), `is_parent_of` (:529).
  - RPC template to copy: `decide_class_join` (:806-864). Grants at :151.
  - Lock re-check pattern: `handle_new_user` (:428-433). Name rule: `lower(btrim(registration_name))` (:692-719).
- `app_settings`: seed as in `0027_session_leave.sql:31`; typed read as in `0025_parent_reads.sql:243-249`.
- Student reject: a plain update in `src/routes/requests/+page.server.ts:423-464`. The trigger goes on `profiles` `after update of status`, with WHEN as in `0043_auto_team_assignment.sql:87`.
- Email: compare `lower(btrim(u.email))` against `auth.users` with `email_confirmed_at is not null`. `profiles.email` is not synced, so don't use it.
- Child page `src/routes/parent/children/[id]/`:
  - Actions at `+page.server.ts:614`; copy `requestDeletion` (:747-769).
  - The card goes in the overview grid of `+page.svelte` before the deletion section (:500). Form, enhance and toast pattern at :17, :89, :142-153, :577.
  - The active-link count comes from `student_parents` (parents read the active rows).
- `/parent`: `+page.server.ts` (load only; add `actions`), `+page.svelte` (state chain :58-82).
- Error mappers: copy `src/lib/server/class-join.ts:9,41-52` (`PgError`, hint switch). Email check: `isValidParentEmail` in `src/lib/server/parent-registration.ts:13`.
- `database.types.ts`: add `parent_invites` after `parents` (:857), and append the functions.
- Messages: use the prefixes `invite_*` (child page) and `parent_invites_*` (landing).
- Tests:
  - `rls.spec.ts`: helpers `createApprovedParent` :594, `createPendingParent` :619, `signUpStudent` :653; story-1 helpers at :17319 (`signIn`, `child`, `twoParentFamily`, `removeLink`). Add a story-3 block at the end.
  - Page specs: `parent/children/[id]/page.server.spec.ts` (`fakeSupabase` :18, `event` :171) and `parent/page.server.spec.ts:59`.
  - e2e: `e2e/parent-mobile.e2e.ts:155-200` and the `linkParent` and `signIn` fixtures.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0056_parent_invites.sql` -- the table, setting, helper, four functions and two triggers -- AD-16.
- [x] `src/lib/supabase/database.types.ts` -- add the table and functions.
- [x] `src/lib/server/parent-invites.ts` and its spec -- the error mappers.
- [x] `src/routes/parent/children/[id]/+page.server.ts`, `+page.svelte` and the spec -- the invite card, `inviteParent` and `cancelInvite`.
- [x] `src/routes/parent/+page.server.ts`, `+page.svelte` and the spec -- the invites card and `acceptInvite`.
- [x] `messages/{en,de,bo}.json` -- the new keys.
- [x] `src/lib/server/rls.spec.ts` -- one test per matrix row.
- [x] `e2e/parent-invite.e2e.ts` -- A invites, B (an approved fixture parent) accepts on `/parent` and then opens the child page.

**Acceptance Criteria:**
- Given an invite for an email with no account and one for an email with an account, when A submits each, then the responses are identical.
- Given B accepted, when B opens the child page, then B sees the same overview as A, and A's invite card shows nothing.

## Implementation Notes

- `not_your_child` is raised with errcode `42501` (it is the "not allowed" case) and the hint; the mappers check the hint before the code.
- The live-invite helper is `parent_invite_is_live(parent_invites)` (a whole-row argument), internal: not executable by `authenticated`.
- `cancel_parent_invite` refuses a non-live invite with `22023` / `invite_not_live` (not one of the four create hints).
- `accept_parent_invite` checks the email (42501) before anything that would reveal the invite's state. An invitee who already has an active link to the child gets `invite_not_live` (unreachable through the app).
- Create also locks the caller's `parents` row `for share` before the student's `profiles` row, to keep the AD-10 lock order.
- `invited_email` has check constraints: normalised (`= lower(btrim())`) and a basic `x@y` shape.
- The `/parent` invites card is hidden when the approved parent has no live invites (shown on a load error).

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | verification-gap, blind | No test drives the Cancel form; the e2e only checks the button is visible | medium | Pre-verified: grep finds no click on "Cancel invite"; unit and RLS tests bypass the template | patch |
| 2 | verification-gap, blind | A failed `student_parents` read in the child-page load is untested | low | Pre-verified: the only error case fails `parent_invites`. One test case | patch |
| 3 | verification-gap, blind | Nothing shows `parent_invite_days` is read; the seed and the fallback are both 30 | low | Pre-verified: no test sets another value. One RLS case, restored in `finally` | patch |
| 4 | verification-gap, blind | The child page's "pending" filter is not the shared live predicate (no inviter-still-linked check) | low | The removal trigger cancels the inviter's invites, so only rows written outside the functions (service role) reach it. Fixing it means exposing the predicate (new surface) | reject |
| 5 | blind | An invite to a parent the admin removed is created but can only fail at accept | low | Link removal is admin-only (story 4) and the inviter can cancel. The frozen intent fixes create at exactly four hints; a fifth adds a branch | reject |
| 6 | blind, edge | `list_my_parent_invites` lists invites the caller cannot accept (two parents, removed link, same name) | low | Create refuses a two-parent child, so it needs a later admin link or a past removal. Accept then shows the matching message. The frozen intent defines the list as the live invites | reject |
| 7 | blind | Stale invites from an unlinked inviter are retired as `expired`, not `cancelled` | low | Reachable only when the inviter's profile is deleted (`invited_by` set null). Nothing reads the reason | reject |
| 8 | blind | No audit columns (who or when for a status change) | low | Not in AD-16 or the intent; adds schema surface | reject |
| 9 | blind | The own/linked-email check scans `auth.users` on `lower(btrim(u.email))` | low | True: the expression defeats the email index. Direct correction: restrict by user id (the caller and the active linked parents), then compare emails | patch |
| 10 | blind | `cancel_parent_invite` does not follow the documented lock order | low | It locks only the invite row and takes no other lock, so it cannot deadlock against create or accept. The header comment overstates it; a one-line comment fix | patch |
| 11 | blind | The invite reads add a serial round trip to every child-page load | low | True: the `Promise.all` at :297 runs after the requests read. Direct correction: start the reads with the earlier ones and await them later (spec-navigation-latency) | patch |
| 12 | blind, edge | A refusal message is lost when the reloaded card disappears (two parents after a race) | low | Needs a second parent linked between the page load and the submit; the DB still refuses. Fixing it means restructuring the template | reject |
| 13 | blind | Focus target `invite-cancel` is missing after a failed cancel | false | With `enhance`, a failed action does not reload `data`, so the pending card and its Cancel button stay rendered | reject |
| 14 | blind | The load-error card's heading and test id differ from the normal card | low | True (`ui.cardTitle` vs the hard-coded class, no `data-testid`). Direct correction | patch |
| 15 | blind | Untested paths: unconfirmed email at accept, client DELETE, the `removed_parent` mapping in the `/parent` spec, non-parent roles, a pending child | low | Unconfirmed email is a frozen rule (confirmed email only) with no test. DELETE and the mapping are one line each. Non-parent roles and pending children fail `is_parent_of` (0054:529, which requires an approved student and a parent role) or the email match, and are covered by "not your child". Patched: local auth cannot sign in an unconfirmed user, so the test covers an unconfirmed email *change* (the auth email stays the old one) instead of the `email_confirmed_at` filter itself | patch (first three) |
| 16 | blind | Race tests: same-user only; `expect(a.id).not.toBe(x.id)` asserts nothing | low | The useless assertion is a direct deletion. A cross-user race on one invite cannot happen (the email must match), and a concurrent admin link is story 4 | patch (deletion only) |
| 17 | blind | e2e browser contexts are not closed in `finally` | low | True; direct correction | patch |
| 18 | blind | `parent_invites_intro` is singular above a list that can hold several invites | low | True for an email invited for two children. Direct wording fix in en, de and bo | patch |
| 19 | blind | The list shows `display_name`, but the duplicate check uses `registration_name` | low | The refusal message names no child, so nothing contradicts; the names normally match | reject |
| 20 | edge | A huge `parent_invite_days` value overflows the interval | low | No app path writes `app_settings` (grep: only reads in src); SQL access only. Adds a guard | reject |
| 21 | edge | An email over 320 characters passes `isValidParentEmail` and fails the DB check with the generic message | low | True, but no one types such an email; adds a guard | reject |
| 22 | edge | Accept refused on a no-JS full reload when the row is gone: the error is silent | low | No-JS plus an invite that died between the render and the click; the outcome is still correct | reject |
| 23 | edge | After a cancel refused as `invite_not_live`, the stale card stays until reload | low | Needs the co-parent to cancel, or the invite to expire, while the page is open; the message explains it. Adds an `invalidateAll` branch | reject |
| 24 | edge | Accept could link through a deleted invite row (`parent_invite_is_live` of a null row returns NULL) | false | `p_invite.invited_by is not null` is false for an all-null row, so the AND is false, `not` is true, and accept raises `invite_not_live`. Deleting the student blocks on the profile lock and then refuses | reject |
| 25 | edge | Accept picks the lowest free slot, not always slot 2 | false | The frozen rule is "inserts the link into the free slot"; slot 1 is free only after a removal | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0, 0056 applies.
- `npm run test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/parent-invite.e2e.ts` -- expected: pass.
