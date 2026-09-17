---
title: 'Streaks'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3e936f290dd64a5a900082fd01993cad49db8728'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epics 2-3 already record attendance and homework-Done history, but nothing turns that into a visible sense of momentum for a student — there is no signal that shows up between Sundays to make a kid want to keep the habit going.

**Approach:** Add a trigger-written `student_streaks` table that recomputes a student's consecutive-week streak (attendance AND homework Done that week) whenever the two source history tables are written, governed by an admin-configurable grace period (default 2 missed weeks, `app_settings.streak_grace_weeks`), and surface the current count as a stat tile on the student's homework page.

## Boundaries & Constraints

**Always:** Recompute only inside a `SECURITY DEFINER` DB trigger firing `after insert` on `attendance_records` and on `homework_status_history` (AD-3) — never a client-invoked path; this is the first trigger-written derived table in the codebase, so author it fresh. Count distinct `(student_id, homework_instance_id)` pairs at `status='done'` and distinct `(student_id, session_date)` rows at `present=true` — never raw row counts, so a duplicate self+teacher mark can't double count. A "week" is the calendar week containing a plain `date` column already established by prior stories — `attendance_records.session_date` for attendance, `homework_instances.period_start` (joined via `homework_status_history.instance_id`) for homework — never `recorded_at`/timestamps, so no timezone conversion is needed to decide which week a row belongs to. Each trigger fire fully recomputes the student's streak from source history (walking backward from the most recent qualifying week), never advances an incremental counter — this codebase already supports backdated "catch-up" attendance inserts landing on their true session week (`0003_roster_skill_tracking.sql:64`'s documented intent), so an incremental model would silently miscount under a late-arriving backdated row; full recompute is correct under backfill and cheap at this app's data scale. Upsert via `ON CONFLICT (student_id) DO UPDATE`, mirroring the seed pattern's idempotency; a student's first-ever qualifying week produces `current_streak = 1`, not 0. Wrap the recompute body in an exception-isolated block (`BEGIN ... EXCEPTION WHEN OTHERS THEN ...`) inside the trigger function so a bug in this first-of-its-kind trigger can never block the underlying `attendance_records`/`homework_status_history` insert it fired on. Seed `streak_grace_weeks` into `app_settings` via `insert ... on conflict (key) do nothing`, mirroring `homework_lookahead_days` (`0004_homework.sql:103-109`) exactly. RLS on `student_streaks` follows the established three-way shape: `is_admin() or is_teacher_of_class(class_id) or student_id = auth.uid()`, same clause used on `homework_status_history` (`0004_homework.sql:257-263`) — a student's own streak is visible to themself and to any teacher/admin scoped to their class, matching attendance/skill-status visibility (**decision**, resolved 2026-09-17: not student-only). A week where zero `attendance_records` rows exist for the entire `class_id` (no session held that week, e.g. a holiday break) is excluded from grace consumption entirely, distinct from an individual student's own absence in a week the class did meet, which does consume grace (**decision**, resolved 2026-09-17).

**Never:** Do not build badges (Story 4-2) or the leaderboard (Story 4-3) — this story only produces the `student_streaks` value and its own display. Do not add a general admin settings-editing UI — `streak_grace_weeks` stays DB-only configuration, following `homework_lookahead_days`'s precedent (no admin screen exists for it either). Do not modify `attendance_records`/`homework_status_history` column shapes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student attends and marks homework Done in the same week | New `attendance_records` row (present=true) and a `homework_status_history` row (status='done') both land for that week | `student_streaks.current_streak` increments once both conditions are satisfied for that week | N/A |
| Only one of the two conditions lands for a week | e.g. homework marked Done, no attendance recorded yet | Streak does not increment for that week until the missing condition also lands | N/A |
| Student misses fewer weeks than the grace period | 1 week with neither condition met, `streak_grace_weeks = 2` | Streak is preserved, not reset | N/A |
| Student misses more weeks than the grace period | 3+ consecutive qualifying-free weeks, grace = 2 | Streak resets to 0 | N/A |
| Duplicate homework-done marks for the same instance | Self-mark + teacher on-behalf-of mark, same `(student_id, instance_id)` | Counted once; streak computation unaffected by the duplicate row | N/A |
| Admin changes `streak_grace_weeks` | Update to the `app_settings` row | Applies to future recomputes only; past streak state is not retroactively rewritten | N/A |
| Whole class has no session for a week (holiday) | Zero `attendance_records` rows exist for that `class_id` in that week | Week excluded from grace consumption for every student in the class — streaks unaffected | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0007_streaks.sql` (new) -- `student_streaks` table (`student_id` PK/FK -> profiles, `class_id`, `current_streak int`, `last_qualifying_week date`, `updated_at`); seed `streak_grace_weeks` into `app_settings` per `0004_homework.sql:103-109`'s exact pattern; `SECURITY DEFINER` recompute function + `after insert` triggers on `attendance_records` and `homework_status_history`; RLS mirroring `0004_homework.sql:257-263`'s three-way clause. First trigger-written derived table in this codebase -- no existing trigger precedent computes an aggregate (closest is `handle_new_user()`, `0001_init.sql:132-153`, a 1:1 insert trigger, not an aggregate).
- `attendance_records` (`0003_roster_skill_tracking.sql:52-72`) -- has `attendance_records_student_recorded_idx (student_id, recorded_at desc)` (`:66-67`), sorted by `recorded_at` not `session_date`; add a `(student_id, session_date)` index since the trigger buckets by `session_date`, not `recorded_at`. `homework_status_history` (`0004_homework.sql:71-91`) -- only indexed on `(instance_id, student_id)` (`:84-85`); add an index supporting a per-student join to `homework_instances.period_start` if the recompute query needs it.
- `src/routes/student/+page.server.ts:57-68` -- extend the existing `load` function with the same `app_settings`-read pattern already used for `homework_lookahead_days`, plus a `.from('student_streaks').select(...).eq('student_id', user.id).maybeSingle()` query; return the streak alongside existing `items`/`loadError`.
- `src/routes/student/+page.svelte` (97 lines) -- add a stat-tile block after the `<h1>` (line 22) using the design system's documented pattern (hairline-bordered tile, `.section-label` + large bold number, `src/app.css:166-173` and `:218-225`) -- no shared `StatTile` component exists yet (grep confirmed); author the markup inline or extract a small component if reuse across 4-2/4-3 makes that clearly worthwhile.
- `src/lib/server/rls.spec.ts` -- new `describe.skipIf(!reachable)('Story 4-1 streaks (requires local Supabase)', ...)` block after the Story 3-2 block (starts line 2442), following its exact setup shape (local `createStudent`/`createSignedInUser` helpers, assertions through role-appropriate clients, not just `adminClient`).
- `messages/{en,de,bo}.json` -- new keys for the streak stat-tile label and a zero/broken-streak empty state, following the existing terse, non-roadmap empty-state convention.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0007_streaks.sql` -- create `student_streaks`, seed `streak_grace_weeks`, write the recompute function + triggers + RLS -- per Code Map
- [x] `src/routes/student/+page.server.ts` -- load the student's streak alongside homework data
- [x] `src/routes/student/+page.svelte` -- render the streak as a stat tile
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- new Story 4-1 block covering every I/O matrix row

**Acceptance Criteria:**
- Given a student with attendance and homework Done both recorded for the current week, when the trigger fires on either insert, then their streak increments exactly once for that week regardless of mark order.
- Given a student who misses fewer weeks than `streak_grace_weeks`, when a later qualifying week lands, then their prior streak count is preserved, not reset.
- Given a student who misses more weeks than `streak_grace_weeks`, when the trigger next recomputes, then their streak resets to 0.
- Given a duplicate homework-done mark for an instance already marked done, when the trigger fires again, then the streak computation is unaffected by the duplicate.
- Given a week where the whole class has zero attendance rows (no session held), when the trigger recomputes any student's streak, then that week is excluded from grace consumption for every student in the class.
- Given a backdated attendance insert for a week behind the student's `last_qualifying_week`, when the trigger fires, then the full recompute reflects the corrected history rather than miscounting from a stale incremental state.

## Implementation Notes

Stat tile markup was authored inline in `src/routes/student/+page.svelte` rather than extracted into a shared `StatTile` component — no second consumer exists yet (Stories 4-2/4-3 aren't built), so extraction was deferred until reuse is real rather than speculative.

The recompute function walks backward from *today's* week rather than from `last_qualifying_week`, unifying "streak gone stale relative to today" and "internal gap" into a single gap counter. This reads the frozen Boundaries' "walking backward from the most recent qualifying week" language as describing the walk's direction and stopping condition, not literally requiring the walk to start there — starting from today is necessary to detect a streak that's gone stale with no new writes at all (which a walk starting from `last_qualifying_week` alone cannot do without also being triggered on a schedule). Verified correct against all 7 I/O-matrix rows and all 6 acceptance criteria by independent trace (see Review Triage Log's verification-gap pass).

## Spec Change Log

None yet.

## Review Triage Log

Reviewed by blind-hunter, edge-case-hunter, and verification-gap against the diff since `3e936f290dd64a5a900082fd01993cad49db8728`.

| # | Verdict | Route | Finding | Evidence |
|---|---------|-------|---------|----------|
| 1 | — | defer | `messages/bo.json`'s new streak keys are verbatim English, not Tibetan. | Verification-gap confirmed 0/289 string values in the entire file contain Tibetan script anywhere — pre-existing, codebase-wide, and already deferred once in Story 3-2's own review; not introduced by this diff. |
| 2 | — | defer | (carried, same defect as #1) Blind-hunter and edge-case-hunter independently flagged the same bo.json placeholder text. | Same evidence as #1. |
| 3 | low | patch | No index supports `class_session_weeks`'s `class_id`-scoped query in `recompute_student_streak()`. | Confirmed: migration adds `(student_id, session_date)` and `(student_id, status)` indexes but nothing on `class_id`. Harmless at this app's scale; one-line fix. |
| 4 | low | patch | `homework_status_history` trigger fires on every status insert (`assigned`/`reviewed`), not only `done`. | Confirmed no `WHEN` clause on `homework_status_history_recompute_streak`. Produces the same correct result, just wasted recompute work. |
| 5 | false | reject | `attendance_weeks`/`homework_weeks` aren't scoped by `class_id`, unlike `class_session_weeks` — risk of cross-class contamination if a student's class changes. | Verified: grepped every route in `src/routes` — none ever updates `profiles.class_id` after initial approval. The precondition this finding needs cannot occur in the current app. |
| 6 | — | (same as #5) | Edge-case-hunter's independent report of the same class_id-scoping gap. | Same refutation as #5. |
| 7 | — | (same as #5) | Edge-case-hunter's RLS-staleness variant: `student_streaks.class_id` has no set-once trigger like `team_id`, so stale RLS access could follow a class change. | Same refutation as #5 — the triggering precondition (a class_id change) is unreachable today. |
| 8 | low | patch | No test exercises the exact `streak_grace_weeks` boundary at the real default (2 consecutive misses preserved vs. 3 resets). | Algorithm already hand-traced and verified correct at this boundary by the prior verification pass; existing test only substitutes grace=4. Worth a direct regression test at the shipped default. |
| 9 | low | patch | `"{count} week(s)"` / `"{count} Woche(n)"` isn't proper ICU plural syntax, which Paraglide supports. | Confirmed in en/de/bo message additions. Cosmetic grammar issue, trivial fix. |
| 10 | low | patch | `## Implementation Notes` and this log were empty despite all tasks being checked off; the Code Map's open "inline vs. extracted component" question was never recorded. | Spec-doc hygiene gap, not application code — recorded directly in Implementation Notes below. |
| 11 | false | reject | `sprint-status.yaml` shows `4-1-streaks: in-progress` while the spec frontmatter shows `in-review`. | Expected: `sprint-status.yaml` is only synced to `in-progress` once, at step-03; it isn't kept live in sync with every subsequent spec-status transition and is refreshed later by `bmad-sprint-planning`. Same out-of-scope note Story 3-2's own review logged for this exact pattern. |
| 12 | low | patch | No regression test confirms a `done → reviewed` transition leaves the streak computation unaffected. | The `status='done'` filter already structurally excludes `reviewed` rows by construction (verified correct); still worth explicit coverage. |
| 13 | low | reject | Same empty-state copy for "never had a streak" and "streak just broke." | Both states truthfully describe "no current streak." A real distinction needs new, motivationally-different copy across 3 locales — more than a trivial fix — for a narrow benefit to this small audience. |
| 14 | low | patch | Stat tile uses ad hoc inline `style="..."` instead of the shared `.card`/`.section-label` classes the rest of the app uses. | Confirmed in `+page.svelte`. DESIGN.md documents the stat-tile pattern explicitly; worth conforming now since Stories 4-2/4-3 will need the same tile. |
| 15 | medium | patch | Streak stat tile has no `aria-label`/screen-reader text — a bare number conveys nothing to assistive tech. | WCAG 2.2 AA is an explicit **Always** boundary in this spec's frozen block, not just a preference; this is a real gap against a stated requirement. |
| 16 | low | patch | "Today's week" cursor uses Postgres `current_date` without pinning a timezone. | Real but narrow midnight-boundary edge case for a Munich-timezone school; trivial to pin explicitly (e.g. `(now() at time zone 'utc')::date`). |
| 17 | medium | patch | A failed `student_streaks` fetch (`streakError`) renders the same UI as a truthful zero-streak empty state. | Confirmed in `+page.svelte`: the template branches only on `data.streak`/`currentStreak`, never on `data.loadError`. Masks a real error as a false "no streak" state — the exact class of silent-failure bug this codebase has flagged before (e.g. Story 3-2's pause/end-series review findings). |
| 18 | false | reject | Editing a recurring assignment's `period_start` after `done` rows exist could silently reshuffle which week a past completion counts toward, with no trigger to recompute. | Refuted by Story 3-2's own established, frozen invariant: "editing a series never UPDATEs `homework_instances`" — `period_start` is architecturally immutable after creation, so this UPDATE path cannot occur. |
| 19 | low | patch | `streak_grace_weeks` isn't guarded against a negative value, which would make any single miss reset every streak. | Only reachable via direct DB edit (no admin UI exists for this setting, by design). Guard is a trivial one-liner regardless. |
| 20 | low | patch | The 520-week (`max_weeks_back`) safety backstop could silently cap a genuinely longer, uninterrupted streak. | Practically unreachable for this app's real usage (~10 years of unbroken weekly attendance); bumping the constant is free, so fixed anyway. |
| 21 | medium | patch | No test exists for the `+page.server.ts`/`+page.svelte` streak read-and-render path — only the DB layer is tested. | Verification-gap demonstrated a concrete failure mode: a column-name typo or an inverted `currentStreak > 0` branch would silently show every student a false "no streak" state, and no existing test would catch it. Disposition follows this codebase's own precedent (`homework-status.ts`/`.spec.ts`): extract a DB-free shaping helper and unit-test it. |

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including the new live-Supabase RLS cases (requires `npm run supabase:start` first)
