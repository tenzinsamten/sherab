# Brownfield: code this spec touches

These locations were found on 2026-10-30. Before building, re-check them with `grep -rn "homework_status_history_insert\|markHomeworkDone\|recorded_by" src supabase/migrations`.

| Where | What it does today | Change needed |
| --- | --- | --- |
| `supabase/migrations/0016_class_enrollments.sql:315` | `homework_status_history_insert_admin_teacher_or_self_done`: admin, the class teacher, or the student's own `done` | Replace in a new migration (next free number, 0060 at time of writing). Add a parent `done` branch inside the existing done/reviewed clause, keeping the `assigned` prerequisite (CAP-2) |
| `supabase/migrations/0025_parent_reads.sql:158` | Parents can already read instances (`is_parent_targeted_for_homework_instance`) | None. This is why the policy's instance `exists` check passes for parents |
| `supabase/migrations/0054_student_parents.sql:529` | `is_parent_of()`: approved parent with an active link | Reuse it in the new parent-managing helper and the flag function |
| `src/lib/supabase/database.types.ts` | Hand-maintained types | Add the flag column and the new functions by hand. Never regenerate this file |
| `src/lib/server/student-homework.ts:362` | `markHomeworkDone()`: reads the instance, then inserts with `student_id = recorded_by = user.id` | Add a parent variant that takes the child id, already checked with `loadLinkedChild()` |
| `src/lib/server/linked-child.ts` | `loadLinkedChild()` returns 404 unless the child is linked and approved | Reuse it in every new parent action and in the detail page |
| `src/routes/parent/children/[id]/+page.server.ts` (actions at lines 619-830, `ChildHomeworkItem` at line 113) | Homework tab is read-only | Add the flag action and the mark-done action. Load `parentManaged` and a done-by label |
| `src/lib/server/actor-labels.ts`, `0055_second_parent_reads.sql:41` (`actor_display_name`) | Labels who set each leave answer ("you" or the other parent); pattern used at child page lines 230-256 | Same pattern for `recorded_by` on done rows. The child's own mark needs the child's name, which `actor_display_name` doesn't cover |
| `src/routes/parent/homework/+page.server.ts` | Read-only list of open homework (comment at lines 90-96) | Add a mark-done action for parent-managed children, and link each row to the detail page |
| `src/routes/student/homework/[instanceId]/`, `src/lib/server/homework-view.ts` | Student detail page and its read helpers | Reuse them for the new parent detail page (CAP-3) |
| `src/lib/server/push.ts`, `homework_push_targets()` (0054:581) | Sends alerts for open homework only | None. Marking done stops the alerts |
| Tests: `src/lib/server/rls.spec.ts`, `src/lib/server/testing/link-parent.ts`, `e2e/parent-access.e2e.ts` | RLS tests, parent-linking fixture, parent end-to-end tests | Extend them |
