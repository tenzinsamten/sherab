# Brownfield: direct parent-link readers

Code that reads `profiles.parent_id` directly instead of through `is_parent_of()` / `linked_children()`. Each one must move to the link model, or the second parent silently gets nothing there (SPEC Constraints). Found 2026-10-27; re-check with `grep -rn parent_id src supabase/migrations` before building.

Ownership (architecture AD-10): `profiles.parent_id` is renamed `registered_by_parent_id`. Story 1's migration rebuilds every **database function** in this list on top of the links, including the 0037 push recipients and the 0042 duplicate check, and fails if any function body still names `parent_id`. Story 2 moves the **TypeScript readers** (the `src/` rows).

| Where | What it does | Second parent's symptom if missed |
| --- | --- | --- |
| `src/routes/calendar/+page.server.ts:213-221` | Parent calendar: enrollments and leave answers filtered on `student.parent_id = caller` | Empty calendar, no leave answers |
| `src/routes/admin/parents/+page.server.ts:53-80` | Admin parents page groups children by `parent_id` | B listed with no children |
| `supabase/migrations/0037_push_notifications.sql:233` | Homework push recipients join `pa.id = s.parent_id` | No push notifications |
| `supabase/migrations/0042_student_unique_per_parent.sql` | Unique `(parent_id, lower(btrim(registration_name)))` and `student_registration_state()` | Duplicate child check sees only the first parent (CAP-5) |
| `supabase/migrations/0024_parent_first_registration.sql` | `handle_new_user()` sets `parent_id`; guard trigger protects it; `is_parent_of()`, `linked_children()` defined here | Helpers must read the links |
| `supabase/migrations/0029_deletion_requests.sql:51` | `deletion_requests_one_pending_per_student` | Raw unique-violation error for the second requester |
| `supabase/migrations/0033_promote_parent_to_teacher.sql` | Promote / demote touches the parent row | Link and slot handling on demotion |
| Server files using `parent_id`: `src/lib/server/leave.ts`, `linked-child.ts`, `parent-registration.ts`, `pdf-files.ts`; `src/routes/parent/**`, `src/routes/admin/teachers/+page.server.ts`, `src/routes/(auth)/join/*` | Mixed reads and registration | Check each one |
