---
title: 'Story 4: Admin sees both parents and removes a link'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ecbd55a27dca954a0e3799294fd77b45660797fd'
context:
  - '{project-root}/_bmad-output/specs/spec-second-parent/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A child can have two parents, but the admin cannot see who invited the second parent or when, and has no way to end a link. Today only the service role can set `removed_at` (SPEC CAP-4).

**Approach:** Follow spine AD-4 and AD-10.
- Add an admin-only trusted function that removes a link.
- Add an admin view that lists each child's parents with their inviter and link date, and offers Remove.

Scope: CAP-4 only. CAP-6 (teacher contacts and setter names) is deferred.

## Boundaries & Constraints

**Always:**
- **Migration `0057_remove_parent_link.sql`:** a function `remove_parent_link(p_student_id uuid, p_parent_id uuid)`.
  - plpgsql, `security definer`, `search_path = ''`, VOLATILE, EXECUTE `authenticated` only.
  - Lock order (AD-10): the parent's `parents` row FOR SHARE, then the student's `profiles` row FOR UPDATE.
  - It refuses with `42501` when the caller is not the admin or the link is not found. It refuses with `42501` and hint `own_child` when `has_link_to(student)` (AD-4).
  - It refuses with `22023` and hint `link_removed` when the link is already removed. It refuses with `22023` and hint `last_parent_link` when this is the only active link. The existing deferred keep-one trigger stays the backstop, and it raises the same hint with `23514`.
  - It sets `removed_at = now()` and `removed_by = auth.uid()`. It changes no other link.
  - The existing triggers still apply. The removed parent loses read access at once, through RLS on active links. Their pending invites are cancelled (0056). A deletion request they made survives (AD-9).
- **Error mapping:** one TS mapper, keyed on the hint first, then `42501` means not allowed, otherwise failed.
- Decision (human, 2026-10-28): the view extends the existing admin Parents page (`/admin/parents`). There is no new route.
- **Admin view:** under each parent, each child row of that parent's active links shows:
  - "invited by {name}", or "registered the child" when `invited_by` is null;
  - the link date (`created_at`);
  - the co-parent's name or email, when the child has a second active link.
- **Remove:**
  - On the child row: removes that parent's link to that child.
  - Shown only when the child has two active links and the admin is not linked to the child.
  - Asks for confirmation (AlertDialog) and names the parent and the child.
  - Plain FormData action `removeParentLink` on `/admin/parents`.
- **Text:** all new text in en, de and bo.
- **Types:** the function is added to `database.types.ts` by hand.

**Never:**
- No teacher contacts, no `student_parent_contacts()`, and no setter names in the teacher view (deferred CAP-6).
- No `/join` change (story 5).
- No re-linking or "undo" of a removed link.
- No client UPDATE policy on `student_parents`.
- Never run `supabase:types`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| View | Child with A (registered) and B (invited by A) | Both listed: A "registered the child", B "invited by A", each with its date | — |
| Remove | Admin removes B | B's link is removed by the admin; B no longer reads the child (`linked_children`, RLS); A is unchanged | — |
| Last link | Admin removes A after B was removed, or a child with only A | Refused; the link stays | `last_parent_link` |
| Concurrent | Two removals of A and B at once | One succeeds, at least one link remains | `last_parent_link` (22023 or 23514) |
| Admin is co-parent | The admin is linked to the child | No Remove button; a direct RPC call is refused | `42501` / `own_child` |
| Not admin | A parent or teacher calls the function | Refused, nothing changes | `42501` |
| Already removed / unknown | A removed link, or ids with no link | Refused | `link_removed` / `42501` |
| Invites | B removed while B had a pending invite out | The invite becomes `cancelled` | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0054_student_parents.sql`:
  - Table :84-114. RLS is SELECT only (:159-175); the admin reads every row, removed ones included.
  - BEFORE UPDATE guard :226-273: only `removed_at` / `removed_by` may change; it overwrites `removed_at := now()`; a removed row is frozen.
  - Deferred keep-one :279-316: hint `last_parent_link`.
  - `has_link_to` :132. RPC template `decide_class_join` :806-864. Grants as at :151.
- `supabase/migrations/0056_parent_invites.sql:467-490`: the removal trigger that cancels invites. Don't touch it.
- `src/routes/admin/parents/+page.server.ts:52-104`: reads active `student_parents` with the embed `profiles!student_parents_student_id_fkey`.
  - Parent and inviter names: embed through `profiles!student_parents_parent_id_fkey` and `…_invited_by_fkey`.
  - `profiles.email` is reliable for parents. Show `display_name || email`, as this page already does.
  - Spec `page.server.spec.ts:27` (`fakeLocals`) and `page.render.spec.ts`.
- Action pattern: `decideJoin` in `src/routes/requests/+page.server.ts:749-779` (UUID check, `fail(42501?403:400)`).
- Mapper pattern: `src/lib/server/parent-invites.ts:12-47` (hint-first, imports `PgError` from `class-join.ts`). Put the new mapper in `src/lib/server/parent-links.ts` with a spec.
- Confirmation: the AlertDialog usage in `src/routes/admin/teachers/+page.svelte`.
- Admin own-child ids: `readOwnLinkedStudentIds` in `src/lib/server/own-children.ts`.
- Messages: page-prefixed keys. Use `parents_link_*` for the parents page.
- Tests:
  - `src/lib/server/rls.spec.ts`: story-1 helpers :17319-17375 (`activeLinks`, `twoParentFamily`, `removeLink`), the story-2 admin co-parent test :18039, the story-3 block :18087. Add a story-4 block at the end.
  - `linkParent` is in `src/lib/server/testing/link-parent.ts:13`.
  - e2e: `e2e/fixtures.ts` (`signIn` :364, `linkParent` :52, `service` :36). For `createUser`, copy `e2e/parent-invite.e2e.ts:29`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0057_remove_parent_link.sql` -- `remove_parent_link` -- AD-4, AD-10.
