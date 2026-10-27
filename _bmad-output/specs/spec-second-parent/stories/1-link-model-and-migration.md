---
title: 'Story 1: Link model and migration'
type: 'feature'
created: '2026-10-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2c41e23e329be43161bcb569213ddf3a1d099338'
context:
  - '{project-root}/_bmad-output/specs/spec-second-parent/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student links to one parent through `profiles.parent_id`, so a second parent cannot exist. Every later story (access, invites, admin and teacher views, `/join`) needs a link model that holds up to two parents.

**Approach:** In one migration, add `student_parents` (spine AD-10), copy each existing `parent_id` into a slot-1 link, rename the column to `registered_by_parent_id`, and rebuild every database function on the links. Existing single-parent families see no change.

## Boundaries & Constraints

**Always:**
- Follow spine AD-10, with the AD-4 and AD-11 parts noted under Tasks.
- `student_parents`:
  - Columns: `student_id` → profiles, on delete cascade; `parent_id` → profiles(id), on delete restrict; `slot` smallint, 1 or 2; `invited_by` and `removed_by`, on delete set null; `linked_at`; `removed_at`.
  - Partial unique `(student_id, slot)` and `(student_id, parent_id)` where `removed_at is null`.
  - RLS SELECT only for the student's active parents and the admin. No client write policy.
- A deferred constraint trigger on UPDATE/DELETE of `student_parents` locks the student's `profiles` row, recounts active links, and raises when the student still exists and has zero.
- A removed row is immutable, and `removed_by`/`removed_at` are set once.
- A `parents` row with active links cannot leave `approved`.
- `registered_by_parent_id` FK becomes on delete set null. Access never reads it.
- The guard trigger protects `registered_by_parent_id`, `guardian_email` and `role`.
- Lock order is the parent's `parents` row, then the student's `profiles` row.
- New security-definer functions pin `search_path = ''` and grant EXECUTE explicitly.
- New tables, columns and functions are added to `database.types.ts` by hand.

