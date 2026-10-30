---
title: 'Parent-managed flag and database rule'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: 'cb042d884059a46fb87115bd36cfa539b4d7051c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-managed-homework/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Young students have no phone, so parents log into the child's account to mark homework done. The database refuses any parent write to `homework_status_history` (AD-12).

**Approach:** Add a `parent_managed` flag to the student's profile, which either linked parent sets through a trusted function. Add a parent `done` branch to the homework insert policy that requires the flag. Amend AD-12 in the architecture spine. Database side of SPEC CAP-1 and CAP-2. The UI comes in stories 2 to 4.

## Boundaries & Constraints

**Always:**
- The flag defaults to off.
- The flag changes only through `set_parent_managed(p_student_id, p_on)`, a `security definer` function that raises unless `is_parent_of(p_student_id)` holds.
- The guard trigger blocks any other `authenticated`/`anon` write to the flag. This covers teachers and the admin through `profiles_update_registration_review`.
- A parent `done` insert must satisfy everything the student's self-mark needs (`recorded_by = auth.uid()`, instance/class match, prior `assigned` row), plus `is_parent_managing(student_id)`.
- Both linked parents get the same rights through `is_parent_of`.
- AD-12 is amended in the same change.
- New types are added to `database.types.ts` by hand.

**Never:**
- No parent `reviewed`, update or delete.
- No new `profiles` update policy or grant.
- No reads of `registered_by_parent_id`.
- No change to the student's or teacher's existing insert rights.
- No UI or server-action changes. Those are stories 2 to 4.
- Never regenerate `database.types.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Parent A sets flag | A linked, child approved, `set_parent_managed(child, true)` | `profiles.parent_managed = true`; B reads it true | N/A |
| Parent B turns it off | B linked, flag on, `set_parent_managed(child, false)` | flag false | N/A |
| Unlinked parent / teacher / admin / student calls RPC | any | refused, flag unchanged | raises, errcode `42501` |
| Teacher updates flag through the profile update | pending student, update `parent_managed` | refused | guard trigger raises `42501` |
| Parent A or B marks done | flag on, `assigned` row exists, `recorded_by` = caller | row inserted, `recorded_by` = parent | N/A |
| Flag off | parent inserts done | refused | RLS violation |
| Unlinked parent | flag on | refused | RLS violation |
| No assigned row | flag on, linked | refused | RLS violation |
| Parent inserts `reviewed` | flag on, done exists | refused | RLS violation |
| `recorded_by` is someone else | flag on | refused | RLS violation |
| Student self-mark, teacher marks | unchanged | still allowed | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0016_class_enrollments.sql:315-395` -- current `homework_status_history_insert_admin_teacher_or_self_done`; not redefined later. Copy the body verbatim and add one branch.
- `supabase/migrations/0054_student_parents.sql:505-524` -- `guard_profile_link_columns()` (security invoker; trusted definer paths pass). Recreate it with `parent_managed` added. Keep everything else.
- `supabase/migrations/0054_student_parents.sql:529-550` -- `is_parent_of()`. Reuse it; do not redefine.
- `supabase/migrations/0054_student_parents.sql:990-1008` -- the only `profiles` update policy (teacher/admin reviewing pending students). This is why the guard is needed.
- `supabase/migrations/0025_parent_reads.sql:158` -- parents can already SELECT instances, so the policy's `exists (homework_instances…)` passes for them. No change.
- `src/lib/supabase/database.types.ts:1028` (profiles Row/Insert/Update) and `:1602` (Functions) -- add by hand.
- `src/lib/server/rls.spec.ts` -- homework done tests around lines 2206-2560 (fixtures, self-mark, untargeted). Add a new `describe` block near them.
- `src/lib/server/testing/link-parent.ts` -- `linkParent(service, studentId, parentId)` for fixtures.
- `_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md:134` -- AD-12 parent write-exception bullet. Also update the capability table (line ~265).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0060_parent_managed_homework.sql` -- add the column with a comment; recreate the guard trigger function with `parent_managed`; add `set_parent_managed` (security definer, `search_path = ''`, `is_parent_of` check, revoke from public/anon, grant to authenticated); add `is_parent_managing(p_student_id)` (security definer, stable, `is_parent_of(p_student_id)` and the flag); drop and recreate the insert policy with `or (status = 'done' and public.is_parent_managing(student_id))` in the final OR group -- DB-enforced write (AD-2).
- [x] `src/lib/supabase/database.types.ts` -- add `parent_managed` to profiles Row/Insert/Update, and `set_parent_managed`/`is_parent_managing` to Functions, by hand.
- [x] `src/lib/server/rls.spec.ts` -- new describe covering every I/O-matrix row for parents A and B -- proves the barrier.
- [x] `ARCHITECTURE-SPINE.md` -- AD-12: parents' write exceptions add the flag via `set_parent_managed` and `done` rows for a parent-managed child; add a `spec-parent-managed-homework` capability-table row -- records the amendment.

**Acceptance Criteria:**
- Given a fresh `supabase db reset`, when the migration runs, then every existing student has `parent_managed = false` and the existing RLS tests still pass.
- Given a parent `done` row, when the streak and badge triggers run, then they recompute as for a student's self-mark.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-30).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | verification-gap, blind | No test for a removed parent marking done with the flag on | medium (gap) | Filed evidence: the only removed-parent test calls the RPC; a policy rewrite that drops `removed_at is null` would pass every test | patch |
| 2 | verification-gap, blind | The test "student cannot set their own flag directly" cannot fail | low | No student `profiles` update policy exists (0054:991), so the update matches 0 rows and the error is discarded | patch: assert 0 rows changed |
| 3 | blind | The parents update/delete test ignores its results | low | Results are discarded, so it passes for any reason | patch: assert no rows changed |
| 4 | blind | The copied policy comment lists who can see the instance without naming the parent | low | The comment in 0060 says "admin, teacher, or targeted student"; the parent path now relies on 0025:158 | patch: name the linked parent |
| 5 | blind, edge-case | The streak/badge test compares only `updated_at`, and the streak trigger swallows errors (0007:281) | medium | A failed recompute for parent rows would go unnoticed | patch: assert the computed value |
| 6 | blind | No test for a linked parent writing `profiles.parent_managed` directly | low | Parents have no `profiles` update policy, so such a test would be as weak as #2; fix adds nothing | rejected |
| 7 | blind | Flag-off leaves existing rows: untested | low | History is append-only with no update policy; nothing in this diff touches rows on flag change | rejected |
| 8 | blind | Unapproved child and null `p_on` untested | low | `is_parent_of`'s approval check is already covered by existing tests; null is a defensive extra | rejected |
| 9 | blind, edge-case | Several `done` rows per item (parent A, parent B, the student) | maybe-false/medium | Pre-existing: history has no unique key since 0013, and a student can already double-mark. Story 5's label must pick a row | defer |
| 10 | blind | Flag changes have no audit trail | low | The intent doesn't ask for one; the fix adds schema | rejected |
| 11 | blind | Function entries in `database.types.ts` aren't alphabetical | false | The file is grouped by migration, not alphabetically (e.g. `set_class_default` at 1547 comes before `is_parent` at 1604) | rejected |
| 12 | edge-case | A parent can mark done for a class the child has left | low | Same as the student's existing self-mark branch, which has no enrollment check; the intent is parity with the self-mark | rejected |
| 13 | edge-case | A newly linked parent gets rights without opting in | false | CAP-1 makes the flag a property of the child, and "either linked parent" has the same rights | rejected |

## Design Notes

The parent branch sits beside the student branch, inside the same `done/reviewed` clause, so the `assigned` prerequisite and the `reviewed`-needs-`done` rule apply unchanged:

```sql
or (status = 'done' and student_id = auth.uid())
or (status = 'done' and public.is_parent_managing(student_id))
```

`is_parent_managing` is a security definer, because parents cannot SELECT other columns of the child's `profiles` row directly in every path.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0, migration 0060 applies.
- `npm test` -- expected: exit 0, including the new RLS block.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
