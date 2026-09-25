---
title: 'Class days & sessions'
type: 'feature'
created: '2026-09-25'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/specs/spec-class-tracker/calendar.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing records which days classes happen or when a class starts and how long it runs, so there is no shared schedule and start time/duration cannot vary per day (SPEC CAP-9, CAP-10).

**Approach:** Admin bulk-adds school-wide class days; each class gets a default start time + duration; every (class, class day) pair has one session row with optional per-day overrides and a cancelled flag. A role-aware `/calendar` page lists one month's sessions by date and lets permitted roles edit them.

## Boundaries & Constraints

**Always:** Sessions exist only for admin class days. Effective start/duration = session override, else class default; editing one session never writes the default or another session. Removing a class day is a soft cancel (`class_days.cancelled`); restoring returns each session's own prior state. Times stored as wall-clock `time` + `date` (Munich local); "today"/current month computed in Europe/Berlin, never a UTC date. Authorization only via RLS with `is_admin()`, `is_teacher_of_class()`, `is_enrolled_in_class(auth.uid(), …)`: class days admin-write, readable by any signed-in user; class default and session overrides/cancel writable by admin or any teacher of the class; students read enrolled classes' sessions only. Session rows created by triggers only. Paraglide en/de/bo; WCAG 2.2 AA.

**Decisions (user, 2026-09-25):** (1) Admin adds class days in bulk: start date + "repeat weekly until <end date>" (single date = start equals end); existing dates are skipped, not errors; each day stays individually cancellable, and teachers override time/duration per session. (2) Month grid is deferred (see deferred-work.md); this story shows the selected month as a date-grouped list. (3) Opens on the current Berlin month with today marked; previous/next month navigation shows past and future; admin/teachers may edit past sessions within their rights.

**Never:** Do not touch `attendance_records`, streak/badge functions or leaderboard (6-2). No student intent/leave (6-3). No month grid, notifications, overlap warnings or iCal export. No hard delete of class days or sessions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bulk add | 2026-10-04 weekly until 10-25, 2 classes, 10-11 exists | 3 class days, 6 sessions; "3 added, 1 already existed" | End before start or range > 1 year → inline validation |
| New class created | 3 class days exist | Class gets 3 sessions | N/A |
| Override one day | Start 10:00→11:00 | Only that session shows 11:00 | Invalid time/duration → inline validation |
| Default changed | Default 10:00→09:30 | Non-overridden sessions 09:30; overridden unchanged | N/A |
| No default | Class default unset | Session shows "Time not set" | N/A |
| Cancel/restore session | One session | Only it shows Cancelled / returns | N/A |
| Cancel class day | Day with 2 sessions | Both Cancelled; restore returns prior per-session state | N/A |
| Other teacher edits | Not assigned to class | Denied by RLS | Generic error message |
| Student views | Enrolled in 2 classes | Both classes' sessions, read-only, no others | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0015_class_syllabi.sql` -- idiom to mirror: header comment, named checks, table comment, index, policies `is_admin() or is_teacher_of_class(class_id)` (35–60), `revoke update` + column `grant update` (64–65).
- `supabase/migrations/0001_init.sql:45,86,104` -- `classes` (no schedule columns), `is_admin()`, `is_teacher_of_class()`.
- `supabase/migrations/0016_class_enrollments.sql:46` -- `is_enrolled_in_class(p_student, p_class)`.
- `src/routes/+layout.svelte:75–103,165` -- shared `leaderboard` nav item and per-role menus; add `calendar` the same way.
- `src/routes/leaderboard/+page.server.ts` -- precedent for a signed-in, role-agnostic route.
- `src/lib/server/leaderboard.ts` + `.spec.ts` -- pure shaping helper pattern.
- `src/lib/server/class-syllabus.ts:188` -- last-write-wins `updated_at` pattern.
- `src/lib/server/rls.spec.ts:4681` -- last `describe.skipIf(!reachable)` block; append Story 6-1 after it.
- `src/routes/student/+page.server.ts` -- UTC `toISOString().slice(0,10)` "today"; do not copy.
- `messages/{en,de,bo}.json` -- `calendar_*`, `nav_calendar`; import `* as m from '$lib/paraglide/messages.js'`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0018_calendar.sql` -- `classes.default_start_time time`, `classes.default_duration_minutes int` (check 15–480, nullable); `class_days(id, day date unique, cancelled, created_by, created_at)`; `class_sessions(id, class_id, class_day_id, start_time_override, duration_minutes_override, cancelled, updated_by, updated_at, unique(class_id, class_day_id))`; SECURITY DEFINER triggers creating sessions on class_day and class insert; `class_sessions_effective` view (`security_invoker`); RLS + column grants per Boundaries.
- [ ] `src/lib/supabase/database.types.ts` -- regenerate via `npm run supabase:types`.
- [ ] `src/lib/berlin-date.ts` + `.spec.ts` -- `todayInBerlin()`, `currentBerlinMonth()` via `Intl` Europe/Berlin; test UTC-midnight and DST boundaries.
- [ ] `src/lib/server/calendar.ts` + `.spec.ts` -- `weeklyDates(start, end)` (validated, max 1 year) and month shaping into dates → sessions (effective start/end, status Scheduled/Cancelled/Time not set); unit-test pure matrix rows.
- [ ] `src/routes/calendar/+page.server.ts` + `+page.svelte` -- `?month=YYYY-MM` (default current Berlin month) loads by role; actions `addClassDays`, `setClassDayCancelled`, `setClassDefault`, `updateSession`, `setSessionCancelled` with server validation; date-grouped list with prev/next month and today marker; student view read-only.
- [ ] `src/routes/+layout.svelte` -- `nav_calendar` for admin, teacher, student.
- [ ] `messages/{en,de,bo}.json` -- all new keys.
- [ ] `src/lib/server/rls.spec.ts` -- Story 6-1 block: trigger creation, override isolation, day cancel/restore, role access.

**Acceptance Criteria:**
- Given the admin has added class days, when any signed-in user opens that month, then those dates are listed.
- Given two teachers of one class edit different sessions at once, when both save, then both edits persist.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

Sessions are materialized so 6-2 can reference a stable `class_sessions.id` from attendance. Nullable override columns let a default change flow to non-overridden days. Day-level cancel is separate from session cancel so restoring a day keeps each session's own state. The deferred month grid can render the same `?month=` load.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: all migrations incl. 0018 apply.
- `npm test` -- expected: pass, incl. new unit and RLS blocks.
- `npm run check` -- expected: 0 errors.
- `npm run lint` -- expected: clean.

**Manual checks (if no CLI):**
- As admin, teacher and student at phone width: menu entry, month list, navigation and edit rights match the matrix.