**Never:**
- No invite table or functions (story 3), no link-removal function (story 4), and no `/join` changes (story 5).
- No moving of TypeScript readers to the links (story 2). This story only renames them mechanically.
- Never run `supabase:types`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migrate | Students with and without `parent_id` | One slot-1 link per non-null value (`invited_by` null, `linked_at` = profile `created_at`); unlinked fixtures untouched | Pre-check fails → migration raises, nothing changes |
| Sign-up | Student registers against an approved parent | Profile with `registered_by_parent_id` plus a slot-1 link, in the same transaction | No parent match → whole sign-up rolls back, as today |
| Third link | Service role inserts slot 3, or a duplicate active slot or parent | Refused | Constraint error |
| Last link | Delete or remove the only active link of an existing student | Refused at commit | Trigger raises |
| Concurrent removals | Two transactions each remove one of two links | Second one waits on the row lock and is refused | Trigger raises |
| Student deleted | Student with links is deleted | Links cascade, commit succeeds | — |
| Parent revoked | Admin sets an approved parent with links to `rejected`, or deletes the auth user | Refused | Trigger / FK restrict |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0024_parent_first_registration.sql` -- current `handle_new_user` (:74-202), `guard_profile_link_columns` (:211-235), `is_parent_of` (:264-286), `linked_children` (:293-313), check constraint (:52-68), FK and index (:40-49). Copy and adapt; don't edit old files.
- `supabase/migrations/0037_push_notifications.sql:163-270` -- `homework_push_targets`; only the parent join (:233) changes.
- `supabase/migrations/0042_student_unique_per_parent.sql:77-121` -- unique index (follows the rename automatically) and `student_registration_state` (sql, `search_path = public`; rebuild it on `registered_by_parent_id`).
- `supabase/migrations/0023_parents.sql:71-101` -- `stamp_parent_review`; add the "can't leave approved with active links" rule here or in a sibling trigger.
- Self-decision guards using `is_parent_of`: `0028:70`, `0028:147`, `0029:79`, `0031:235`; registration review policy in `0051`.
- `src/lib/supabase/database.types.ts` -- profiles at :983-1052 (`parent_id` :993/:1011/:1029/:1047); Functions at :1372.
- TS renames: `src/routes/calendar/+page.server.ts:213-221`, `src/routes/admin/parents/+page.server.ts:18,53,55,73-80`, comment at `src/routes/admin/teachers/+page.server.ts:220`. Leave `src/lib/server/pdf-files.ts:134` alone (unrelated path segment).
- Fixtures setting `parent_id` must also insert the link: `src/lib/server/rls.spec.ts` (helpers `createApprovedParent` :593, `signUpStudent` :632, and the direct updates listed by grep), `src/routes/calendar/page.server.db.spec.ts:109`, `src/routes/teacher/classes/[id]/page.server.db.spec.ts:171`, `src/lib/server/student-pin.spec.ts:218-222`, and the `e2e/*.e2e.ts` files found by `grep -rn parent_id e2e`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0054_student_parents.sql` -- in this order:
  - Pre-check DO block.
  - `student_parents` with its indexes, RLS, the zero-link trigger and the immutability trigger.
  - Backfill the links.
  - Rename the column, switch the FK to set null, and rename the index.
  - Recreate the functions on the links: `handle_new_user` (writes `registered_by_parent_id` and the slot-1 link), the guard trigger, `is_parent_of`, `linked_children`, `homework_push_targets`, and `student_registration_state`.
  - `has_link_to(student)` (an active link, ignoring status). Swap it into the 4 self-decision guards and add it to the registration-review policy.
  - Parents rule: an approved row with active links can't leave approved.
  - Closing check: raise if any `public` function other than an allowlist of link readers has `prosrc ~ '\mparent_id\M'`.
  -- spine AD-4, AD-10, AD-11.
- [x] `src/lib/supabase/database.types.ts` -- rename the column in profiles; add `student_parents`; add `has_link_to`.
- [x] `src/routes/calendar/+page.server.ts`, `src/routes/admin/parents/+page.server.ts`, their unit specs -- rename the column only; behavior unchanged.
- [x] Test fixtures (`src/**/*.spec.ts`, `e2e/*.e2e.ts`) -- replace direct `parent_id` writes with `registered_by_parent_id` plus a service-role `student_parents` insert, through one shared helper per test tree.
- [x] `src/lib/server/rls.spec.ts` -- new tests for every matrix row, the guard trigger on `registered_by_parent_id`, `has_link_to` blocking a pending teacher-parent from approving their own child, and `homework_push_targets` returning a linked parent.

**Acceptance Criteria:**
- Given a reset database, when the existing test suite runs, then every existing parent-facing test passes unchanged in behavior.
- Given the migration has run, when the closing check runs, then no function outside the allowlist names `parent_id`.

## Implementation Notes

- `student_parents` has a uuid `id` primary key. A BEFORE INSERT trigger also refuses a link whose student is not a `student` profile, whose parent has no `parents` row, or that is inserted already removed.
- The parents rule refuses any status change away from `approved` (in practice: to `rejected`, from pending too) and any DELETE of a `parents` row while active links exist (hint `parent_has_links`), per AD-4/AD-10.
- The immutability trigger lets `invited_by` / `removed_by` go to NULL only, so ON DELETE SET NULL still works; it stamps `removed_at := now()` on removal.
- `handle_new_user()` locks the matched `parents` row (`FOR UPDATE`, re-checking `approved`) before inserting the profile and the slot-1 link (lock order).
- `student_registration_state()` is rebuilt on `registered_by_parent_id` with `search_path = ''`.
- Three existing tests rejected an approved parent with a linked child to show "a parent who is not approved reads nothing". That state can no longer be reached, so they now assert the rejection is refused and use a pending parent linked with the service role for the "reads nothing" part (7-2 `is_parent_of`, 7-3 reads, #97 teams).
- Fixture helpers: `src/lib/server/testing/link-parent.ts` (src tree) and `linkParent()` in `e2e/fixtures.ts`. E2E cleanups that unlinked a parent before deleting it now delete the students first (a last link cannot be removed).
- `list_class_join_requests()` and `sick_leave_queue()` (0036 bodies) are recreated with `has_link_to` for `own_child`, matching the guards.
- Removal requires `removed_by`; the keep-one trigger fires on `update of removed_at` or delete only; parents read only active link rows (the admin reads all); a link insert locks the parent's `parents` row `for share`.
- The fixture helpers set `registered_by_parent_id` only for the first (slot-1) link, and throw when the student already has two parents.
- Matrix audit (orchestrator, 2026-10-27): after `supabase:reset` (exit 0), `test` (1748/1748), `check` (exit 0) and `build` (exit 0), the 17 story-1 tests ran and passed. They cover every matrix row except **Migrate**, which the suite cannot exercise (the reset applies 0054 before any data exists). The implementer verified Migrate by hand: reset to 0053, seeded a linked and an unlinked student, and confirmed the pre-check raises on a non-approved parent and that the backfill gives one slot-1 link. E2E: 246 of 247 in the 13 touched files passed; the failure (`teacher.e2e.ts` Reset PIN #88) also fails on the baseline.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | verification-gap, blind | Guard helper (`has_link_to`) swap at the sick-decision policy and trigger, deletion approval and `decide_class_join` has no pending-parent test | medium | Existing self-decision tests use approved parent and child, so `is_parent_of` would pass them too | patch |
| 2 | verification-gap, blind | Migrate row (pre-check, backfill) has no automated test | medium | Reset applies 0054 before data exists; only a manual run backs it | defer |
| 3 | verification-gap | Pending parent with links being rejected, and the 3 BEFORE INSERT refusals, are untested | medium | No assertion on hint `parent_has_links` for pending; no match for the insert error texts in src or e2e | patch |
| 4 | verification-gap, blind | `own_child` flags in `list_class_join_requests()` and `sick_leave_queue()` still use `is_parent_of` | medium | Pending teacher-parent sees decide buttons that the new guards refuse with 42501 | patch |
| 5 | edge, verification-gap | Removed links block deleting the parent account forever (RESTRICT FK counts removed rows) | low | Real design hole, but in this story only the service role can remove links, and the delete then fails loudly; frozen spec mandates RESTRICT. Input for story 4 planning | reject |
| 6 | edge | Parents delete guard ignores removed rows, so the error is a raw FK error | low | Same root as #5; unreachable without a removal path | reject |
| 7 | edge | Zero-link check breaks under REPEATABLE READ | false | Every caller (PostgREST, Auth, migrations) runs READ COMMITTED; the count runs as a new statement after the lock | reject |
| 8 | edge | `student_registration_state` returns 'available' for a slot-2 parent's existing child | low | Slot-2 parents exist only via the service role; the frozen Never excludes `/join` changes (story 5) | reject |
| 9 | edge | Role change away from student leaves links on a non-student | low | Service-role only, and the fix adds a new guard | reject |
| 10 | edge, blind | Calendar and admin parents page read `registered_by_parent_id`, so the second parent sees nothing | low | Frozen Never: moving TS readers is story 2; slot-2 parents only via the service role now | reject |
| 11 | edge, blind | `linkParent` overwrites `registered_by_parent_id` when adding the second parent | medium | Fixtures record the invitee as registrant, unlike sign-up, and can hit the 0042 unique index | patch |
| 12 | edge, blind | `linkParent` fails with a raw unique error when both slots are taken | low | Direct correction (throw a clear error) | patch |
| 13 | edge | AC says existing parent tests are unchanged, but 3 were rewritten | false | The frozen Always rule (an approved parent with links can't leave approved) makes the old setup impossible; rewrite is required | reject |
| 14 | edge, blind | `registered_by_parent_id` comments say "never read for access", but the calendar still reads it | low | Comment is untrue until story 2; one-line correction | patch |
| 15 | edge | Parents rule also refuses pending→rejected with links | false | Matches spine AD-4 ("can't be rejected, revoked, or deleted") | reject |
| 16 | blind | BEFORE INSERT link trigger takes no lock on the parent's `parents` row, so it can race a rejection | medium | FK targets profiles, so no implicit KEY SHARE on parents; story 3 accept and service-role inserts would race `guard_parent_with_links` | patch |
| 17 | blind | Insert allows links to pending parents, so the rule is one-directional | low | Production paths (sign-up) link approved parents only; pending links come from service-role fixtures | reject |
| 18 | blind | `prosrc` closing check skips the 8 allowlisted functions | low | Each allowlisted function is exercised by passing tests (sign-up, `is_parent_of`, `linked_children`, push targets, link triggers) | reject |
| 19 | blind | A link can be removed with `removed_by` null | medium | Audit of who removed a link can be skipped silently by story 4's function; spine says both set once | patch |
| 20 | blind | Concurrent-removal test does not force overlapping transactions | low | Lock logic verified by reading (FOR UPDATE, then a fresh-statement count); forcing overlap needs a direct pg client the repo does not have | reject |
| 21 | blind | Zero-link constraint trigger fires on every UPDATE, including SET NULL of `invited_by`/`removed_by` | low | Extra profile locks on account deletion; direct correction to `after update of removed_at or delete` | patch |
| 22 | blind | Parents can read the co-parent's removed link rows (admin id, inviter) forever | low | RLS test asserts it; direct correction (parents see active rows only) | patch |
| 23 | blind | Hint `parent_has_links` isn't mapped in `rejectParent` | false | `rejectParent` acts only on pending/rejected parents, which never have links in production (sign-up links approved parents only) | reject |
| 24 | blind | `linkParent` duplicated in src and e2e | low | Two test runners (vitest `$lib`, Playwright) with no shared module; no named harm | reject |
| 25 | blind | `has_link_to` out of alphabetical order in `database.types.ts` | low | Direct correction | patch |

## Design Notes

The `prosrc` check uses a name allowlist because `student_parents.parent_id` is itself named `parent_id`. The allowlist holds the functions rebuilt here that read `student_parents`; a function referencing the old profiles column would otherwise only fail at runtime (plpgsql bodies aren't validated at create). Fixtures add links explicitly, not through a sync trigger, so `registered_by_parent_id` never grants access (AD-10).

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: all migrations apply, including 0054.
- `npm run test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
