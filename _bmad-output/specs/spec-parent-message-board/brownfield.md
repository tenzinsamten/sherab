# Brownfield: code this spec touches

These locations were found on 2026-10-31. Before building, re-check them with `grep -rn "is_parent()\|is_admin()\|push_subscriptions\|readPdfUpload" src supabase/migrations`.

| Where | What it does today | Change needed |
| --- | --- | --- |
| `supabase/migrations/` (last is `0060_parent_managed_homework.sql`) | No board or post table exists | New migration `0061`: posts table, attachments table, private bucket and its storage policies, the parent posting-grant column, and RLS for CAP-1 to CAP-4 |
| `supabase/migrations/0001_init.sql:28,86` | `user_role` enum (`admin`, `teacher`, `student`); `is_admin()` | Reuse them in the board policies. A teacher is `profiles.role = 'teacher'` |
| `supabase/migrations/0023_parents.sql:107` | `is_parent()`: true only with an approved `parents` row | The poster check for parents is `is_parent()` plus the grant (CAP-2, CAP-4) |
| `supabase/migrations/0023_parents.sql:28` | `parents.status`; only the admin changes it | A natural home for the grant flag, written by admin-only code |
| `src/lib/homework-files.ts`, `src/lib/server/homework-files.ts`, `src/lib/server/pdf-files.ts` | PDF limits (5 MB, 2 files), `readFileForm`, `readPdfUpload`, `storeObject`, `signObject`, `removeObjects` | Reuse them for post attachments. Objects can't be deleted from SQL, so deleting a post removes its objects first, as `removeStoredFiles` does |
| `src/lib/server/push.ts`, `supabase/migrations/0037_push_notifications.sql` | Homework push: `PUSH_KINDS`, targets from `homework_push_targets`, `PUSH_BATCH` 20, `announceHomework()` | Add a board kind with its own targets: every subscription except the author's. Same batching and logging |
| `src/routes/api/push/run` | Push job endpoint for batches | Extend it for the board kind if follow-up batches are needed |
| `src/routes/admin/parents/+page.server.ts` | Admin parent list with status | Add the posting on/off action and its display (CAP-4) |
| `src/routes/+layout.svelte`, role layouts | Navigation for each role | Add the board link for every role |
| `src/lib/supabase/database.types.ts` | Hand-maintained types | Add the new tables, columns and functions by hand |
| Tests: `src/lib/server/rls.spec.ts`, `src/lib/server/push.spec.ts`, `e2e/` | RLS, push and end-to-end tests | RLS tests for every role per CAP-1 to CAP-4, push target tests, and one e2e post-and-read journey |
