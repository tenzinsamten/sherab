---
title: 'Roster & Skill-Status Tracking'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd72763e657cfec71836839ca62d5c05c9af00058'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Progress and continuity currently live only in teachers' heads — a substitute or a class handover has no record to pick up from, and Story 1-2 gave students a way to exist but nothing yet records what happens in class.

**Approach:** Any teacher assigned to a class marks weekly attendance (against a teacher-chosen session date, so late catch-up entries land on the right Sunday) and sets a per-student per-skill-area status (language/song/dance; Not started/Learning/Confident) with optional notes. Every change is an append-only insert, never an overwrite. The roster shows each student's current status by default, with an inline "view history" expansion revealing the full timeline — no separate screen.

## Boundaries & Constraints

**Always:** Authorization enforced entirely in RLS reusing `is_admin()`/`is_teacher_of_class(class_id)` — never a new per-feature check. Roster reads and writes are scoped to `profiles.role='student' AND status='approved'` within the teacher's assigned class — Pending/Rejected students never appear. Attendance and skill-status changes are append-only inserts; no UPDATE/DELETE policy exists on either table, matching the pattern already used for `profiles`. `class_id` is denormalized directly onto both new tables so RLS never needs a subquery through `profiles`.

**Never:** Do not compute or display anything derived from this data (streaks, badges, leaderboards) — Stories 4-1/4-2 read this data later, this story only records it correctly. Do not build homework tracking (Story 3-1). Do not build the admin cross-class oversight dashboard (Story 5-1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teacher marks attendance | Teacher assigned to class, student approved | New `attendance_records` row inserted | N/A |
| Teacher sets skill status | Teacher assigned to class, one of language/song/dance + level + optional note | New `skill_status_history` row inserted; latest row per (student, skill_area) is "current" | N/A |
| Substitute views history | Teacher newly assigned to a class with existing history | Full timeline visible, not just latest value | N/A |
| Non-assigned teacher attempts read/write | Direct API call, not assigned to that class | RLS returns/affects zero rows regardless of frontend state | N/A |
| Pending/Rejected student | Any roster query for that class | Never appears in roster reads or write targets | N/A |
| Two teachers edit concurrently | Two teachers, same student, same skill_area, near-simultaneous inserts | Both rows persist; no clobbering, no lock contention | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0003_roster_skill_tracking.sql` (new) -- `skill_area` enum (`language`/`song`/`dance`), `skill_level` enum (`not_started`/`learning`/`confident`); `skill_status_history(id, student_id, class_id, skill_area, level, notes, recorded_by, recorded_at)`; `attendance_records(id, student_id, class_id, present, notes, recorded_by, recorded_at, session_date date not null default current_date)`; RLS SELECT+INSERT policies on both reusing `is_admin()`/`is_teacher_of_class(class_id)`, no UPDATE/DELETE policy on either (append-only by absence, matching `profiles`'s pattern); indexes on `(student_id, skill_area, recorded_at desc)` and `(student_id, recorded_at desc)`.
- `src/routes/teacher/+page.svelte:32-36` -- replace the `m.teacher_no_roster_note()` placeholder with a link into the new roster route.
- `src/routes/teacher/classes/[id]/+page.server.ts`, `+page.svelte` (new) -- roster view: current status per student (latest row per skill_area via `distinct on`), mark-attendance and set-skill-status actions, reusing `admin/classes`'s `fail(status, {...echoed})` action pattern and `requests`'s "RLS is the real barrier, this check is UX-only" load-gating comment convention.
- `src/routes/admin/classes/+page.server.ts:15-58` -- action-shape pattern to mirror (not reused directly, different table).
- `messages/{en,de,bo}.json` -- new keys following the `<route>_<element>_<purpose>` convention; remove/replace `teacher_no_roster_note` once the real UI ships.
- `src/lib/server/rls.spec.ts` -- new "Story 2-1" describe block following the existing fixture shape (`createSignedInUser`, `anonClient()`, teacherA assigned/teacherB unassigned) — cover every I/O matrix row plus an explicit append-only assertion (two inserts for the same student+skill_area both persist, latest-by-timestamp query returns the newer one) and a concurrent-insert case.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0003_roster_skill_tracking.sql` -- schema + RLS per Code Map
- [x] `src/routes/teacher/classes/[id]/**` -- roster view + mark-attendance/set-skill-status actions
- [x] `src/routes/teacher/+page.svelte` -- replace placeholder with a real link
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- cover every I/O matrix row plus append-only and concurrency assertions

**Acceptance Criteria:**
- Given a student with three skill-status entries for `language` recorded at different times, when a teacher (or substitute, newly assigned) views that student's status, then the latest entry is shown as current and all three remain queryable as history.
- Given a teacher not assigned to a class, when they call the roster read/write endpoints directly for that class, then RLS returns/affects zero rows.
- Given two teachers both assigned to the same class inserting skill-status rows for the same student at the same time, then both rows persist with no error and no lost update.

## Implementation Notes

## Spec Change Log

None yet.

## Review Triage Log

Reviewed via `bmad-build` step-04 (blind-hunter, edge-case-hunter, verification-gap layers) against a real git diff (`git diff d72763e657cfec71836839ca62d5c05c9af00058` plus the untracked new files) — this is the first story in this repo with real VCS available for the review.

| # | Verdict | Route | Finding & evidence |
|---|---------|-------|---------------------|
| 1 | medium | patch | `+page.server.ts`'s `load()` "current" skill-status dedup logic (`currentSkillByKey`) has no test exercising the actual function/route — only a raw ordered DB query is tested in `rls.spec.ts`. Inverting the dedup guard would silently show the oldest status as current and no test would catch it. Filed pre-verified by the verification-gap layer; blind-hunter independently flagged the same route's validation branches (`roster_error_invalid_skill`, `roster_error_no_students`) and 404-mapping as equally untested. |
| 2 | medium | patch | `markAttendance` sends the whole roster's attendance as one multi-row insert; if any single row fails its `WITH CHECK` (e.g. a student's status changes between page load and submit), Postgres rejects the entire statement and the teacher sees one generic error with no indication the rest of the class's attendance was silently discarded too. Confirmed by direct read. |
| 3 | medium | patch | Attendance checkboxes default to checked (present) for every student with no confirmation step — a teacher rushing through could accidentally record absentees as present. Not specified either way by the spec or planning docs; the implementer's own default choice, and a real data-accuracy risk. |
| 4 | low-medium | patch | `load()`'s skill-status/attendance history queries filter only by `student_id`, never by the currently-viewed `class_id` — a teacher assigned to multiple classes could see a student's history from a different class if that student's `profiles.class_id` ever changed. Currently unreachable (no UI exists yet to move a student between classes), but the fix is a one-line filter and the current code's own comments already claim class-scoping that isn't actually enforced here. Confirmed by direct read. |
| 5 | low-medium | patch | Neither INSERT policy's `WITH CHECK` enforces `recorded_by = auth.uid()` — a teacher could, via a direct API call bypassing the UI (which always sets it correctly from the session), attribute a row to a different user. Matches this project's own stated AD-2 philosophy ("RLS is the real barrier, not just hidden UI"); the UI itself is unaffected by this fix. |
| 6 | low-medium | patch | Skill-status "current" resolution (`order by recorded_at desc`, first-wins) has no tiebreaker for identical timestamps, which the spec's own concurrent-edit requirement makes a real (if rare) scenario — which entry displays as current would be non-deterministic on a tie. Confirmed by direct read. |
| 7 | low | patch | No RLS test covers a teacher assigned to Class A inserting a row with `class_id=A` but a `student_id` belonging to a different class — exactly the scenario the migration's own `exists()` check comment says it exists to prevent, yet it's untested. |
| 8 | low | patch | Neither `skill_status_history` nor `attendance_records` has an index on `class_id`, despite every SELECT RLS policy on both filtering via `is_teacher_of_class(class_id)` — the actual roster page's access pattern. Cheap, correct addition. |
| 9 | low | patch | `sessionDate` is only checked for truthiness server-side, not date-format validity — a malformed value only surfaces as the generic `roster_error_attendance_save_failed` instead of a specific message. |
| 10 | low | patch | The "neither table has an UPDATE or DELETE policy" test only exercises `skill_status_history` despite its own name promising "neither table" — `attendance_records` immutability is asserted only in comments/Boundaries, never tested. |
| — | false | reject | `is_admin()`'s unconditional bypass of the approved-student `exists()` check is untested — flagged by blind-hunter, but explicitly not filed by the verification-gap layer after checking: no current caller reaches this path (the admin cross-class dashboard is deferred to Story 5-1), and the existing test suite doesn't systematically test admin-bypass branches on other tables either. Not a regression against an established convention. |
| — | false | reject | Correcting a single mistaken attendance mark requires resubmitting the whole roster, creating redundant rows for already-correct students — this is the by-design cost of the append-only architecture the frozen Boundaries explicitly require ("never an overwrite"), not a defect; the resulting rows are idempotent in effect (latest wins), just extra history noise. |
| — | false | reject | `messages/bo.json`'s new `roster_*`/`teacher_view_roster` keys are English placeholders, not real Tibetan — matches the exact, already-documented project convention (Story 1-1's own `deferred-work.md` entry covers this generically); not a new or undocumented gap. |

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including new live-Supabase RLS cases (requires `npm run supabase:start` first)
