---
title: '7-4 Parent session leave: Coming / On leave, planned vs short-notice'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'dee1fd45a6a524088d766390c3152705fc9e2476'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to say a child will miss a session. Every missed session costs a streak grace week, and teachers can't see ahead of time who is coming.

**Approach:**
- An approved parent marks each upcoming session of a linked child Coming or On leave.
- The database classifies On leave as Planned when it is set at least the Leave Notice Period ahead, and Short-notice otherwise.
- Planned leave protects the streak week.
- The student sees the answer read-only.

## Boundaries & Constraints

**Always:**
- **Migration `0027_session_leave.sql`** (the latest is 0026):
  - **`session_starts_at(p_class_session_id)`** returns a `timestamptz`: `class_days.day` + (the session override, else the class default, else 00:00) interpreted in Europe/Berlin. It is the only place that computes a session's start.
  - **Setting:** seed `app_settings` key `leave_notice_weeks` with `{"weeks":2}`, following the `streak_grace_weeks` pattern.
  - **`session_leave_history` table:**
    - Columns: id, class_session_id (FK → `class_sessions` `ON DELETE CASCADE`), student_id, answer (`coming`/`on_leave`/`sick`), classification (`planned`/`short_notice`/null), answered_by, answered_at.
    - It is append-only; the current answer is the latest row per (session, student).
  - **BEFORE INSERT trigger:**
    - Stamps `answered_by = auth.uid()` and `answered_at = now()`.
    - Rejects the insert when the student is not enrolled in the session's class or the session is cancelled.
    - Enforces the cutoffs: `coming`/`on_leave` only before `session_starts_at`, and `sick` until the end of the day after the session (Berlin).
    - Sets `classification` from `classify_leave(session, now())`. Any classification the client supplies is overwritten.
  - **`classify_leave`:** `on_leave` set at or before `session_starts_at − notice` is `planned`, later is `short_notice`, and other answers get null.
  - **`preview_leave(p_class_session_id, p_student_id)`:** the caller must satisfy `is_parent_of`. It returns the same classification and is what the UI calls before saving.
  - **RLS:**
    - INSERT only with `is_parent_of(student_id)`.
    - SELECT for the student themselves, `is_parent_of`, a teacher of the class (`is_teacher_of_class`), or the admin.
    - No UPDATE or DELETE policies.
  - **Classmates and teammates:** one security-definer function, `session_leave_masked(p_class_session_id)`. It checks that the caller is enrolled in the class or is a teammate, returns (student_id, display name, answer) with `sick` shown as `on_leave`, and returns nothing to a caller who is only a parent.
  - **Streak:**
    - `compute_student_streak`, gap branch at `0021:414-420`: a session week that doesn't qualify counts as a holiday (no gap, no streak increment) when the student was present at no session that week and the latest answer for every marked session they missed that week is `on_leave` + `planned`.
    - Short-notice leave, a `coming` answer followed by an absence, no answer, and `sick` (still pending until 7-5) each use up a grace week, as they do today.
    - An AFTER INSERT trigger on `session_leave_history` calls `recompute_student_streak(student_id)`. The streak is still calculated only there.
  - **Functions:** all new ones are security definer with `search_path = ''`, revoke EXECUTE from public/anon, and grant it explicitly.
- **Frozen classification:** the classification is fixed at insert. Changing the notice setting or moving a session does not reclassify existing answers.
- **Admin setting:** the Leave Notice Period lives in the database only (no admin UI), like the streak grace period.
- **i18n:** every new string exists in en, de and bo. Copy is terse, with no exclamation marks.
- **Decision 1 — parent page:** a new `/parent/children/[id]` page.
  - Guarded by `is_parent_of`; any other child → 404.
  - Lists the child's non-cancelled sessions from now through the next 12 weeks (date, class, start time, duration).
  - Each session shows its current answer ("Not answered" by default) and Coming / On leave controls while the session hasn't started.
  - Choosing On leave shows the `preview_leave` result (Planned or Short-notice) before the parent confirms.
  - Each approved child's card on `/parent` links to the page; pending children stay unlinked.
