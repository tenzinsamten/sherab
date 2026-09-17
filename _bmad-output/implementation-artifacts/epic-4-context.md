# Epic 4 Context: Gamification

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic closes the motivation loop the app promises students: it turns the attendance and homework data teachers and students already record (Epics 2-3) into a per-student streak, milestone badges, and a team leaderboard, so a kid has a simple, visible way to see their own progress and stay engaged between Sunday sessions. It matters because streaks and badges are meant to reward *consistency*, not compare students to each other — nothing here should read as ranking one child against another — while the leaderboard gives a lightweight, team-based sense of shared progress without ever exposing any student's data outside the school.

## Stories

- Story 4-1: Streaks
- Story 4-2: Badges
- Story 4-3: Team leaderboard

## Requirements & Constraints

- A streak counts consecutive weeks where a student has **both** attendance and homework marked Done in that week (homework Reviewed is not required). It survives up to an admin-configurable number of missed weeks (default 2) before resetting; that grace value must be changeable without a code change.
- Badges are awarded at configurable milestone increments of two independent counts: total attendance and total homework-Done. The exact step size (every 5 vs. every 10) is an open question left unresolved upstream — implement it as a configurable value, not a hardcoded one, so the answer can land later without a migration.
- Badges are visible only on the student's own profile and are never used to rank or compare students against each other.
- The leaderboard ranks fixed-for-the-year teams (not individuals) by a combined-streak metric. Team membership is manually assigned by a teacher at approval time (including mid-year joins) — there is no auto-balancing, randomization, or reassignment logic to build here.
- The leaderboard and badges are visible only within the school context; nothing produced by this epic is public-facing.
- Any derived count (streak length, milestone crossing) must count distinct instances of "reached Done," never raw history-row counts — a student's self-mark and a teacher's on-behalf-of mark for the same homework instance are two history rows but one logical completion, and must not double-count.
- No visual/UX design exists yet for the streak indicator, badge iconography, or leaderboard list. Ship functional-first: a plain number/indicator for streaks, placeholder icons/labels for badges, a simple ranked list for the leaderboard. Flag any real design decision instead of guessing one.
- Must support German/English/Tibetan UI via Paraglide (no inline copy strings) and meet the WCAG 2.2 AA accessibility floor already established for the app.

## Technical Decisions

- Per the architecture's function-sidecar lane, `student_streaks` and `badges_earned` are trigger-written derived tables only — the client never inserts or updates them directly. Triggers fire on the write to the underlying source tables (`attendance_records`, `homework_status_history`) so recompute/award happens unconditionally, regardless of client behavior.
- Streak/badge computation reads two existing append-only tables: `attendance_records` (`student_id`, `class_id`, `present`, `session_date`) from Epic 2, and `homework_status_history` (`instance_id`, `student_id`, `status` in `assigned`/`done`/`reviewed`, `recorded_at`) from Epic 3. A "done" week/count must be derived from distinct `(student_id, homework_instance_id)` pairs that reached `status = 'done'`, not a raw row count, since the same pair can legitimately appear twice (student self-mark + teacher on-behalf-of mark).
- The streak grace period and badge milestone step belong in the existing `app_settings` key/value table (readable by any authenticated user, writable only by admin), following the exact precedent set by `homework_lookahead_days` in `supabase/migrations/0004_homework.sql` (seeded via `insert ... on conflict (key) do nothing` so it stays idempotent across resets). Use similarly named keys, e.g. `streak_grace_weeks` and `badge_milestone_step`.
- The leaderboard's rank is deliberately **not** a stored or derived column — it's a read-time aggregate (`SUM` of `student_streaks` per team via `profiles.team_id`). This avoids needing to keep a materialized sum in sync when a student's streak changes or a student leaves.
- Team assignment plumbing already exists and does not need to be (re)built by Story 4-3: the `teams` table (`id`, `name`) was created in `supabase/migrations/0002_student_registration.sql`; `profiles.team_id` is FK'd to it and enforced set-once-from-`NULL` by the `profiles_team_id_set_once` trigger; and the teacher/admin team-picker at approval time is already live (`src/routes/requests/+page.server.ts` and `+page.svelte` populate a team `<select>` from `teams`), plus an admin team-management screen at `src/routes/admin/teams`. This resolves the open question carried in the story notes about whether a prerequisite `teams` table needed to be scoped in — it was already built in Story 1-2. Story 4-3's actual scope is the ranking read and its display, not assignment.
- RLS for the two new derived tables should follow the app's established shape rather than a new pattern: `badges_earned` reads should be scoped to the student's own row (consistent with "visible only on the student's own profile," never a broad any-authenticated-reads-any-student policy). Exposing enough of `student_streaks` for the leaderboard's per-team aggregate without leaking individual students' streak values more broadly than intended is an open design point for the story — a `SECURITY DEFINER` function returning only the aggregate (mirroring the existing `is_targeted_for_homework_instance`/`validate_class_code` pattern used elsewhere for exactly this kind of cross-table read) is a reasonable shape to consider.
- Conventions carried over unchanged: `snake_case` DB tables/columns, kebab-case routes, `PascalCase` Svelte components, UUID PKs, `timestamptz` UTC timestamps, ISO 8601 dates, admin-tunable values live in `app_settings` rather than as hardcoded constants.

## UX & Interaction Patterns

- No screen design exists yet for the streak indicator, badge display, or leaderboard — the stories explicitly accept a plain number/indicator for streaks, placeholder icons/labels for badges, and a simple ranked list for the leaderboard as sufficient for this pass. Flag any real design decision rather than inventing one.
- Where the existing visual system already gives an applicable pattern, extend it: the stat-tile component (hairline-bordered tile, small uppercase label over a large bold number) is a natural fit for a streak count or a team's leaderboard rank number, consistent with how numeric facts are already presented elsewhere in the app.
- Terse, instructive microcopy, no exclamation points or emoji — a zero/broken streak or an empty "no badges yet" state should describe the student's actual situation, not roadmap language, matching the empty-state convention already established.
- The color system reserves amber for "waiting on a person" and red for field-validation only; a "streak broken" or "team behind" state should not default to either without a real design decision.

## Cross-Story Dependencies

- Story 4-1 (streaks) is the sole source of the combined-streak metric Story 4-3's leaderboard ranks by — the leaderboard cannot be meaningfully built or tested before streak values exist.
- Story 4-1 and Story 4-2 both derive from the same two source tables (`attendance_records`, `homework_status_history`) and must apply the same distinct-pair counting rule; avoid reimplementing that counting logic twice.
- Story 4-3 depends on Story 1-2's already-existing team assignment mechanism (`teams` table, set-once `team_id`, approval-time picker) — it adds a ranking read on top, not new assignment plumbing.
- All three stories depend on Epic 1's `profiles`/`class_teachers` identity model and the approved-student gating pattern (`role = 'student' and status = 'approved'`) to scope who counts toward a streak, a badge, or a team's leaderboard total.
- All three stories depend on Epic 2 (`attendance_records`) and Epic 3 (`homework_status_history`) for correct underlying data; neither epic implements any of this epic's derived computation itself.
