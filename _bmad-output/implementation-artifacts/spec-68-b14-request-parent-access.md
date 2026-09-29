---
title: 'B14a — Request parent access from My account (#68, dual-role creation)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: 'ed68d58ec5b11782ce8055af1346b41ace99341a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing in the app creates a dual-role login, so the B13 role switcher can never appear: a teacher or admin who is also a parent has no way to get parent access (#68). Also, `rejectParent` on /requests refuses any login that isn't parent-only, so a staff member's parent request could never be rejected.

**Approach:** A "Parent access" card on My account lets a signed-in teacher or admin request parent capability; a new security-definer RPC inserts their own `pending` `parents` row (AD-4). The admin decides it in the existing parent queue on /requests; approving works as today, rejecting marks the row `rejected` and never deletes a staff login. Children link as today: a child registers at /join with the staff member's email as guardian email.

**Decisions (user, 2026-09-29):**
- The admin's own request goes through the /requests queue like any other and the admin approves it there; the row is labelled "your own request".
- No re-request after a rejection: the RPC refuses (hint `rejected`) and the card says to contact the admin. `stamp_parent_review` is unchanged.
- Only children who register at /join after approval link to the staff parent; linking existing students is deferred (deferred-work).
- H-8 promotion (admin creates a teacher whose email already has a parent-only login) is in B14 but split out as B14b, built after this spec.
- No withdraw of a pending request.

## Boundaries & Constraints

**Always:** The RPC starts with its authorisation check (caller is `teacher` or `admin`), `set search_path = ''`, revoked from public/anon, granted to authenticated; it only ever writes the caller's own row as `pending`. Parent appears in the switcher only once approved (B13 unchanged). The `rejectParent` staff branch must never call `deleteUser` for a login whose `profiles.role` is not `parent`. Labels via paraglide (en/de/bo). Migration `0032_parent_access_request.sql` stays local until the user says push.

**Never:** No INSERT/DELETE policy or grant on `parents` for clients. No change to `handle_new_user`, child linking (`profiles.parent_id`), `is_parent_of`, or the B13 cookie logic. Don't edit `_bmad-output/manual-verification-issues.md` until the build is done (the user has uncommitted rows there).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request | teacher/admin, no `parents` row, clicks Request | pending row created; card shows "Awaiting admin approval"; admin's /requests queue + nav count include it, marked Teacher/Admin | N/A |
| Duplicate | row already pending or approved | nothing changes | toast: already requested / already a parent |
| After rejection | row `rejected` | card shows "Request declined — contact the admin", no button; RPC refuses (hint `rejected`) | toast if forced |
| Admin's own | admin requests | own row in the admin's queue labelled "your own request"; admin approves it | N/A |
| Not staff | parent-only login, student, anon calls the RPC | refused (42501) | card not shown to them |
| Approve | admin approves the staff request | row approved; B13 switcher shows Parent; card says use the switcher, children register at /join with this email | N/A |
| Reject | admin rejects a staff request | row `rejected`, staff login kept | N/A |
| Direct insert | client `insert into parents` | refused by RLS/grants as today | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0023_parents.sql:28-90` -- `parents` table (pending/approved/rejected), select own-or-admin, admin-only status update (approve needs `email_confirmed_at`), no client insert/delete; `stamp_parent_review` refuses →pending and any change out of rejected.
- `supabase/migrations/0024_parent_first_registration.sql:132-198,264-313` -- `handle_new_user` creates parent rows and links `/join` children via guardian email → approved parent's `profiles.email`; `is_parent_of`, `linked_children`. Reuse, don't change.
- `src/routes/requests/+page.server.ts:45,165-202,491-590` -- `PARENT_COLUMNS` (add `profiles.role`), parent queue load, `approveParent` (unchanged), `rejectParent` (line ~559 refuses non-parent logins → staff branch: set `rejected`, skip `deleteUser`).
- `src/routes/requests/+page.svelte` -- parent queue rows: add a Teacher/Admin pill for staff requests.
- `src/routes/+layout.server.ts:89-97` -- admin nav count of pending parents; already counts staff rows.
- `src/routes/account/+page.server.ts:21-39` -- load: add `parentStatus` via `getCapabilities` (`src/lib/server/capabilities.ts:23`) for teacher/admin; new `requestParentAccess` action using `requireRole(['admin','teacher'])` + `supabase.rpc('request_parent_access')`.
- `src/routes/account/+page.svelte:33-128` -- add the "Parent access" `<section>` card after the Password card (staff only); same form/`pending.submit` pattern.
- `src/lib/server/roles.ts:26-34` -- `heldRoles` adds parent only when approved; unchanged.
- `src/lib/supabase/database.types.ts` -- add the new RPC signature.
- `src/lib/server/rls.spec.ts` -- `dualRole` fixture (service-role insert, ~:9494); add B14 RLS tests next to it.
- `messages/{en,de,bo}.json` -- new `account_parent_*` and `requests_parent_staff_*` keys (bo = English copy, as elsewhere).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0032_parent_access_request.sql` -- `request_parent_access()` security definer: raise 42501 unless `auth.uid()` has role teacher/admin; if a row exists raise 22023 with hint `already_pending` / `already_parent` / `rejected`; else insert `(auth.uid(), 'pending')`; return the status. Revoke from public/anon, grant execute to authenticated.
- [x] `src/lib/supabase/database.types.ts` -- add `request_parent_access` to Functions.
- [x] `src/routes/account/+page.server.ts` -- `parentStatus` in load for staff; `requestParentAccess` action mapping hints to messages.
- [x] `src/routes/account/+page.svelte` -- "Parent access" card with none / pending / approved / rejected states.
- [x] `src/routes/requests/+page.server.ts` + `+page.svelte` -- `role` in the queue, staff pill ("your own request" when the row is the admin's), `rejectParent` staff branch (reject without deleting).
- [x] `messages/{en,de,bo}.json` -- new strings.
- [x] `src/lib/server/rls.spec.ts` -- RPC for teacher and admin; refused for parent-only, student, anon; duplicate refused; direct insert refused; admin approves → `is_parent()` true; a /join child with the staff email links (`is_parent_of`); B12 own-child guard with a dual-role login created via the RPC.
- [x] `src/routes/account/page.server.spec.ts`, `src/routes/requests/page.server.spec.ts` -- load states, action errors, `rejectParent` staff branch keeps the user (no `deleteUser` call).
- [x] `e2e/parent-access.e2e.ts` -- teacher requests on /account → admin approves on /requests → teacher's avatar menu shows Parent.

**Acceptance Criteria:**
- Given a teacher with an approved request, when they register a child at /join with their email as guardian, then the child appears on their /parent page once approved.
- Given a parent-only login or a student, when they open /account, then no Parent access card is shown.
- Given the admin rejects a teacher's request, then the teacher can still sign in and use the teacher pages.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence | Route |
|---|-----------------|---------|----------|-------|
| 1 | A rejected staff request can never be reopened; "contact the admin" has no admin action (blind + edge) | medium | RPC refuses hint `rejected`, trigger refuses rejected→pending, retry button hidden for staff rows; only SQL can reset | defer (user chose 2a "no re-request", reopen path is follow-up work; flagged to user) |
| 2 | No way to give up / revoke approved parent access (blind) | low | true for parent-only logins too; pre-existing, not caused by B14a | defer |
| 3 | Decided table lacks the Teacher/Admin pill (blind) | low | pill only in pending table (`requests/+page.svelte` ~690); retry button vanishes unexplained | patch |
| 4 | No test that a pending teacher can't self-approve (blind) | low | `parents_update_admin` requires `is_admin()`, but no assertion now that staff own pending rows | patch |
| 5 | RPC 42501 → 403 untested; `targetError` branch untested (blind + verification-gap) | low | no spec case feeds `code: '42501'` to the RPC branch or a role-read error | patch |
| 6 | Account load re-reads `profiles.role` via `getCapabilities` (blind) | low | one extra query; AD-4 says guards read the one `getCapabilities` helper | reject |
| 7 | Approved message can render an empty email (blind + edge) | false | staff sign in by email; `profile.email ?? session.user.email` is always set for teacher/admin | reject |
| 8 | e2e ignores the error of its service-role approve (blind) | low | `service.from('parents').update(...)` result unchecked; direct correction | patch |
| 9 | e2e lacks reject / admin-own flows (blind) | low | both covered by RLS spec + requests page spec; extra e2e adds setup | reject |
| 10 | rls.spec setup errors swallowed (blind) | low | test hygiene only; fix adds guards in helpers | reject |
| 11 | `for update` comment / race hint may say already_pending when just decided (blind) | low | needs a concurrent decide within one statement window; message still sensible | reject |
| 12 | RPC checks role, not account status (blind) | false | `profiles.status` is null for teacher/admin (0002:23); no staff deactivation state exists | reject |
| 13 | Admin self-approval not documented in migration (blind) | low | user decision 1a; a header line prevents a later audit flagging it | patch |
| 14 | Removing a teacher who is an approved parent with linked children fails generically (edge) | medium | `profiles.parent_id` → `parents` ON DELETE RESTRICT (0024:41); `admin/teachers` remove calls `deleteUser` → generic `teachers_error_remove_failed`; blocking is safe, message unclear | defer |
| 15 | Role could change between role read and `deleteUser` (edge) | false | nothing in the app changes `profiles.role` today (B14b not built); re-check in B14b | reject |
| 16 | Null profiles embed shows retry button on staff row (edge) | false | admin can read all profiles; if null, `rejectParent` now returns 400 before any delete | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: migrations through 0032 apply cleanly
- `npm test` -- expected: all pass, exit 0
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/parent-access.e2e.ts` -- expected: pass