- **Decision 2 — student view:** on `/calendar`, a student's own sessions show their current answer ("Coming" or "On leave") read-only. Sick shows as "Sick" to the student.
- **Decision 3 — teacher view:** the teacher's attendance picker in `teacher/classes/[id]` shows each student's current answer for the selected session next to the checkbox. `session_leave_masked` is built and tested, but no classmate or team screen uses it yet (deferred).
- **Decision 4 — no Sick button:** the parent UI offers only Coming and On leave. The database already accepts `sick`; the Sick option comes with 7-5.
- **Size:** the full spec was kept, not split.

**Never:**
- A student-side leave control.
- Leave written by anyone other than the parent.
- The client computing the classification or a cutoff.
- Collecting a reason.
- Sick approval or the auto-approval cron job (7-5).
- An admin settings UI.
- Date-range leave.
- Editing old migrations, or pushing to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Planned | parent sets On leave 15 days before start (notice 2 wk) | row `on_leave`/`planned`; preview said Planned | N/A |
| Short-notice | On leave 3 days before | `short_notice`; preview said Short-notice | N/A |
| Change | On leave then Coming before start | latest = `coming` | N/A |
| After start | Coming/On leave after `session_starts_at` | refused | trigger error → message |
| Sick cutoff | `sick` next day 23:00 Berlin / day+2 | accepted / refused | trigger error |
| Forged | client sends `classification='planned'` late | stored `short_notice` | N/A |
| Not parent | student, teacher, other parent, pending child's parent inserts | refused | RLS 42501 |
| Not enrolled / cancelled | session of another class, cancelled session | refused | trigger error |
| Read | student, own parent, class teacher, admin | rows; other student/parent → none | RLS |
| Masked | classmate calls `session_leave_masked` for a `sick` row | `on_leave`; parent-only caller → nothing | 42501 |
| Streak planned | absent week, planned leave, grace 0 | streak unbroken | N/A |
| Streak short | absent week, short-notice leave, grace 0 | streak resets | N/A |
| Regeneration | future session with leave removed by schedule change | leave rows deleted | N/A |
| Notice setting | `leave_notice_weeks` = 1 | 8 days ahead → planned | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0018_calendar.sql`:
  - `:20` wall-clock times; `:27` class default start time and duration; `:75-79` `class_days` (day, cancelled); `:113-126` `class_sessions`.
- `supabase/migrations/0019_class_schedules.sql:382-405` -- `class_sessions_effective` view (day, start_time, cancelled, extra). Reuse it for the session lists.
- `supabase/migrations/0026_schedule_interval.sql:103-145` -- `regenerate_class_sessions`, which deletes future sessions at `:114`. The leave FK must cascade from it; do not change it.
- `supabase/migrations/0021_attendance_per_session.sql`:
  - `:314-429` `compute_student_streak`; the gap branch at `:414-420` is the only place to change.
  - `:436` `recompute_student_streak`; `:466` `recompute_streaks_for_sessions`; `:509-612` the existing recompute triggers.
  - Redefine `compute_student_streak` in 0027 with `create or replace`.
- `supabase/migrations/0007_streaks.sql:63-69` -- `streak_grace_weeks` seed pattern.
- `supabase/migrations/0024_parent_first_registration.sql:264,293` -- `is_parent_of` and `linked_children` (the helper, revoke and grant pattern).
- `supabase/migrations/0025_parent_reads.sql:19,148,183` -- `is_parent_in_class`; parents already read `class_sessions`; `child_attendance` style.
- The inline Berlin-date pattern: `(now() at time zone 'Europe/Berlin')::date` (0021:124).
- `src/routes/parent/+page.server.ts:24-52`, `+page.svelte` -- the cards (add the link to the new page); `+layout.server.ts` is the guard to keep.
- `src/routes/calendar/+page.server.ts:43-117` (queries `class_sessions_effective` at `:71`, for all roles) and `+page.svelte` -- the student's read-only answer.
- `src/routes/teacher/classes/[id]/+page.server.ts:70-84`, `+page.svelte:142-163` -- the attendance session picker and checkboxes.
- `src/lib/berlin-date.ts:17` `todayInBerlin`.
- `src/lib/server/rls.spec.ts`:
  - `createApprovedParent` :510, `signUpStudent` :544.
  - The 6-2 block :6458 (`createStudent` 6539, `addDays` 6560, `sessionOf` 6574, teacher mark ~6602, `homeworkDone` ~6620, `readStreak` 6671).
  - 7-3 `createClass` :8022.
- `src/lib/supabase/database.types.ts:859` (Functions) and Tables -- add the new table and RPCs by hand (don't regenerate).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0027_session_leave.sql` -- the setting, table, triggers, `session_starts_at`, `classify_leave`, `preview_leave`, `session_leave_masked`, RLS, and the streak change.
- [x] `src/routes/parent/children/[id]/+page.server.ts`, `+page.svelte` (+ spec) -- sessions list; `preview` and `setLeave` actions insert the answer and map trigger or RLS errors to messages. `src/routes/parent/+page.svelte` -- card link.
- [x] `src/routes/calendar/+page.server.ts`, `+page.svelte` (+ spec) -- the student's own answer, read-only.
- [x] `src/routes/teacher/classes/[id]/+page.server.ts`, `+page.svelte` (+ spec) -- each student's answer next to the attendance checkbox.
- [x] `src/lib/server/rls.spec.ts` -- `describe('7-4 session leave')`, one test per matrix row. Put the time-sensitive rows (after start, sick cutoff) on sessions dated relative to today.
- [x] Loader and page specs for the touched routes; `messages/{en,de,bo}.json`; `database.types.ts`.

