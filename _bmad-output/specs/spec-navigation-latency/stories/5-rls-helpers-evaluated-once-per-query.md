---
title: 'RLS helpers evaluated once per query'
type: 'refactor'
created: '2026-10-17'
status: 'done'
baseline_commit: 'c8c44b7a0ec7197c0dac5a6d7ec0e80dd97cc546'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** RLS policies call `auth.uid()` and `public.is_admin()` bare. Postgres evaluates them once per row checked, and `is_admin()` is a `SECURITY DEFINER` primary-key lookup on `profiles`. For a non-admin the first `OR` branch therefore costs one extra lookup per row, on every read and write (SPEC CAP-6, review finding 5).

**Approach:** One new migration recreates the affected policies with the zero-argument calls wrapped as `(select auth.uid())` and `(select public.is_admin())`. Postgres then evaluates each once per query (an InitPlan). Every policy keeps its exact meaning.

**Scope (user, 2026-10-17):** hot tables only. That is every policy on `class_sessions`, `class_days`, `classes`, `class_enrollments`, `session_leave_history`, `parents`, `profiles` and `class_teachers` that calls `auth.uid()` or `is_admin()`. Policies on other tables keep the bare form.

## Boundaries & Constraints

**Always:**
- Access is identical for every role. The whole RLS suite (`src/lib/server/rls.spec.ts`) and every other spec pass unchanged.
- Only zero-argument calls are wrapped. Row-argument helpers such as `is_teacher_of_class(class_id)`, `is_parent_of(student_id)`, `is_parent_in_class(class_id)` and `is_enrolled_in_class(auth.uid(), class_id)` stay per row, because they depend on the row. Only their `auth.uid()` argument is wrapped.
- Each policy is dropped and recreated with the same name, command, roles, `USING` and `WITH CHECK`, inside one migration file that applies in a transaction.

**Never:**
- No edit to past migrations.
- No change to a helper function's body, or to who a policy admits.
- No policy merged, split or renamed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same access | full RLS suite after `supabase db reset` | Every test passes unchanged | N/A |
| Plan | `EXPLAIN` of a student's or parent's `class_sessions` read | `is_admin()` and `auth.uid()` appear once as an InitPlan, not per row | N/A |
| Policy text | `pg_policies` after the migration | Same policy names and commands; only the wrapped calls differ | N/A |

</frozen-after-approval>

## Code Map

- Live policies: read them from the local DB (`docker exec supabase_db_tib-class psql -U postgres -c "select … from pg_policies"`), not from the migrations. Many were redefined later, for example `profiles_select_admin_or_teacher_of_student_class` in 0016.
- Hot-table policies today: `class_enrollments_select`, `class_sessions_select` and `_update_admin_or_teacher`, `classes_*` (6), `class_days_*` (3), `class_teachers_*` (3), `parents_select_own_or_admin`, `parents_update_admin` (has an `EXISTS` on `profiles`), `profiles_select_*` (4), `profiles_update_registration_review`, `session_leave_history_select` (has an `EXISTS` on `class_sessions`) and `_insert_parent`.
- `supabase/migrations/` -- the latest is `0050_badges_seen.sql`, so the new file is `0051_rls_initplan_helpers.sql`. Match the header-comment style of recent migrations.
- `src/lib/server/rls.spec.ts` -- the access suite (about 12 000 lines) that must stay green. `npm run supabase:reset` applies migrations.
- `src/lib/supabase/database.types.ts` -- no change (policies don't affect types).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0051_rls_initplan_helpers.sql` -- For each policy in scope: `drop policy … ; create policy …` with the same definition and the zero-argument calls wrapped. -- Postgres evaluates them once per query.
- [x] (Verification only) `EXPLAIN` through `docker exec … psql` with `set role authenticated` and `request.jwt.claims` set for a seeded student and parent. -- Shows the InitPlan.

**Acceptance Criteria:**
- Given `supabase db reset`, when `npm run test` runs, then every test passes unchanged.
- Given `pg_policies` before and after, when compared with `select auth.uid()` / `select is_admin()` normalised, then every policy in scope is identical.

## Implementation Notes

- `supabase/migrations/0051_rls_initplan_helpers.sql` drops and recreates 20 policies: `class_days` insert and update; `class_enrollments_select`; `class_sessions` select and update; `class_teachers` delete, insert and select; `classes` delete, insert, select (admin or teacher), select (own student) and update; `parents` select and update; `profiles_select_admin`, `_admin_or_teacher_of_student_class`, `_own` and `profiles_update_registration_review`; and `session_leave_history_select`.
- Four hot-table policies have no zero-argument call and are unchanged: `class_days_select_signed_in`, `classes_select_parent_in_class`, `profiles_select_parent_of_child` and `session_leave_history_insert_parent`.
- Checked in the live DB:
  - No bare `auth.uid()` or `is_admin()` is left on the 8 tables.
  - All 20 policies keep the roles of their last definition before 0051 (`{public}`, or `{authenticated}` for `parents_*` and `session_leave_history_select`).
  - The agent's before/after dump of all 106 public policies is identical once the wrapping is normalised.
- `EXPLAIN (costs off)` as `authenticated` on `class_sessions` gives `Filter: ((InitPlan 1).col1 OR is_teacher_of_class(class_id) OR is_enrolled_in_class((InitPlan 2).col1, class_id) OR is_parent_in_class(class_id))`. So `is_admin()` and `auth.uid()` run once per query, and the row helpers still run per row.
- Verification: DB reset, then 1 475 tests (RLS suite included, none skipped), check and build, all exit 0.
- Note: `rls.spec.ts` needs a freshly reset DB. Run twice without a reset, it fails on leftover class and team names. That is existing behaviour.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter: no findings, verification-gap):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Header claims only wrapping, but the text also adds enum casts and qualifies `session_leave_history.class_session_id` | low | Real; spelling only. `class_sessions` has no `class_session_id`, so the old unqualified name already meant the outer table | patch (header) |
| 2 | Header lists three untouched hot-table policies; `classes_select_parent_in_class` is the fourth | low | Real; a direct correction | patch (header) |
| 3 | The remaining per-row cost (row-argument SECURITY DEFINER helpers) and the out-of-scope tables are not documented | low | Real; otherwise CAP-6 reads as fully solved | patch (header) |
| 4 | Production locking and rollback are not mentioned | low | Real: each drop/create takes a brief ACCESS EXCLUSIVE lock until commit, and a rollback needs a new migration | patch (header) |
| 5 | No automated guard keeps the `(select …)` form; a later migration could bring back the bare form unseen (blind + verification-gap) | medium | Verified: nothing reads `pg_policies`, and tests reach the DB only through supabase-js. The fix needs a new service-role RPC | defer |
| 6 | No `EXPLAIN` evidence recorded | false | Run during verification, recorded in Implementation Notes: the `class_sessions` filter shows `(InitPlan 1).col1 OR … is_enrolled_in_class((InitPlan 2).col1, …)` | reject |
| 7 | `alter policy` would have avoided restating roles | false | The frozen intent requires drop/create. Roles were checked: all 20 match their previous definitions (`{public}`, or `{authenticated}` on `parents_*` and `session_leave_history_select`) | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm run test` -- expected: exit 0, RLS suite included
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0

**Manual checks:**
- `EXPLAIN (costs off)` as a student on `class_sessions` shows `InitPlan` for `is_admin()` and `auth.uid()`.
- Production: the user applies the migration (`supabase db push` or their usual path). It cannot be undone by a code revert.
