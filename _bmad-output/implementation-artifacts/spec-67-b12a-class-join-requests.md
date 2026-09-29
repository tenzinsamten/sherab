---
title: 'B12a — Student class join requests: database and dashboard card (#67)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: 'f4d2c0828e72add7e12446a54a985718df0a9ebf'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An approved student can't join a second class themselves: the class code only works at sign-up, and only a teacher or the admin can enrol them (#67).

**Approach:** The student enters a class code on their dashboard; that creates a join request which the class's teacher (admin as backup) approves or rejects; approval enrols the student. B12a builds the database side (table, RLS, functions) and the student's dashboard card. B12b (next build) adds the teacher/admin section on /requests, the nav count and the end-to-end flow.

**Decisions (user, 2026-09-29):**
- Teachers/admin decide in a new "Class join requests" section on /requests (B12b).
- The student sees Pending and Rejected on the dashboard; no Withdraw for now; a Rejected request shows until the student dismisses it or sends a new request.
- A student may request again after a rejection; at most one pending request per student and class.
- A teacher who is the student's parent can't decide (the admin does).
- At most 3 pending requests per student.
- An unknown code and a class the student is already in give the same generic message.

## Boundaries & Constraints

**Always:** Only approved students can request. Every new function is security definer with `set search_path = ''`, starts with its authorisation check, and is revoked from public/anon. Approval enrols through the same path as `enroll_student` (so the late-joiner homework trigger fires). Clients get no direct INSERT/UPDATE/DELETE on the new table. The migration stays local until the user says push.

**Never:** No change to existing tables' columns or to `enroll_student`, `validate_class_code`, `class_enrollments` policies. No /requests UI, nav count or teacher e2e in this build (B12b).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request | approved student, valid code of a class they're not in | pending request; card shows "Pending: {class}" | N/A |
| Unknown or own class | code that doesn't exist, or of a class they're already in | nothing created; same generic message | 22023 hint `join_code_invalid` |
| Duplicate | second request for the same class while pending | nothing created; "already requested" | 23505 hint `join_already_pending` |
| Cap | a 4th pending request | nothing created | 22023 hint `join_limit` |
| Not allowed | pending/rejected student, teacher, parent, admin calls request | refused | 42501 |
| Approve | teacher of the class decides approve | request approved; student enrolled; class's open homework assigned | N/A |
| Reject then retry | teacher rejects; student requests again | card shows Rejected until the new request, then Pending | N/A |
| Dismiss | student dismisses a Rejected request | no longer shown | N/A |
| Own child | teacher of the class who is the student's parent decides | refused; admin can decide | 42501 |
| Other class's teacher | lists or decides a request for a class they don't teach | not listed; decide refused | 42501 |
| Decided twice | decide on a request that is no longer pending | refused | 22023 hint `join_not_pending` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0002_*.sql:183` -- `validate_class_code` (anon, security definer): reuse its code lookup (case-insensitive trim).
- `supabase/migrations/0016_class_enrollments.sql` -- `enroll_student` (177: admin or `is_teacher_of_class`, approved student, idempotent), late-joiner homework trigger (168), `profiles` read policy for teachers (277), `prevent_delete_class_with_students` (651); `is_teacher_of_class`.
- `supabase/migrations/0023_*` / `0029_*` -- `is_parent_of`, `deletion_requests` pattern (one pending per key, 0029:51).
- New `supabase/migrations/0031_class_join_requests.sql`:
  - Table `class_join_requests`: `id uuid pk default gen_random_uuid()`, `student_id uuid not null → profiles(id) on delete cascade`, `class_id uuid not null → classes(id) on delete cascade`, `status text not null default 'pending' check in (pending, approved, rejected)`, `requested_at timestamptz not null default now()`, `reviewed_by uuid → profiles(id) on delete set null`, `reviewed_at timestamptz`, `dismissed_at timestamptz`. Partial unique index `(student_id, class_id) where status = 'pending'`; index on `class_id`. RLS on; SELECT for `student_id = auth.uid()`, admin, `is_teacher_of_class(class_id)`; no client write policies.
  - `request_class_join(p_code text) returns text` (class name): caller must be an approved student (42501); code lookup; unknown or already enrolled → 22023 `join_code_invalid`; pending for that class → 23505 `join_already_pending`; ≥ 3 pending → 22023 `join_limit`.
  - `list_class_join_requests()` returns pending requests visible to the caller (admin: all; teacher: classes they teach): request id, student id, student display/registration name, current class names, class id/name, requested_at, `own_child boolean` (`is_parent_of(student)`).
  - `decide_class_join(p_request_id uuid, p_decision text)`: lock row; pending only (22023 `join_not_pending`); caller admin or `is_teacher_of_class`, and never `is_parent_of(student)` unless admin (42501); approve → insert `class_enrollments` (same body as `enroll_student`, `enrolled_by = auth.uid()`, idempotent); stamp `reviewed_by`/`reviewed_at`.
  - `dismiss_class_join(p_request_id uuid)`: own rejected request only; sets `dismissed_at`.
- `src/routes/student/+page.server.ts` / `+page.svelte` -- dashboard (only `markDone` today): load own requests (pending, and rejected not dismissed, newest first, with class name); actions `requestJoin` (code), `dismissJoin` (id); map hints to messages.
- `src/routes/(auth)/join/+page.svelte` -- class-code `ix-input` pattern (uppercase, `ixFieldError` on a `novalidate` form).
- `src/lib/server/rls.spec.ts` -- student/teacher/parent fixtures; dual-role fixture `dualRole` (service-role SQL) for the own-child case.
- `src/lib/supabase/database.types.ts` -- add the table and functions by hand (regeneration drops curated types).
- Messages en/de/bo: `student_join_*`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0031_class_join_requests.sql` -- table, RLS, four functions
- [x] `src/lib/supabase/database.types.ts` -- table + function types
- [x] `src/routes/student/+page.server.ts` -- load own requests; `requestJoin`, `dismissJoin` actions
- [x] `src/routes/student/+page.svelte` -- "Join another class" card: code `ix-input` + Send, list of Pending / Rejected (`ix-pill`) with Dismiss on Rejected
- [x] `messages/*.json` -- `student_join_*` keys
- [x] `src/lib/server/rls.spec.ts` -- every matrix row at the database level, incl. approval enrolling + open homework assigned, and a direct client INSERT/UPDATE being refused
- [x] `src/routes/student/page.server.spec.ts` -- actions' validation and hint → message mapping
- [x] `e2e/` -- student sends a code, sees Pending; rejected request (set via service role) shows and can be dismissed
- [x] `_bmad-output/manual-verification-issues.md` -- #67 "part a done (database + student card); part b open (B12b)"

**Acceptance Criteria:**
- Given the migration, when the DB is reset, then it applies after 0030 and no existing test changes.
- Given an approved join request, when the student opens My classes, then the new class is listed.

## Implementation Notes

- **Fifth function `my_class_join_requests()`** (security definer, `search_path = ''`, students only else 42501, revoked from public/anon): the dashboard needs the class name of a requested class, but students can't read `classes` rows they aren't enrolled in (classes RLS), so a plain table select + embed returns no name. Rather than widen the `classes` SELECT policy, this function returns the caller's pending and not-dismissed rejected requests with the class name, newest first. The table's own SELECT policy for the student is kept as specified.
- A new request for a class marks earlier not-dismissed rejected requests for that class `dismissed_at = now()` ("Rejected shows until … a new request").
- `request_class_join` takes a per-student transaction advisory lock so the duplicate / cap checks and the insert can't race; the partial unique index backs the duplicate rule.
- Check order in `request_class_join`: approved student (42501) → code / already enrolled (`join_code_invalid`) → already pending (`join_already_pending`) → cap (`join_limit`).
- `decide_class_join`: a missing request looks the same as not allowed (42501); nobody decides for their own child, the admin included (`(is_admin() or is_teacher_of_class) and not is_parent_of(student)`, as 0028 / AD-4); an invalid decision value is 22023 hint `join_decision_invalid`; a student no longer approved is 22023 hint `join_student_not_approved`.
- A pending request for a class the student has since been enrolled in another way is left out of `my_class_join_requests`, `list_class_join_requests` and the cap; approving it only marks it approved. The queue lists approved students only.
- The cap (3) is the SQL literal in `request_class_join`, tied by comment to `MAX_PENDING_JOIN_REQUESTS` in `class-join.ts`, which fills `{max}` in the message. Index `(student_id, status)` backs the per-student lookups.
- Messages don't name who decides ("wait for a decision"); a refused code is shown under the field only (restored from `form.code`), toasts are for dismiss failures. `class-join.ts` also maps `join_not_rejected` and the decide hints for B12b.
- `dismiss_class_join`: not own / missing → 42501; not rejected → 22023 hint `join_not_rejected`; idempotent.
- `list_class_join_requests`: callers other than admin / teacher get 42501.
- `requestJoin` / `dismissJoin` refuse a signed-out caller (401) like `markDone`.
- Hint → message mapping lives in `src/lib/server/class-join.ts`; a code over 32 characters is answered like an unknown code without a lookup.

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E, orchestrator = O). The first blind pass saw a diff missing the three new files (a staging slip on my side); it was re-run on the full diff.

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | O: `decide_class_join` lets an admin who is the student's parent decide | medium | 0028's sick-leave guard is `(is_admin() or is_teacher_of_class(..)) and not is_parent_of(student)`; AD-4 forbids deciding anything about one's own child | patch |
| 2 | E1 + E2 + B-new1: a pending request stays pending after the student is enrolled another way — shows on the dashboard, in the queue, and takes a cap slot | medium | nothing closes or filters it; approving it is a no-op | patch |
| 3 | E3 + B-new2 + B-new3: a request whose student is no longer an approved student stays in the queue; approving raises unhinted P0002 | low | `list_class_join_requests` doesn't filter student status/role; decide raises P0002 | patch |
| 4 | V1–V4 + B-old11: RLS gaps — newest-first order, cap counts only pending, decided requests leave the queue, rejected-status student refused, approving an already-enrolled student, invalid decision, unchecked delete results | medium | each passes today with the guard loosened | patch |
| 5 | B-old6: "Wait for the teacher" is wrong when the admin decides | low | own-child case; direct wording fix | patch |
| 6 | B-old5 + B-new5: the cap 3 is duplicated in SQL text and messages | low | direct: `{max}` param from one constant, SQL comment | patch |
| 7 | B-old7: `requestJoin` / `dismissJoin` skip the session guard | low | `markDone` and load use `safeGetSession`; direct | patch |
| 8 | B-old8 + B-old9: refused code not restored without JS; error announced twice | low | direct | patch |
| 9 | B-new11: dismiss errors always generic | low | `join_not_rejected` unmapped; direct | patch |
| 10 | B-new4: no index leading with `student_id` | low | direct: add `(student_id, status)` | patch |
| 11 | B-old2: no Withdraw; stuck at the cap if nobody decides | false | the intent decides "no Withdraw for now"; #2 removes the enrolled-elsewhere case | rejected |
| 12 | B-old3: no teacher/admin UI yet | false | the intent puts it in B12b, the next build | rejected |
| 13 | E4 + B-new6: own-child check only knows approved `parents` rows | maybe-false | same `is_parent_of` helper as every AD-4 guard (0028); would be low | rejected |
| 14 | B-old10: types added by hand, out of order | low | regeneration drops curated types (noted in B11) | rejected |
| 15 | B-old12: no component tests | low | Vitest runs in node; e2e covers | rejected |
| 16 | B-old13: dates not shown | low | not asked for | rejected |
| 17 | B-old14: button alignment magic number | low | cosmetic | rejected |
| 18 | B-old4: bo strings English | low | existing practice | rejected |
| 19 | E5: empty class name skips the toast | false | class names are required and non-empty | rejected |
| 20 | E6: five functions vs four in the spec | false | the fifth is recorded in Implementation Notes | rejected |
| 21 | B-new7: no rejection reason / notifications | false | not in the intent | rejected |
| 22 | B-new8 + B-new9 + B-new10: e2e fixtures without a teacher, serial dependency, uncovered UI paths | low | teacher flow is B12b's e2e; other paths covered at DB/unit level | rejected |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0 (0031 applies)
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
