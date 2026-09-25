---
title: 'Class days & sessions'
type: 'feature'
created: '2026-09-25'
status: 'done'
baseline_commit: '34213ddb60b8f47c9264227499610f98238b5959'
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
- [x] `supabase/migrations/0018_calendar.sql` -- `classes.default_start_time time`, `classes.default_duration_minutes int` (check 15–480, nullable); `class_days(id, day date unique, cancelled, created_by, created_at)`; `class_sessions(id, class_id, class_day_id, start_time_override, duration_minutes_override, cancelled, updated_by, updated_at, unique(class_id, class_day_id))`; SECURITY DEFINER triggers creating sessions on class_day and class insert; `class_sessions_effective` view (`security_invoker`); RLS + column grants per Boundaries.
- [x] `src/lib/supabase/database.types.ts` -- regenerate via `npm run supabase:types`.
- [x] `src/lib/berlin-date.ts` + `.spec.ts` -- `todayInBerlin()`, `currentBerlinMonth()` via `Intl` Europe/Berlin; test UTC-midnight and DST boundaries.
- [x] `src/lib/server/calendar.ts` + `.spec.ts` -- `weeklyDates(start, end)` (validated, max 1 year) and month shaping into dates → sessions (effective start/end, status Scheduled/Cancelled/Time not set); unit-test pure matrix rows.
- [x] `src/routes/calendar/+page.server.ts` + `+page.svelte` -- `?month=YYYY-MM` (default current Berlin month) loads by role; actions `addClassDays`, `setClassDayCancelled`, `setClassDefault`, `updateSession`, `setSessionCancelled` with server validation; date-grouped list with prev/next month and today marker; student view read-only.
- [x] `src/routes/+layout.svelte` -- `nav_calendar` for admin, teacher, student.
- [x] `messages/{en,de,bo}.json` -- all new keys.
- [x] `src/lib/server/rls.spec.ts` -- Story 6-1 block: trigger creation, override isolation, day cancel/restore, role access.

**Acceptance Criteria:**
- Given the admin has added class days, when any signed-in user opens that month, then those dates are listed.
- Given two teachers of one class edit different sessions at once, when both save, then both edits persist.

## Implementation Notes

- Class default is written through `set_class_default(class_id, start_time, duration)` (SECURITY DEFINER, checks `is_admin() or is_teacher_of_class()`), mirroring `set_class_syllabus` in 0014: a teacher UPDATE policy on `classes` would also expose `name`/`code`, which have no column grants.
- `class_sessions.updated_by/updated_at` and `class_days.created_by` are stamped server-side (trigger / `auth.uid()` default); clients get column grants only for `class_days(day)` insert, `class_days(cancelled)` update and the session override/cancel columns. No delete grant on either table.
- Bulk add uses `upsert(..., { onConflict: 'day', ignoreDuplicates: true })`; the returned rows are the newly added days, the rest are reported as "already existed".
- A new class also gets sessions on cancelled class days, so restoring such a day brings them back.
- `database.types.ts`: generated output merged by hand into the existing file to keep its hand-typed columns (`BadgeType`, `HomeworkReferenceLink[]`, …); `set_class_default` args typed nullable (NULL clears the default).
- Added `calendar`, `cancel`, `chevron-left/right`, `undo` to the registered iX icons (`src/lib/ix.ts`).
- `bo.json`: `nav_calendar`/`calendar_heading` in Tibetan (ལོ་ཐོ།); other new keys carry the English text, like the other recent keys in that file.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| EC1 | `weeklyDates` loops forever past year 9999 | high | Reproduced: after 9999-12-30, `addUtcDays` returns `+010000-01` (sorts before `9999`), which never advances. | patch (G1) |
| EC2 | Non-admin can reach `addClassDays` validation | high | The action has no role check before `weeklyDates`, so a student POST can trigger EC1. | patch (G1) |
| EC3 | `?month=9999-12` gives a 500 | low | `monthBounds` builds `10000-01-01`; `new Date` rejects it, so `toISOString` throws. | patch (G1) |
| EC4 | `?month=0000-01` gives a bad prev link | low | Negative index gives `-1-00`. Same root cause as EC1: unbounded year. | patch (G1) |
| EC5 / BH1 | `loadError` shows a blank list | medium | `{#if !data.loadError}` has no `{:else}`, so users see no error and no empty state. | patch |
| EC6 | `today` and `currentMonth` from two clocks | low | Two `new Date()` calls can straddle Berlin midnight at a month end. Fix: pass one `now`. | patch |
| EC7 | Concurrent class + class-day insert misses a session | low | Real under READ COMMITTED, but both inserts are admin-only and rare. The fix adds locking. | reject |
| EC8 | Class delete cascades sessions | low | Only a class with no students can be deleted (0011), and its sessions go with it. Changing the FK would block class deletion. | reject |
| VG1 / VG2 / BH12 | `/calendar` actions untested (zero-row fail, end fallback, error mapping, existed count) | gap | Pre-verified: no test calls the actions. | patch (G2) |
| VG3 / BH11a | Admin path and NULL-clear of `set_class_default` untested | gap | Pre-verified: all 4 RPC calls in the 6-1 block are teacher or student. | patch |
| VG4 | RLS block skipped without local Supabase | gap | Pre-existing repo-wide pattern (every story's RLS suite), no CI. | defer |
| BH2 | "Cancel session" button beside a Cancelled pill on a cancelled day | low | The button reads `sessionCancelled` only, so it contradicts the visible status on every cancelled day. | patch |
| BH3 | "min" hard-coded in the default hint | low | `defaultHint` puts English `${d} min` inside a de/bo message. | patch |
| BH4 | "Time not set" shown twice | low | `timeText` and the status pill both render `calendar_status_unset`. | patch |
| BH5 | New class gets sessions on past class days | maybe-false | Matrix says the class gets every existing day. Whether past ones should count as missed is a 6-2 attendance/streak question; if they would, severity is medium (unverified). | defer |
| BH6 | No audit stamp on `class_days` cancel/restore | low | Not required by spec; single admin. The fix adds columns and a trigger. | reject |
| BH7 | Pending or rejected accounts can read the calendar | false | Student credentials are created only at approval (0002 header), so pending or rejected users cannot sign in. | reject |
| BH8 | Past and cancelled-day sessions editable | false | User decision (3) in the spec explicitly allows editing past sessions. | reject |
| BH9 | One-year limit lenient from 29 Feb | low | One extra day, rarely hit. | reject |
| BH10 | RLS test data accumulates; random-year collision | low | About 1/6000 flake; `supabase:reset` clears it. Matches the suite's existing no-cleanup pattern. | reject |
| BH11b | Grants on `created_by`/`updated_by`/`day`, RPC range and cancelled-day sessions not asserted | low | Covered in part by the trigger-only test; the remaining assertions add little. | reject |
| BH13 | Default/session RPC failures not tied to the row | low | Inputs are server-validated first, so only rare permission or constraint failures reach it; the generic toast still shows. | reject |

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