- [x] `src/lib/supabase/database.types.ts` -- add the function.
- [x] `src/lib/server/parent-links.ts` and its spec -- the error mapper.
- [x] `src/routes/admin/parents/+page.server.ts`, `+page.svelte`, `page.server.spec.ts` and `page.render.spec.ts` -- the load (link date, inviter, co-parent, the admin's own-child ids), the `removeParentLink` action and the Remove dialog.
- [x] `messages/{en,de,bo}.json` -- the new keys.
- [x] `src/lib/server/rls.spec.ts` -- one test per matrix row.
- [x] `e2e/admin-parent-link.e2e.ts` -- the admin sees A and B with the inviter, removes B after confirming, and B's `/parent` no longer lists the child.

**Acceptance Criteria:**
- Given B was removed, when B opens `/parent/children/{id}`, then B gets the page's not-found or not-allowed result, not the child.
- Given B was removed, when the admin opens `/admin/parents`, then the child is listed only under A, with no co-parent and no Remove button.

## Implementation Notes

- The link date is `student_parents.linked_at` (the table has no `created_at`).
- `remove_parent_link` checks, in order: admin (42501), `has_link_to` (42501 `own_child`), then takes the locks (parents FOR SHARE, profiles FOR UPDATE), reads the link (active first, else the latest removed) FOR UPDATE, and refuses not found (42501), `link_removed`, `last_parent_link` (22023). Concurrent removals serialise on the student's profile lock, so the second sees the first's commit and gets 22023; the keep-one trigger stays the backstop.
- Admin page: the own-child ids come from `readOwnLinkedStudentIds`, read in the same `Promise.all`; when that read fails (or there is no user), no Remove is shown anywhere. The co-parent and inviter use `display_name || email`. The children cell is now a list (one `li` per child) instead of a comma-separated line. Errors toast through the layout; the success toast is the page's.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | verification-gap | No verification gaps | — | Every matrix row, mapper branch, action and render case has a covering test | — |
| 2 | edge | The `has_link_to` own-child check runs before the student's profile lock, so a link to the admin committed in between is missed | low | True: under READ COMMITTED, the check after `for update` would see the committed link (accept holds the profile lock until commit). It needs the admin to accept an invite while removing a link. Direct correction: move the check after the lock (AD-4) | patch |
| 3 | edge, blind | The co-parent line renders empty when the other parent has no name and no email | low | Parents always have `profiles.email` from sign-up and the admin reads every profile. The fix adds a placeholder key | reject |
| 4 | edge, blind | An invited parent whose inviter's account was deleted (`invited_by` set null) shows as "Registered the child" | low | Needs a removal and then deletion of the inviter's account. The frozen rule is "registered the child when `invited_by` is null"; telling the cases apart needs a new branch and key | reject |
| 5 | edge | A transport error with no code returns 400, not 500 | low | Same as the existing `decideJoin` pattern (`requests/+page.server.ts:749-779`); the user sees the generic failed message either way | reject |
| 6 | blind | The e2e signs B in only after the removal, so "loses access at once" in a live session is unproven | maybe-false | Loads are per request under RLS, but the PWA service worker (#52) was not checked for cached pages. Settled cheaply: sign B in and open the child page before the removal, then reload | patch |
| 7 | blind | Deletion-request visibility after a removal is untested | false | Covered by the story-2 "Removed requester" RLS test (the remaining parent sees it; the removed requester does not) | reject |
| 8 | blind | Re-inviting a removed parent is untested | false | Covered by the story-3 "Removed parent" RLS test (`removed_parent`, links stay `[a.id]`) | reject |
| 9 | blind | No load test for a missing session | low | Unreachable: the admin layout guard redirects before the page load runs | reject |
| 10 | blind | The action reuses `requests_error_not_signed_in`, and a malformed id gives "not allowed" with status 400 | low | Reuse of an existing message is harmless; the page-prefix rule is for new keys | reject |
| 11 | blind | The admin can't see removed links (who removed them, when) | low | Not in the intent (CAP-4 lists the parents and removes); adds a feature | reject |
| 12 | blind | The "·" separator is hard-coded and read aloud by screen readers | low | True. Direct correction: `aria-hidden` on the separator | patch |
| 13 | blind | The `fakeLocals` fake routes on argument order | low | Fragile but correct today; a sturdier fake is more than a direct correction | reject |
| 14 | blind | The story-4 RLS `beforeAll` ignores the `class_teachers` insert error | low | True: a failed insert would weaken the "Not admin" teacher case. Direct correction | patch |
| 15 | blind | The story file's Verification and Triage sections are empty, and `deferred-work.md` is missing from the diff | false | Verification and triage run on the orchestrator's side; `deferred-work.md` holds the CAP-6 split from planning and is committed with this story | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0, 0057 applies.
- `npm run test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/admin-parent-link.e2e.ts` -- expected: pass.
