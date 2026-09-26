---
title: 'Fix Story 5-1 test that expects students to see no classes'
type: 'bugfix'
created: '2026-09-26'
status: 'done'
route: 'oneshot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Story 5-1 RLS test "a teacher's identical aggregate queries stay scoped to their own assignment" (`src/lib/server/rls.spec.ts`) asserts that a signed-in, approved student sees zero `classes` rows. Since migration 0014 (`classes_select_own_student`, re-pointed in 0016 to `is_enrolled_in_class`), a student can read the classes they're enrolled in, so the test fails and `npm run test` is never fully green.

**Approach:** Update the assertion and its comment to the current rule. The student sees exactly their own class (`ownClassId`) and never the foreign class the admin dashboard aggregates. No policy or migration changes.

</frozen-after-approval>

## Implementation Notes

- `src/lib/server/rls.spec.ts` (Story 5-1 "identical aggregate queries" test): the student `classes` assertion now expects `[{ id: ownClassId }]`. The comment names the policy and the `profiles_enroll_on_approval` trigger that creates the enrollment.
- Verified: `npx supabase db reset`, then `vitest -t "Story 5-1"`: 5 passed. Prettier clean.

## Review Triage Log

| # | Finding | Verdict | Evidence / route |
|---|---------|---------|------------------|
| 1 | Spec lacks the full template sections and `baseline_commit` | false | The oneshot route deliberately keeps only frontmatter, Intent and Implementation Notes; status moves to done at finalize. Reject. |
| 2 | Assertion depends on the enrollment trigger, which the comment doesn't mention | low | True; a one-line comment. Patched. |
| 3 | No negative case (pending student with class_id sees no classes) | medium | Real gap, but existed before this fix (0014/0016 added the policy untested). Deferred. |
| 4 | Multi-enrollment visibility untested | medium | Same root cause as #3. Deferred with it. |
| 5 | Test title no longer matches the student-visibility assertion | low | Cosmetic; splitting the test adds churn for little gain. Reject. |
| 6 | Cause not linked to the skip-when-unreachable deferred item; not logged as an issue first | low | The user asked for this fix directly (the log-first rule covers reported manual-verification bugs); cross-linking is cosmetic. Reject. |
| 7 | Other stale "students can't read classes" assumptions not searched | false | Searched rls.spec.ts: no other student `classes` read or "no select policy" assumption. Reject. |
