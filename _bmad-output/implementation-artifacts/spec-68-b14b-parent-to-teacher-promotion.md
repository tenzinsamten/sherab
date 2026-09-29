---
title: 'B14b — Creating a teacher promotes an existing parent-only login (#68, H-8)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: 'f97cc10afaaa16954d26101012ce8888dc1b5826'
route: 'dispatch'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When the admin creates a teacher whose email already has a parent-only login, Auth refuses the duplicate and /admin/teachers shows "A teacher with this email already exists" — wrong message, and no way to make that parent a teacher (AD-4, arch review H-8).

**Approach:** On a duplicate email that belongs to a parent-only login, the admin's create action promotes that login to `teacher` through a new admin-only security-definer RPC (migration 0033) and assigns the chosen classes. The login keeps its `parents` row, linked children and everything else; the B13 switcher then shows Teacher and Parent.

**Decisions (user, 2026-09-29):**
- Only an **approved** parent-only login is promoted. A pending one gets "This email has a parent sign-up awaiting approval — decide it on /requests first" and nothing changes. The RPC enforces this too (22023, hint `parent_not_approved`).
- The admin is asked first: the first submit changes nothing and returns `promotable: true`; the page shows a confirm dialog ("This email already has a parent account. Make them a teacher too?", via `confirmAction`) and on OK resubmits the same form with `promote=1`. Only a submit with `promote=1` promotes.
- The login keeps its own password: no temp password, no credential block; the success message says they sign in with their existing password.
- (Review loop 1, user 2026-09-29) **Remove** on /admin/teachers for a teacher who also holds an **approved** `parents` row (promoted in B14b or approved through B14a) makes them parent-only instead of deleting the login: their `class_teachers` rows are removed and `profiles.role` goes back to `parent`, through a second admin-only RPC `demote_teacher_to_parent` in the same migration 0033. Login, password, parents row and children stay. The teacher list marks such rows ("Also a parent") and the Remove confirm text says the parent account is kept. A teacher without an approved parents row is still deleted as today.

## Boundaries & Constraints

**Always:** The RPC starts with `is_admin()` (else 42501), `set search_path = ''`, revoked from public/anon, granted to authenticated; it changes only `profiles.role` from `parent` to `teacher`, locking the row, and refuses any other current role (22023, hint `not_parent_only`). Class assignment keeps using the request-scoped client (RLS re-checks `is_admin()`). Labels via paraglide (en/de/bo). Migration stays local until the user says push.

