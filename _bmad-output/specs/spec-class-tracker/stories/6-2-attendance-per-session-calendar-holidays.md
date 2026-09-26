---
title: '6-2 Attendance per session & calendar holidays'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '26deb4613659c1e79b50157b11b57abc2f2a6b7b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Teachers mark attendance against a free-typed date (`attendance_records.session_date`), and a streak "holiday" is any week with zero attendance rows. Both ignore the calendar that 6-1/6-4 built, so marks can land on days with no class, and a week of cancelled class isn't recognized as a holiday.

**Approach:** Attendance rows reference a `class_sessions` row. Teachers pick one of the class's non-cancelled sessions, today or earlier. Existing marks are backfilled onto sessions without losing or moving any mark. `recompute_student_streak` takes session weeks from the calendar, and cancelling a session triggers a recompute. A test proves every existing student's streak is identical before and after the migration.

## Boundaries & Constraints

**Always:**
- `attendance_records` stays append-only. "Current" for (student, session) is the latest row by `recorded_at`. The INSERT policy keeps `is_teacher_of_class` + `is_enrolled_in_class`, plus: the session belongs to that class, it isn't cancelled, and its day is today (Berlin) or earlier.
- Weeks are ISO Monday weeks in Europe/Berlin, in SQL and UI alike. The streak walk starts at the current Berlin week, not UTC.
- `recompute_student_streak` stays the single streak path, with the same grace rules (`app_settings.streak_grace_weeks`). A week counts as a session week only if one of the student's classes has a non-cancelled session in it (`class_sessions_effective.cancelled = false`) that has at least one mark (see Decisions). Attendance weeks come from each mark's session day.
- Badges keep counting distinct attendance days (the session day replaces `session_date`), so badge totals don't change.
- A session that has attendance marks is never deleted: `ON DELETE RESTRICT`, and schedule regeneration skips such sessions.
- Changing a session's or class day's `cancelled` recomputes streaks for that class's enrolled students.

**Never:**
- No leave, Sick, or parent features (they replace 6-3 and ship with the Parent stories).
- No `UPDATE` or `DELETE` on `attendance_records` for clients, and no editing old migrations.
- No push to the hosted database.

