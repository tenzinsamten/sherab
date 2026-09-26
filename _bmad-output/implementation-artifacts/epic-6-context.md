# Epic 6 Context: Calendar: class days, sessions, schedules, attendance per session, leave

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the school calendar the source of truth for when classes happen. The admin marks school-wide class days. Each class's schedule picks its sessions from those days, and teachers can add extra sessions or change single ones. Attendance is then marked against real sessions instead of a date the teacher picks, and streak holidays follow from the calendar. This matters because streaks, leave and the parent view all depend on knowing which sessions actually took place. Status: 6-1 (class days and sessions) and 6-4 (schedules and extra sessions) are done. 6-2 (attendance per session and calendar holidays) is next. 6-3 (student-set Coming/On leave) is **superseded**: the Parent role moves leave to the parent and adds Sick leave (see Cross-Story Dependencies), so do not build 6-3 as written.

## Stories

- Story 6.1: Class days & sessions (done)
- Story 6.4: Class schedules & extra sessions (done)
- Story 6.2: Attendance per session & calendar holidays (next)
- Story 6.3: Student Coming / On leave (superseded by parent-set session leave)

## Requirements & Constraints

- Sessions exist only on admin-marked class days, either matching the class schedule (weekdays, start/end date) or added as an extra. A per-session time or cancellation is an override. It never changes the schedule or other sessions.
- Changing a schedule regenerates only sessions dated today (Berlin) or later. Past sessions are never touched. Removing a class day cancels every session on it.
- Attendance (present/absent) is marked by any teacher of the class against a scheduled, **non-cancelled** session. This replaces marks against a free-chosen weekly date.
- Streaks stay weekly: attending any session in a week qualifies that week. They need both attendance and homework Done (Reviewed is not required).
- A week counts for streaks only if the class has a non-cancelled session in it that has at least one attendance mark. Any other week is a holiday and does not use up streak grace: a week whose sessions are all cancelled, and a session with no marks at all, which is treated like a holiday (user decision 2026-09-26). A missed session with Planned Leave or approved Sick leave does not use up grace either. Short-notice leave, rejected Sick leave, unannounced absence and pending Sick leave each use up one grace week. A pending Sick answer is recalculated once it is decided.
- Migration safety for 6-2: every existing attendance mark must be moved onto a session without losing or moving any mark. Every current student's streak must be identical before and after the migration, and a test must prove both.
- Grace period (default 2 weeks) and leave notice period (default 2 weeks) are admin-configurable and never hardcoded.
- Two teachers editing the same class at the same time must not overwrite each other's changes. The UI is in German, English and Tibetan.

## Technical Decisions

- **Stack:** SvelteKit PWA talks to Supabase directly. Authorization is enforced only through RLS, using the shared helpers `is_admin()`, `is_teacher_of_class()`, `is_parent_of()` and `is_parent_in_class()`. Never write a local permission check.
- **Derived state comes from triggers:** session generation and streak recompute are DB triggers on the source write, never called by the client. `recompute_student_streak` is the **single** streak path. Triggers on `attendance_records`, `homework_status_history`, `session_leave_history`, `sick_leave_decisions` and `class_sessions` cancellation all call it. Derived counts use distinct `(student_id, homework_instance_id)` pairs, not raw history rows.
- **Append-only history:** `attendance_records` stays append-only. The current value is the latest row per subject (student + session). A BEFORE INSERT trigger stamps `*_by`/`*_at` from `auth.uid()`/`now()`.
- **What changes in 6-2:** `attendance_records` is keyed by `session_date` today and must be re-keyed to `class_sessions`. The week bucketing and the "zero rows means holiday" rule in `recompute_student_streak()` must move to "a week counts only with a non-cancelled session that has at least one mark". A session with no marks at all is treated like a holiday.
- **Session timing has one source:** `session_starts_at(class_session_id)` returns the session override, otherwise the class default, in Europe/Berlin. A session with no time set starts at 00:00 local. Every cutoff and leave classification must use it.
- **Session leave (replaces 6-3):** `session_leave_history` is append-only and keyed by session + student, with answers `coming`/`on_leave`/`sick`. Only `is_parent_of(student_id)` may insert. The DB enforces the cutoffs: coming/on_leave until the session starts, sick until the end of the next day. `classify_leave()` stamps planned/short_notice on insert, and the classification stays fixed afterwards. `preview_leave()` is the RPC the UI calls before saving. Sick decisions go in `sick_leave_decisions` per (session, student), made by a class teacher or the admin, never by the student's own parent. A rejection is final for that session. A daily idempotent `pg_cron` job auto-approves Sick answers still undecided 14 days after the session. Leave rows are deleted together with any session removed by regeneration.
- **Sick masking:** classmates and team members read leave only through one security-definer function, which returns `sick` as `on_leave`. Base-table SELECT is limited to the student, the parent, the class's teachers and the admin. Parents never see classmates. `attendance_records.notes` stay visible to teachers only.
- **Conventions:** times are Europe/Berlin and timestamps are `timestamptz` UTC. Admin-tunable values live in `app_settings`. New security-definer functions set `search_path = ''`, check the caller and grant EXECUTE explicitly. UI strings use Paraglide keys in en, de and bo.

## UX & Interaction Patterns

- A shared `/calendar` view with a month grid, reachable from the admin, teacher and student menus (and later the parent menu). Selecting a day shows its sessions with edit controls that depend on the user's role. It must be keyboard-navigable and usable at phone width.
- The attendance toggle is a `<button aria-pressed>` per student with a 48px minimum target, usable one-handed, because it is marked mid-class. Teacher views use dense, quiet styling. Students and parents see each session's actual start time and duration.
- For leave, the parent sees before saving whether an answer will count as Planned or Short-notice. Students see the answer read-only. An unanswered session shows as "not answered". No leave reason is collected.

## Cross-Story Dependencies

- 6-2 builds on 6-1 and 6-4. 6-4 already limits a mid-year class's sessions to dates from its schedule start date. 6-2 must still make sure sessions from before a student's or class's start never count as missed.
- The streak rewrite in 6-2 is the same single path that the Parent role's leave and Sick-decision triggers will call later. Those rules (Planned or approved-Sick leave protects a week) extend it rather than adding a second streak computation.
- Session leave depends on the Parent role's parent accounts and `is_parent_of` (profiles.parent_id). It replaces 6-3 and is delivered with the Parent-role stories, not in this epic.
- Parent read access to `class_sessions` and `attendance_records` is added through the Parent role's per-table SELECT policies.
- Open item: the Tibetan translations of the calendar strings are still English copies.
