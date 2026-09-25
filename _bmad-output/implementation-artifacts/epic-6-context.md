# Epic 6 Context: Calendar

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic gives the school a shared calendar: the admin marks the days classes happen, each class gets a concrete session on every such day (with its own start time and duration, adjustable or cancellable per day by the class's teachers), and students announce per session whether they are Coming or On leave. It matters because scheduled sessions become the source of truth for attendance and for streak holidays: teachers stop marking attendance against a free-chosen date, a week with no real session no longer depends on "nobody was marked" to count as a holiday, and a student who announces leave in advance does not lose streak grace. Note: the architecture spine and UX documents predate this epic (they bind CAP-1..8 only) and contain no calendar-specific decisions or screens; their general invariants apply by extension.

## Stories

- Story 6-1: Class days & sessions
- Story 6-2: Attendance per session & calendar holidays
- Story 6-3: Student Coming / On leave

## Requirements & Constraints

- Class days are school-wide and admin-owned; several classes can run on one day. No session may exist on a day the admin has not marked, and every role sees the same class days.
- Every class has a default start time and duration. Each class day yields a session per class from those defaults. Any teacher of the class can override one day's start time/duration or cancel that day; this must never change the class default or any other day.
- Removing a class day cancels every session on that day (assumption, adopted).
- Times are Munich local (Europe/Berlin); no multi-timezone support.
- Students see each enrolled class's sessions with that day's actual start time and duration. Overlapping sessions across a student's classes are not blocked.
- Attendance is marked per scheduled, non-cancelled session, replacing marks against a free-chosen date. Existing attendance history must be carried onto sessions without losing or moving any mark, and every student's streak must be identical before and after that migration, proven by a test.
- Streaks stay weekly: attending any session in a week qualifies the week. A week with no non-cancelled session for the class is a holiday and does not consume grace; a missed session with an announced leave does not consume grace either.
- Attendance intent states: Coming, On leave, not answered (default, treated as expected). Only for upcoming sessions of classes the student is enrolled in. Visible to that class's teachers, classmates and the student's team, showing nickname and state only.
- Leave protects the streak only if set before the session's start time; a later change must never retroactively excuse an absence.
- No leave reason is collected (data minimization on minors).
- Out of scope unless resolved first: date-range leave, notifications about moved/cancelled sessions, overlap warnings, calendar export/sync (iCal, Google). Still open: whether team-wide visibility of leave fits the minimize-data-on-minors constraint.
- All UI copy goes through Paraglide with keys in en, de and bo. The WCAG 2.2 AA floor applies.

## Technical Decisions

- Keep the existing paradigm: the client talks to Supabase directly and all authorization lives in RLS. Class-scoped checks resolve through the existing `is_admin()` / `is_teacher_of_class()` helpers. Do not invent new per-table checks. Class days are admin-write only. Session defaults, overrides and cancellation are writable by any teacher of that class. Students write only their own intent rows, and only for classes they are enrolled in.
- Enrollment is many-to-many through `class_enrollments` (migration 0016). Anything about "a student's classes" (intent, session visibility, streak holiday per class) must use it, not a single class on the profile.
- Attendance stays append-only (history-as-append; "current" = latest row). Intent should follow the same history pattern so the value in effect at session start can be determined; that is what the "set before start" rule needs.
- Streak and badge state stays trigger-written derived state and is fully recomputed from source history. Only story 6-2 touches `attendance_records.session_date` (0003) and `recompute_student_streak()` (0007), which today uses ISO-week bucketing via `date_trunc('week', ...)` and treats "zero attendance rows for the class that week" as a holiday. 6-2 replaces that holiday rule with "no non-cancelled session that week" and adds announced-leave exemption. 6-3's leave must feed the streak recompute through a trigger, not client logic.
- Store session times as Munich-local wall-clock values, not as UTC-shifted instants. The "before session start" comparison must be done in Europe/Berlin. Other timestamps remain `timestamptz` UTC; dates are ISO 8601.
- Conventions: new migrations continue after 0017. `snake_case` tables and columns, kebab-case routes, PascalCase Svelte components, UUID PKs. Admin-tunable values go in `app_settings`, never hardcoded.

## UX & Interaction Patterns

- No calendar screens are designed. Ship functional-first and flag any real design decision instead of inventing one.
- A calendar view must be reachable from the admin, teacher and student menus. The student menu currently has Dashboard, My classes, My homework and Team leaderboard.
- Reuse the existing visual system. Use zero border-radius. Data tables become stacked hairline rows on phone. Use a status chip for states such as Cancelled, Coming and On leave. Amber is reserved for "waiting on a person" and red for validation errors, so neither should mark cancelled or on-leave by default.
- Microcopy is terse and instructive, with no exclamation points or emoji. Empty states (for example, no class days marked yet) describe the actual situation.
- Layout is mobile-first and single-column, with the same data on desktop in a wider layout.

## Cross-Story Dependencies

- 6-1 is the foundation: 6-2 and 6-3 both need class days and per-class sessions to exist.
- 6-1 must not touch attendance or streaks. All attendance/streak changes land in 6-2.
- 6-3's streak effect (leave does not consume grace) depends on 6-2's session-based recompute. Build 6-3 after 6-2, or make its recompute hook extend 6-2's function rather than fork it.
- The epic depends on Epic 2 attendance data, Epic 4 streak logic (grace in `app_settings.streak_grace_weeks`), Epic 1's team assignment (for team visibility of intent), and the class_enrollments model from 0016.