**Decisions (user, 2026-09-26):**
- An old mark whose (class, date) has no session gets one. The migration creates the class day if it's missing, then an extra session (`extra = true`) for that class. Every mark then references a session, and those past classes appear on the calendar.
- A session with no attendance marks for any student of its class doesn't count as a session week for that class: it's treated like a holiday, so grace isn't consumed. A session week therefore needs a non-cancelled session with at least one mark.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mark attendance | teacher of class, non-cancelled session today | rows inserted with `class_session_id`; streak recomputed | N/A |
| Future session | session day after today (Berlin) | insert refused | RLS error → form error |
| Cancelled session | session or its day cancelled | insert refused; not offered in the UI | RLS error → form error |
| Wrong class | session of another class | insert refused | RLS error |
| Holiday week | week where every session of the student's classes is cancelled | week skipped, grace not consumed | N/A |
| Cancel after marking | session with marks is cancelled | its week no longer counts; streaks recomputed | N/A |
| Regeneration | schedule change would drop a today-session that has marks | session kept | N/A |
| Migration | existing marks + streaks | every mark keeps student, class, present, day and recorded_at; every `student_streaks` row identical | migration aborts if any mark can't be mapped |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0003_roster_skill_tracking.sql:52-71,129` -- `attendance_records` (`session_date date`, no unique key), indexes, SELECT policy. Read-only.
- `supabase/migrations/0007_streaks.sql:85-88,263-292` -- `(student_id, session_date)` / `(class_id, session_date)` indexes; `trg_recompute_student_streak` (exception-isolated) and the attendance/homework triggers.
- `supabase/migrations/0016_class_enrollments.sql:301-313` -- latest attendance INSERT policy; `:529-647` latest `recompute_student_streak`. It unions attendance weeks across all classes, intersects with homework-done weeks, and "session weeks" = weeks with any attendance row in the student's classes (the rule to replace). The walk starts at the UTC week, and there's one `student_streaks` row per student.
- `supabase/migrations/0008_badges.sql:139-142` -- attendance badge counts `distinct session_date`, present only. `:223` trigger fires on `present = true`.
- `supabase/migrations/0019_class_schedules.sql:183-218` -- `regenerate_class_sessions` deletes non-extra, non-matching sessions dated today or later (`:193`); must skip sessions with marks. `:326` `add_extra_session` (a pattern for backfill inserts). `:382` `class_sessions_effective` view (`day`, `cancelled = s.cancelled or d.cancelled`).
- `supabase/migrations/0021_attendance_per_session.sql` -- new (0020 is #50).
- `src/routes/teacher/classes/[id]/+page.server.ts:22-36,99-125,221-281` -- attendance types, load, `markAttendance` (form `sessionDate`) → load the class's markable sessions and take `sessionId`.
- `src/routes/teacher/classes/[id]/+page.svelte:44,130-150,238-250` -- UTC `today`, free date input, history by `sessionDate` → session picker (default: latest markable session) and history by session day. Use `$lib/berlin-date.ts`.
- `src/lib/supabase/database.types.ts:52-100` -- hand-merge the new column.
- `src/lib/server/rls.spec.ts` -- attendance blocks `:1091-1630` (Story 2-1), streak `:3252-3830` (helper `:3382` uses `session_date`; holiday test `:3775`), badges `:4040-4405` (`:4146` helper). Move helpers onto sessions, add a Story 6-2 block after 6-4 (`:5752`).
- `messages/{en,de,bo}.json` -- session-picker and error strings.
- `_bmad-output/implementation-artifacts/deferred-work.md:111-112` -- mid-year class past sessions: settled by 0019 `schedule_starts_on`. Weeks before a student's enrollment only end a streak that has already ended, so they need no extra rule.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0021_attendance_per_session.sql` -- add `class_session_id` (FK `on delete restrict`), backfill per the Decisions (create missing class days + extra sessions), then set NOT NULL. Snapshot `student_streaks` before and compare after in the same migration (raise on any difference). Replace the INSERT policy, `recompute_student_streak`, and the badge count. Add a session/class-day cancellation trigger that recomputes streaks, and make `regenerate_class_sessions` skip sessions with marks. Keep `session_date` (filled from the session day by a BEFORE INSERT trigger) so badge and history reads stay valid. -- the data layer.
- [x] `src/routes/teacher/classes/[id]/+page.server.ts` + `+page.svelte` -- session picker (non-cancelled, day ≤ today Berlin, newest first); `markAttendance` takes `sessionId`; history shows the session day. -- the teacher UI.
- [x] `src/lib/supabase/database.types.ts`, `messages/*.json` -- types and strings (de/en/bo). -- keep checks green.
- [x] `src/lib/server/rls.spec.ts` -- move helpers onto sessions. Add a Story 6-2 block covering every I/O-matrix row, plus a migration-equivalence test (seed legacy marks, apply the backfill function, compare streaks and marks). -- proof.
- [x] `src/routes/teacher/classes/[id]/page.server.spec.ts` -- new: `markAttendance` validates `sessionId` and maps RLS errors. -- the route had no tests.

**Acceptance Criteria:**
- Given a class whose sessions are all cancelled in one week, when streaks are computed, then that week neither extends nor breaks any student's streak.
- Given the database before 0021, when 0021 applies, then the mark count and every `student_streaks` row are unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind + edge | Backfill's new past class day spawns unmarked sessions for other schedule-matching classes (markable later, can turn a holiday into a miss) | medium | `attendance_backfill_session` inserts `class_days`; the 0019 insert trigger adds sessions for every matching class. The Decision says an extra session for *that* class only. | patch |
| 2 | blind + edge + vgap | Legacy mark on an already-cancelled session/day makes the equivalence proof abort with only a count | medium | New rule drops cancelled weeks, legacy rule counts them. Aborting matches the frozen "migration aborts" row, but the message must say which marks. | patch (pre-flight list + named students) |
| 3 | vgap (other) | `attendance_weeks` counts present marks on cancelled sessions | low | True at the attendance_weeks query; could make a week qualifying via another class's marked session. | patch |
| 4 | edge | Non-Monday `p_as_of_week` never matches week buckets | low | True; one-line `date_trunc`. | patch |
| 5 | blind + edge | 42501 mapping shows "session not markable" for mixed or non-session causes | low | True: the flag is set when any failure is 42501. | patch |
| 6 | vgap | Picker `load` filters and order untested | medium | page.server.spec only tests `markAttendance`. | patch |
| 7 | blind + edge + vgap | `ON DELETE RESTRICT` may block deleting a class with marks | false | Probed locally (rolled-back transaction): class with a mark deleted fine, marks removed. Regression test added via patch. | reject (test added) |
| 8 | edge | Test cancel updates don't check errors | low | True; trivial asserts. | patch |
| 9 | blind | Epic context still states the old holiday rule | low | True; the doc predates the Decision. | patch |
| 10 | blind | Cutoff uses the day, not session start time | false | Frozen Boundaries say "its day is today (Berlin) or earlier"; `session_starts_at` is Parent-role work (AD-15). | reject |
| 11 | blind | "Stored streaks unchanged" check can only pass | low | True that nothing recomputes during 0021; the meaningful legacy-vs-new rule check runs on real data. | reject |
| 12 | blind | Equivalence test uses a TS port of the old rule | low | Supplementary; the migration itself compares against the real 0016 SQL on real data. | reject |
| 13 | blind + edge | Tests use random years / create real recent class days (4-1 via `sessionFor`) | low | Local dev DB only; the suite already pollutes shared data. | defer |
| 14 | blind | Picker doesn't prefill current marks or flag marked sessions | medium | The form was always blank before 6-2 too. | defer |
| 15 | blind | Picker labels not localized; 60-session cap silent | low | Old date input was raw too. | reject |
| 16 | blind | `aria-pressed` attendance toggle from the epic UX not built | medium | Requirement predates 6-2; the checkbox form isn't changed here. | defer |
| 17 | blind | `session_date` could drift if day/session change | false | Clients can only update `class_days.cancelled` and the session override/cancel columns (0018 grants). | reject |
| 18 | blind | No recompute on enroll/unenroll | medium | The pre-6-2 rule depended on enrollments too, so it's not new. | defer |
| 19 | blind + edge | `student_streaks.class_id` can flip for multi-class students | low | Same "last firing class" semantics as before 6-2. | reject |
| 20 | edge | `params.id` letter case vs DB uuid | false | Route links use the DB's lowercase uuids. | reject |
| 21 | edge | `$effect.pre` may snap the picker back after a reload | maybe-false (low) | Would need a manual repro with an unrelated invalidate; if true, only cosmetic. | reject |
| 22 | blind | `bo.json` English copies for new keys | low | Already tracked in deferred-work (Tibetan calendar strings). | reject |
| 23 | vgap | RLS suite skips silently without Supabase | medium | Already deferred (#50). | reject (duplicate) |
| 24 | blind | Story spec missing from the review diff | false | Deliberately excluded; it's the claims file. | reject |

## Design Notes

Because a session only counts once it has a mark (Decisions), the first mark on a session changes the session weeks of every student enrolled in that class. So the attendance recompute trigger must run for all enrolled students of the class, not just `new.student_id`, and so must the cancellation trigger. Keep it statement-level or once per (class, session) so a whole-class marking doesn't recompute N² times.

The backfill and the equivalence check live in 0021 so the proof runs against real data, not only fixtures. The test repeats it on seeded data. Session week, as SQL:

```sql
exists (select 1 from class_sessions_effective s
        where s.class_id = any(student_classes) and not s.cancelled
          and date_trunc('week', s.day) = wk
          and exists (select 1 from attendance_records a where a.class_session_id = s.id))
```

## Verification

**Commands:**
- `npx supabase db reset` -- all migrations through 0021 apply, including the equivalence check.
- `npm run test` -- all pass, including the Story 2-1, 4-1, 4-2 and 6-2 blocks.
- `npm run check && npx eslint .` -- no errors.

**Manual checks:**
- As a teacher on a class page: the picker lists only past/today non-cancelled sessions; marking shows under the session day in history.
