---
title: 'Badges'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '533c1571338c2de89c9ecf569ce727a73e0d980d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Streaks (Story 4-1) reward weekly consistency, but nothing gives a student a permanent, milestone-based marker of cumulative effort — a kid who has put in real total attendance or homework work has no lasting record of it.

**Approach:** Add a trigger-written `badges_earned` table that awards a badge whenever a student's lifetime attendance count or lifetime homework-done count crosses a configurable milestone threshold (`app_settings.badge_milestone_thresholds`), visible only to the student themself, displayed as a simple list on their homework page.

## Boundaries & Constraints

**Always:** Recompute only inside `SECURITY DEFINER` triggers, `AFTER INSERT` on `attendance_records` (`WHEN (new.present = true)`) and `homework_status_history` (`WHEN (new.status = 'done')`) — the same AD-3 trigger-ownership and exception-isolation pattern (`BEGIN ... EXCEPTION WHEN OTHERS THEN ...`) as `student_streaks` (`0007_streaks.sql`), applying that story's own review finding proactively: narrow `WHEN` clauses from the start, not added later as a patch. Count `count(distinct session_date)` for attendance and `count(distinct instance_id)` for homework-done — never raw row counts, since Story 4-1's review confirmed `attendance_records` has no uniqueness constraint on `(student_id, session_date)` (duplicate marks are possible) and `homework_status_history` can carry duplicate self+teacher `done` marks for the same instance. Each trigger fire recomputes the student's lifetime total from scratch and inserts any newly-crossed milestone rows up to that total, idempotent via `ON CONFLICT (student_id, badge_type, milestone) DO NOTHING` — a student with substantial pre-existing history gets every already-crossed milestone in one catch-up recompute the next time any qualifying row lands for them, so no separate backfill migration is needed (same reasoning as 4-1's full-recompute design). Milestones are a curated, ascending list, not a uniform step — `badge_milestone_thresholds`, a single admin-configurable `app_settings` JSON array applying to both counts, defaulting to `[1, 5, 10, 25, 50, 100]` (**decision**, resolved 2026-09-17: widening gaps as the count grows, not linear spacing), seeded via the established `insert ... on conflict (key) do nothing` pattern (`0004_homework.sql:103-109`, `0007_streaks.sql`'s `streak_grace_weeks` seed). The recompute function iterates this fixed small array (never a modulo/multiples calculation) and inserts every threshold `<=` the current total not already present. RLS is `is_admin() or student_id = auth.uid()` only — no teacher access, per the spec's explicit "visible only on the student's own profile" wording (unlike streaks' three-way pattern including `is_teacher_of_class`). A `badges_earned` row is never updated or deleted once inserted. Display lives on the student's own `/student` page, a simple list of earned badges (type + milestone number), reusing `.card`/`.section-label`; no new icon system — placeholder text, per epic-4-context's "ship functional-first" instruction.

**Never:** Do not build the leaderboard (Story 4-3) or touch `student_streaks` (Story 4-1, done). Do not rank or compare students' badges against each other, or expose one student's badges to another. Do not add an admin settings-editing UI for `badge_milestone_thresholds` — DB-only configuration, same precedent as `streak_grace_weeks`/`homework_lookahead_days`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student's attendance count crosses a configured milestone | Distinct attendance count reaches one of `badge_milestone_thresholds` (e.g. 5) | New `badges_earned` row inserted for that milestone (`badge_type='attendance'`) | N/A |
| Student's homework-done count crosses a configured milestone | Distinct homework-done count reaches one of `badge_milestone_thresholds` | New `badges_earned` row inserted (`badge_type='homework'`) | N/A |
| Attendance marked absent | `attendance_records` insert with `present = false` | Trigger does not fire (`WHEN` clause); no recompute, no new badge | N/A |
| Duplicate attendance mark for the same session_date | Two `attendance_records` rows, same `(student_id, session_date)` | Counted once toward the milestone total | N/A |
| Duplicate homework-done mark for the same instance | Self-mark + teacher on-behalf-of mark | Counted once | N/A |
| First qualifying write for a student with substantial pre-existing history | e.g. 12 pre-existing distinct attendances, thresholds `[1,5,10,25,50,100]`, a new attendance insert brings the total to 13 | The 1st, 5th, and 10th milestone badges are all inserted in the same recompute (catch-up), not just the newest crossing | N/A |
| Recompute fires again with the total unchanged or already past a milestone | e.g. a homework-done insert when attendance total hasn't changed | `ON CONFLICT DO NOTHING` — no duplicate badge row, no error | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0008_badges.sql` (new) -- `badges_earned` table (`id` PK, `student_id` FK -> profiles, `badge_type text check (badge_type in ('attendance','homework'))`, `milestone int`, `earned_at timestamptz`, `unique (student_id, badge_type, milestone)`); seed `badge_milestone_thresholds` (`'[1,5,10,25,50,100]'::jsonb`) into `app_settings` per `0004_homework.sql:103-109`'s exact pattern; `SECURITY DEFINER` recompute function (lifetime `count(distinct ...)`, not the weekly `array_agg` machinery `recompute_student_streak` uses -- that part is streak-specific; iterate the threshold array via `jsonb_array_elements_text` and insert each one `<=` the current total) + two `AFTER INSERT ... WHEN (...)` triggers; RLS `is_admin() or student_id = auth.uid()` (no existing table in this codebase omits teacher access this way -- nearest structural precedent is `profiles_select_own`/`profiles_select_admin` as two separate policies, `0001_init.sql:171-177`, functionally OR'd the same way).
- `attendance_records` (`0003_roster_skill_tracking.sql:52-72`, indexed `(student_id, session_date)` since `0007_streaks.sql:85-89`) -- no unique constraint on `(student_id, session_date)`, confirmed duplicates possible; `homework_status_history` (`0004_homework.sql:71-91`) -- read-only sources, same dedup discipline as `recompute_student_streak`'s `distinct instance_id` subquery (`0007_streaks.sql:183-194`).
- `src/lib/server/badges.ts` (new) -- `shapeStudentBadges(rows)` mirroring `src/lib/server/streak.ts`'s exact shape (snake_case `Row` type, camelCase view-model type, pure function, `null`/empty handled explicitly, not conflated with a load error). `src/lib/server/badges.spec.ts` (new) -- same three-case shape as `streak.spec.ts` (empty list, populated list, mapping assertion).
- `src/routes/student/+page.server.ts:165-183` -- add a `badges_earned` read (`.eq('student_id', user.id)`, plain select since it's a list not `.maybeSingle()`) right after the existing streak block, shape via `shapeStudentBadges`, fold its error into the existing `loadError` OR-chain (currently line 182), add `badges` to the returned object.
- `src/routes/student/+page.svelte:24-42` -- add a sibling `<div class="card">` block after the existing streak card (before line 44), same loadError/data-present/empty-state three-way branch shape; list earned badges as plain text/number entries (e.g. "Attendance x5"), reusing `.card`/`.section-label` for the container -- no new icon system, per Boundaries.
- `src/lib/server/rls.spec.ts` -- new `describe.skipIf(!reachable)('Story 4-2 badges (requires local Supabase)', ...)` block after the Story 4-1 block, following its exact setup shape.
- `messages/{en,de,bo}.json` -- new keys for the badges section label, a badge entry label, and an empty state, following the existing terse, non-roadmap empty-state convention.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0008_badges.sql` -- create `badges_earned`, seed `badge_milestone_thresholds`, write the recompute function + triggers + RLS -- per Code Map
- [x] `src/lib/server/badges.ts` + `badges.spec.ts` -- row-shaping helper and unit tests, mirroring `streak.ts`
- [x] `src/routes/student/+page.server.ts` -- load the student's earned badges alongside streak/homework data
- [x] `src/routes/student/+page.svelte` -- render earned badges as a list
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- new Story 4-2 block covering every I/O matrix row

**Acceptance Criteria:**
- Given a student whose distinct attendance count reaches exactly one configured threshold (e.g. 1), when the trigger fires, then exactly one new `attendance` badge row is inserted for that milestone.
- Given a student with pre-existing history spanning multiple uncrossed milestones, when the first qualifying write after this migration lands, then every already-crossed milestone is inserted in that single recompute.
- Given a duplicate homework-done mark for an instance already marked done, when the trigger fires again, then no duplicate badge row is inserted and no error occurs.
- Given another student or a teacher querying `badges_earned` for a student they are not, when they read via RLS, then no rows are returned (admin excepted).

## Implementation Notes

## Spec Change Log

None yet.

## Review Triage Log

Reviewed by blind-hunter, edge-case-hunter, and verification-gap against the diff since `533c1571338c2de89c9ecf569ce727a73e0d980d`.

| # | Verdict | Route | Finding | Evidence |
|---|---------|-------|---------|----------|
| 1 | low | patch | Verification-gap: frozen Intent's Approach line referred to `app_settings.badge_milestone_step`, a leftover from an earlier draft before the design changed to a curated array. | Confirmed and fixed directly in the spec doc (not application code) -- both occurrences ("Approach" and "Never") now read `badge_milestone_thresholds`, matching the Boundaries decision, Code Map, and the actual migration. |
| 2 | — | (same as #1) | Blind-hunter's independent report of the same stale `badge_milestone_step` reference in the Approach line. | Same fix as #1. |
| 3 | — | (same as #1) | Blind-hunter's independent report of the same stale name in the "Never" bullet. | Same fix as #1. |
| 4 | — | (same as #1) | Edge-case-hunter's independent report (as a `claim`) of the same doc/code name mismatch. | Same fix as #1. |
| 5 | low | reject | `+page.svelte` shows `m.load_error_generic()` in the streak card, the new badges card, and the bottom banner when `data.loadError` is true -- redundant messaging. | Matches Story 4-1's own already-approved per-card error pattern exactly (each card independently reflects load failure); not a new or worse defect introduced by this diff. |
| 6 | low | patch | The `badges_earned` select in `+page.server.ts` has no `.order(...)` clause, so the rendered list has no stable order. | Confirmed: `items` is explicitly `.sort()`-ed by due date but badges isn't; the new "catch up" test even manually `.sort()`s before asserting, implicitly acknowledging the gap. |
| 7 | — | (same as #6) | Edge-case-hunter's independent report of the same missing-order gap. | Same evidence as #6. |
| 8 | low | patch | The direct-write-rejection test only tries `teacherA.client` and `admin.client`, never a self-insert attempt by the student -- the actual abuse case ("no INSERT policy for anyone") the boundary is meant to prevent. | Real test-coverage gap; not a live vulnerability since RLS has zero INSERT policies for any role on `badges_earned` (confirmed in the prior verification pass), so this is default-deny by construction already -- still worth a regression test. |
| 9 | low | patch | `readBadges()`'s test helper only selects `badge_type, milestone`; no test asserts `earned_at` is populated/sane after a trigger fires. | Confirmed in `rls.spec.ts`. Trivial to broaden. |
| 10 | low | patch | No test exercises an admin-edited `badge_milestone_thresholds` value -- every test relies on the seeded default. | The migration's own design explicitly anticipates "a later admin change to the array takes effect on the next qualifying write," but nothing tests that path (Story 4-1 has an analogous test for `streak_grace_weeks` changes; badges doesn't yet). |
| 11 | low | patch | `shapeStudentBadges` silently coalesces any non-`'homework'` `badge_type` value to `'attendance'` rather than surfacing it. | Confirmed in `src/lib/server/badges.ts`. Practically unreachable today (the DB `check (badge_type in ('attendance','homework'))` constraint prevents any other value from ever existing), but defensive hygiene is cheap and consistent with this codebase's "flag, don't fabricate" instinct. |
| 12 | — | (same as #11) | Edge-case-hunter's independent report of the same silent-coalesce concern. | Same evidence as #11. |
| 13 | false | reject | `sprint-status.yaml` shows `4-2-badges: in-progress` while the spec frontmatter shows `in-review` with every task checked. | Expected: same artifact-lag pattern already logged and accepted in Story 4-1's own review (finding #11 there) -- `sprint-status.yaml` isn't kept live in sync with every spec-status transition. |
| 14 | low | patch | The migration's comment claims "same reasoning as 4-1's full-recompute design" without restating the specific trade-off (correct under backfill, cheap at this app's scale) the way Story 4-1's own spec did. | Documentation completeness nit; one clarifying sentence closes it. |
| 15 | false | reject | Two concurrent qualifying inserts for the same student in separate transactions, each below a threshold alone, could combine to cross a milestone that never gets awarded. | Self-healing: the very next attendance/homework write for that student re-fires a full recompute (same catch-up mechanism already proven for pre-existing history), so any transient miss resolves itself. Vanishingly unlikely at this app's actual usage pattern (one teacher marking a small class, not high-concurrency writes), and the suggested fix (advisory locking) is more than trivial. |
| 16 | false | reject | An element in `badge_milestone_thresholds` that fails an `::integer` cast could abort the whole per-threshold loop, rolling back badges already inserted earlier in that same call. | Already covered by the existing outer `BEGIN...EXCEPTION WHEN OTHERS` at the trigger level (mirrors `student_streaks`): the worst case is a stale `badges_earned` row plus a logged warning, the exact documented failure mode this pattern was built for -- not an unhandled crash. |
| 17 | low | patch | `badge_milestone_thresholds` set to a valid but empty array `[]` would mean no badge is ever awarded to any student. | Only reachable via direct DB edit (no admin UI exists for this setting, by design) -- same reachability caveat as Story 4-1's negative-grace-value finding, which was patched anyway since the fix is trivial. |
| 18 | false | reject | The trigger's `TG_TABLE_NAME` dispatch has no `else raise exception` branch for a table other than the two intended ones. | No third table is attached to this trigger anywhere in the codebase, and none is planned -- the triggering precondition doesn't exist today, same reasoning as Story 4-1's unreachable cross-class findings. |
| 19 | false | reject | A `homework_status_history` row could reach `'reviewed'` without ever passing through `'done'`, so that completion would never count toward a badge. | Refuted by `0004_homework.sql:322-328`'s own RLS insert policy, which requires a prior `'done'` row for the same `(instance, student)` pair before a `'reviewed'` insert is permitted at all -- the precondition is structurally impossible in this codebase. |

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including the new live-Supabase RLS cases (requires `npm run supabase:start` first)