**Never:** No change to `guard_profile_link_columns` (clients still can't change `role`), `handle_new_user`, `parents` rows, `parent_id` links. No promotion of student, teacher or admin logins — those duplicates keep the existing "already exists" error. No demotion other than Remove on a teacher with an approved parents row; admins are never demoted. Don't edit `_bmad-output/manual-verification-issues.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New email | no auth user | unchanged: teacher created, temp password shown | N/A |
| Parent-only email, first submit | approved parent-only login, no `promote` | nothing changes; confirm dialog opens with the form values kept | N/A |
| Confirmed | same, resubmitted with `promote=1` | promoted to teacher, classes assigned; success message (existing password); teacher list shows them; switcher shows Teacher + Parent | N/A |
| Cancelled | admin cancels the dialog | nothing changes | N/A |
| Pending parent | parent-only login, parents row pending | nothing changes | "awaiting approval — decide it on /requests first" |
| Teacher/admin/student email | existing non-parent login | nothing changes | "already exists" error as today |
| Non-admin RPC call | teacher, parent, student, anon | refused 42501 | N/A |
| Promote twice | login already teacher | RPC refuses (`not_parent_only`) | duplicate error |
| Remove, dual-role teacher | teacher with approved parents row | classes removed, role → parent; can sign in, lands on /parent, children intact; not in teacher list | N/A |
| Remove, dual-role with linked children | same, children linked | same as above (no delete, so no RESTRICT failure) | N/A |
| Remove, teacher only | no / pending parents row | login deleted as today | as today |
| Non-admin demote call | teacher, parent, student, anon | refused 42501 | N/A |
| Forged `promote=1` on a pending parent | pending parents row | RPC refuses (`parent_not_approved`) | awaiting-approval error |
| Class assign fails after promotion | RLS/insert error | login stays teacher; error names the failure; admin can fix classes with Edit classes | fail 400 |

</frozen-after-approval>

## Code Map

- `src/routes/admin/teachers/+page.server.ts:47-121` -- `create`: `auth.admin.createUser` with `app_metadata.role='teacher'`; duplicate detection at ~:82 (`email_exists` / regex) → today `teachers_error_duplicate`. Add the promotion branch here: RLS read of `profiles` (id, role) by email (admin reads all), then `supabase.rpc('promote_parent_to_teacher', { p_user_id })`, then the existing `class_teachers` insert.
- `src/routes/admin/teachers/+page.svelte:54-66` -- `credential` block shows email + temp password when `tempPassword` is in the form result; promotion returns no `tempPassword` and a `promoted` flag → success toast/message instead.
- `supabase/migrations/0024_parent_first_registration.sql:211-235` -- `guard_profile_link_columns` refuses role changes when `current_user` is `authenticated`/`anon`; a security-definer function runs as owner and passes. Don't change.
- `supabase/migrations/0001_init.sql:86` -- `is_admin()`.
- `src/lib/server/roles.ts`, `src/lib/server/capabilities.ts` -- roles come from `profiles.role` + approved `parents` row; nothing reads `app_metadata.role` after sign-up (only `handle_new_user`, 0023:153). No change.
- `src/lib/supabase/database.types.ts` -- add the RPC.
- `src/lib/server/rls.spec.ts` -- B14a block (parent/teacher fixtures) as the pattern for B14b tests.
- `src/routes/admin/teachers/page.server.spec.ts` (create if missing) -- action tests with mocked admin client/RPC.
- `messages/{en,de,bo}.json` -- `teachers_promote_confirm`, `teachers_promote_submit`, `teachers_promoted_success`, `teachers_error_parent_pending`, `teachers_error_promote_failed`, `teachers_also_parent`, `teachers_remove_confirm_parent`, `teachers_removed_kept_parent`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0033_promote_parent_to_teacher.sql` -- `promote_parent_to_teacher(p_user_id uuid) returns uuid`, security definer; 42501 unless `is_admin()`; `select role … for update`; 22023 hint `not_parent_only` unless role = `parent`; 22023 hint `parent_not_approved` unless the `parents` row is approved (read `for share`); `update profiles set role = 'teacher'`; grants as above. Also `demote_teacher_to_parent(p_user_id uuid) returns uuid`: 42501 unless `is_admin()`; lock profile; 22023 hint `not_teacher` unless role = `teacher`; 22023 hint `parent_not_approved` unless the parents row is approved (`for share`); delete the user's `class_teachers` rows; set role `parent`; same grants.
- [x] `src/lib/supabase/database.types.ts` -- add the function.
- [x] `src/routes/admin/teachers/+page.server.ts` -- on duplicate email: RLS read of the profile + parents status by email; non-parent → existing duplicate error; pending → awaiting-approval error; approved without `promote=1` → `fail(409, { promotable: true, email, displayName, classIds })`; with `promote=1` → RPC then class assignment, returns `{ success, promoted: true, email, displayName, classIds }`. Drop the now-unreachable `teachers_error_duplicate` arm in the non-duplicate `fail`. Load: add `alsoParent` per teacher (approved parents row, admin RLS read). `remove`: if the teacher has an approved parents row → `demote_teacher_to_parent` and return `{ removed, keptParent: true }`; else `deleteUser` as today.
- [x] `src/routes/admin/teachers/+page.svelte` -- on `promotable` run `confirmAction` (OK label `teachers_promote_submit` "Make teacher"; text says their existing name and password are kept) and resubmit with a hidden `promote=1`; promoted success message, no credential block. Teacher rows with `alsoParent` show an "Also a parent" pill; their Remove confirm uses `teachers_remove_confirm_parent` and the success toast `teachers_removed_kept_parent`.
- [x] `messages/{en,de,bo}.json` -- new strings.
- [x] `src/lib/server/rls.spec.ts` -- admin promotes a parent-only login (role → teacher, parents row + `is_parent_of` child link unchanged); refused for non-admins and anon; refused for teacher/student/admin targets and for a pending parent; a direct client role update is refused with 42501 (assert the error); demote: admin demotes a dual-role teacher (class_teachers gone, role parent, `is_parent_of` child link kept), refused for non-admins, for a teacher without an approved parents row, and for admin targets; promoted login can be assigned to a class and `is_teacher_of_class` holds.
- [x] `src/routes/admin/teachers/page.server.spec.ts` -- new email unchanged; approved parent without `promote` → 409 `promotable`, no RPC call; with `promote=1` promotes and assigns; pending parent → awaiting-approval error; remove on a dual-role teacher calls the demote RPC and never `deleteUser`; remove on a plain teacher still calls `deleteUser`; non-parent duplicate keeps the error; RPC/assign failures.
- [x] `e2e/parent-access.e2e.ts` -- admin creates a teacher with an approved parent-only login's email → first cancels the dialog (role still `parent`, no toast) → resubmits and confirms → it appears in the teacher list; that login signs in and the avatar menu shows Teacher and Parent; then the admin removes them as teacher (confirm text mentions the parent account) → they sign in and land on /parent.

**Acceptance Criteria:**
- Given a promoted login, when it signs in, then `/` lands on the teacher home and switching to Parent shows their children.
- Given a promoted teacher, when the admin later edits their classes or resets their password on /admin/teachers, then both work as for any teacher.
- Given a teacher who is also an approved parent, when the admin removes them, then they keep signing in with their password and see their children on /parent.

## Implementation Notes

- Outside the task list: the existing `$effect` on `/admin/teachers/+page.svelte` read and wrote `createKey`, re-running itself (`effect_update_depth_exceeded` in the new e2e). Its side effects are now wrapped in `untrack`, so it depends only on `form`. `e2e/forms.e2e.ts` (teacher create) still passes.
- The profile lookup matches `profiles.email` against the lowercased input (Auth stores emails lowercased); no match → the plain duplicate error.

- Loop 1: re-applied the loop-0 diff, then added the demote RPC and Remove branch. Remove also stops with the remove-failed error when the parents row can't be read (never risks deleting a parent account). The guard test asserts 42501 via the admin changing a pending student's role (the only client-updatable profile row).

## Spec Change Log

- **Loop 1 (intent_gap, 2026-09-29).** Trigger: review (blind + edge + verification-gap) found that Remove on /admin/teachers deletes the whole login of a teacher who is also a parent (parent account lost; with linked children the delete fails on `parent_id` RESTRICT). Amended: user decision added to the frozen block (Remove makes them parent-only via `demote_teacher_to_parent`), matrix rows, tasks; also folded in the loop-0 patch findings (`for share` on the parents read, "Make teacher" confirm label, confirm text that name/password are kept, unreachable duplicate arm, cancel-path e2e, guard test asserts 42501). Avoids: a promoted or B14a teacher-parent losing their parent account when removed as teacher. KEEP: the loop-0 implementation (reverted; full diff at `/private/tmp/claude-501/-Users-tenzinsamten-Desktop-personal-project-tib-class/18e10c77-bd3f-42ff-8a77-1398123b0c58/scratchpad/b14b-loop0.diff`) passed reset/test/check/build/e2e — reuse its migration shape, `promoteExistingParent` helper, 409 `promotable` + `confirmAction` resubmit, `untrack` fix of the `/admin/teachers` `$effect` loop, message keys and test structure.

## Review Triage Log

Loop 0 (reviewed diff reverted for loop 1):

| # | Finding (layer) | Verdict | Evidence | Route |
|---|-----------------|---------|----------|-------|
| 1 | Remove on a promoted/dual-role teacher deletes the parent account, or fails on RESTRICT with linked children (blind, edge, vgap) | high | `remove` calls `deleteUser`; profiles→parents cascade (0023:31), `parent_id` RESTRICT (0024:41) | intent_gap → user: make parent-only |
| 2 | Reset password also changes the parent password (blind, edge) | false | one login, one person; resetting a teacher's password is the same as for any teacher (AC) | reject |
| 3 | Promote + assign not atomic; retry shows duplicate (blind, edge) | low | matrix row accepts "login stays teacher; admin fixes with Edit classes" | reject |
| 4 | Admin-entered display name silently ignored (blind, edge, vgap) | low | echoed only; list shows parent's name | patch → folded into loop-1 spec (confirm text) |
| 5 | `app_metadata.role` stays 'parent' (blind) | false | only `handle_new_user` reads it (0023:153), at sign-up | reject |
| 6 | parents row read without lock; concurrent reject (blind, edge) | low | a reject between check and update leaves a rejected row on a teacher | patch → folded (`for share`) |
| 7 | Confirm OK says "Create teacher" (blind) | low | no teacher is created; e2e needed `.last()` | patch → folded |
| 8 | Raw "/requests" path in message (blind) | low | cosmetic | reject |
| 9 | Raw Postgres message in promote_failed toast (blind) | low | only unexpected errors; same pattern as `teachers_error_assign_failed` | reject |
| 10 | No test for a rejected parents row (blind, edge) | low | rejected parent-only logins are deleted by rejectParent; row only survives a failed delete | reject |
| 11 | Cancel path untested (blind, vgap) | medium | dropping `if (!okay) return` passes all tests | patch → folded (e2e cancel first) |
| 12 | RLS guard test ignores the error (blind) | low | passes even if RLS matched 0 rows | patch → folded |
| 13 | Email lookup case-sensitive (blind) | false | Auth stores emails lowercased; `handle_new_user` copies it | reject |
| 14 | database.types.ts order (blind) | low | cosmetic | reject |
| 15 | No audit of promotion (blind) | low | no audit pattern on profiles | reject |
| 16 | Read errors masked as duplicate (edge) | low | transient only; fix adds branches | reject |
| 17 | `promote` reset right after requestSubmit (edge) | false | submit event and enhance's FormData are synchronous; e2e passed | reject |
| 18 | rls.spec fixture helpers swallow errors (edge) | low | pre-existing helpers | reject |
| 19 | Unreachable `teachers_error_duplicate` arm (edge, vgap) | low | direct deletion | patch → folded |
| 20 | Children view after promotion not e2e (edge) | low | RLS test asserts `is_parent_of` | reject |
| 21 | `updated`/`removed` effect branches untested (vgap) | medium | no e2e runs Edit classes/Remove on the page; untested before too | defer (partly covered by loop-1 remove e2e) |

Loop 1:

| # | Finding (layer) | Verdict | Evidence | Route |
|---|-----------------|---------|----------|-------|
| 1 | Promote + assign not atomic; retry shows duplicate (blind, edge) | carried low | matrix row accepts it (loop 0 #3) | reject |
| 2 | Display name ignored (blind) | carried low | confirm text now says name is kept (loop 0 #4) | reject |
| 3 | Read errors in promoteExistingParent shown as duplicate (blind, edge) | carried low | loop 0 #16 | reject |
| 4 | Email lookup case / stale (edge) | carried false | loop 0 #13 | reject |
| 5 | app_metadata.role out of sync (blind) | carried false | loop 0 #5 | reject |
| 6 | No audit of role changes (blind) | carried low | loop 0 #15 | reject |
| 7 | `promote` flag timing / re-open (blind) | carried false | loop 0 #17; e2e cancel + confirm passes | reject |
| 8 | Raw /requests path, bo English copies (blind) | carried low | loop 0 #8 | reject |
| 9 | database.types.ts order (blind) | carried low | loop 0 #14 | reject |
| 10 | Load fetches all approved parent ids (blind) | low | one small query on an admin page; school-sized data | reject |
| 11 | Parent approved between remove's read and deleteUser (blind, edge) | false | the single admin does both the approval and the remove; no concurrent actor | reject |
| 12 | Teacher with linked children but no approved row → RESTRICT failure (blind, edge) | false | children link only to approved parents at sign-up (0024), and no UI path moves approved → rejected (`rejectParent` selects pending/rejected only) | reject |
| 13 | Demote errors all map to one generic message (blind) | low | only reachable on a race or a bug; message is still correct | reject |
| 14 | Demote pending-row / anon error-code tests (blind) | low | no-row case covers the approval check; anon refused asserted | reject |
| 15 | Pending B14a teacher removed deletes the pending request silently (edge) | low | matrix: "Remove, teacher only: no / pending parents row → deleted as today" | reject |
| 16 | `load` alsoParent / parentsError untested (vgap) | medium | dropping `.eq('status','approved')` would mislabel a pending teacher and promise a kept parent account while the server deletes | patch |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: migrations through 0033 apply cleanly
- `npm test` -- expected: all pass, exit 0
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/parent-access.e2e.ts e2e/role-switcher.e2e.ts` -- expected: pass