**Acceptance Criteria:**
- Given a parent on the leave page, when they choose On leave for a session 10 days away, then they see "Short-notice" before saving and the saved row matches.
- Given a dual-role teacher-parent, when they set leave for their own child, then it succeeds, and their teacher reads of the class are unchanged.
- Given a freshly reset local DB, when `npm test` and `npm run check` run, then all pass with 0 errors.

## Implementation Notes

- `session_starts_at` is security invoker (review fix), unlike the other new functions: a client gets the start only of a session its RLS lets it read. The definer trigger, `classify_leave` and `preview_leave` still read every session.
- The teacher loader reads `session_leave_history` in pages of 1000 (PostgREST max_rows) until a short page.
- `class_sessions_effective` gains an appended `starts_at` column (= `session_starts_at(id)`), so the parent page and any screen read the start instant from the database instead of computing it.
- The BEFORE INSERT trigger checks `is_parent_of(student_id)` first and raises 42501: a BEFORE trigger runs ahead of the RLS WITH CHECK, so without it a non-parent would get the trigger's enrolment/cutoff errors instead of 42501. The service role is not exempt (only the parent writes leave).
- Trigger refusals use errcode 22023 with a hint (`leave_not_enrolled`, `leave_cancelled`, `leave_started`, `leave_sick_closed`) that `src/lib/server/leave.ts` maps to messages.
- `id` is a bigint identity, used as the tie-break after `answered_at` for "latest row".
- `classify_leave(session, at)` returns the On leave classification; the trigger stores it only for `on_leave`. It is service-role only; clients use `preview_leave`.
- `session_leave_masked`: enrolled callers see every enrolled student's current answer; a student who is not enrolled sees only their teammates' rows (and needs at least one teammate in the class); everyone else gets 42501.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind, edge | Teacher leave answers are read only for markable sessions (today or earlier) | medium | patch | `teacher/classes/[id]/+page.server.ts` fetches every history row for up to 60 sessions × roster and dedupes in JS; `supabase/config.toml:18` `max_rows = 1000` silently truncates. Parent (one child, 12 weeks) and calendar (one student, one month) stay far below the cap. |
| 2 | vgap | Streak "every missed marked session is planned" not pinned: the test has one session per week | medium | patch | `bool_and`→`bool_or`, or dropping the `attendance_weeks` exclusion, still passes `rls.spec` "Streak planned / short". |
| 3 | vgap | Masked test can't observe the team filter or the non-enrolled gate | medium | patch | All 7-4 children share one team, and the only negative caller has no student profile; dropping either clause still passes. |
| 4 | blind, edge | `session_starts_at` is security definer: any signed-in user can read any session's start, and it isn't inlinable per view row | low | patch | A direct one-word correction: security invoker. Callers already see the row through the security-invoker view; the trigger and preview are definers. |
| 5 | blind, vgap | Parent preview → confirm flow has no browser or component test | medium | defer | The repo has no component-test setup (`vite.config.ts` server project only) and one calendar e2e; the data rules are tested server-side. |
| 6 | blind, edge | Teachers don't see answers for upcoming sessions, only in the attendance picker (today or earlier) | low | reject | Decision 3 puts answers in the attendance picker; on the class day, today's session is listed before it starts, so "before class" holds. Seeing further ahead needs a new view: raise it as a follow-up. |
| 7 | edge | Long `.in()` lists could exceed URL limits | low | reject | 60 sessions + a class roster ≈ 3–4 KB, well under the proxy limit at school scale. |
| 8 | blind | Current-answer dedup and labels are repeated in three loaders | low | reject | Refactor, not a direct correction; 7-5 can consolidate. |
| 9 | blind, edge | `preview_leave` doesn't check enrolment, cancellation or start | low | reject | The page only offers controls for open, non-cancelled sessions of the child's classes; reachable only by a start-time race, and the insert still refuses with a clear message. |
| 10 | blind, edge | A stale preview across the notice boundary saves a different classification without a warning | low | reject | Needs the parent to hold the preview open across the exact boundary instant; the fix adds UI branches. |
| 11 | blind, edge | The `leave_sick_closed` / P0002 hints are unmapped | false | reject | 7-4 has no Sick UI and no unknown-session path; that mapping belongs to 7-5. |
| 12 | blind | `open` compares the DB `starts_at` with the app server's clock | low | reject | Display only; the database enforces the cutoff. |
| 13 | blind | The streak trigger swallows recompute errors as a WARNING | false | reject | Repo convention: `0007_streaks.sql:272`, `0021:495,538`. |
| 14 | blind | Time-boundary edges (today's started session, exact notice instant) are untested | low | reject | The matrix rows are covered; the checks are date/instant comparisons in one function. |
| 15 | blind, edge | A `linked_children` error shows a 404; loader error branches untested | low | reject | Transient-only; the fix adds a branch (the same pattern as the 7-3 `/parent`). |
| 16 | blind, edge, vgap-other | Streak and time tests use near-today, real-date class days | low | reject | The spec requires time-sensitive rows relative to today; the suite passed on reset. |
| 17 | blind | The teacher pill hides Planned/Short-notice and shows nothing when there's no answer | low | reject | Matches decision 3 ("current answer"); cosmetic. |
| 18 | blind | The calendar leave text reuses the `extra-tag` class | low | reject | Cosmetic; the text is visible and read by screen readers. |
| 19 | blind | bo strings are English | false | reject | Project convention for bo (7-3 triage #19). |
| 20 | edge | A Sick answer can be replaced by Coming / On leave | false | reject | Nothing in the spec locks Sick; rejection finality is 7-5. |
| 21 | edge | A non-integer `leave_notice_weeks` breaks the cast | false | reject | DB-only setting seeded as a JSON number, the same as `streak_grace_weeks` (7-3 triage #8). |
| 22 | edge | Pre-enrolment marked sessions stop a week being protected | low | reject | Pre-existing session-week semantics (those weeks are already gaps); rare mid-week enrolment. |

## Design Notes

- **Leave and the streak rule:** a protected week behaves exactly like a holiday week. It neither extends the streak nor uses up grace, whatever the homework status, because the student was excused from the only thing that makes a week count. A student who attended another class that week goes through the normal qualification check.
- **The cascade matches AD-13:** regeneration only deletes future sessions that have no marks, so no attendance history is lost.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0027 applies cleanly.
- `npm test` -- expected: all pass (fresh DB).
- `npm run check` -- expected: 0 errors.
