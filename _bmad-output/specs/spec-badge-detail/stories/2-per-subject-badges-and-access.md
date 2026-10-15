---
title: 'Per-subject badges and access'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'a22a3a17d148b4f466787ac2a466d773499c5d72'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-badge-detail/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-badge-detail/badge-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student's badges are one lifetime count across all classes, so they cannot say "10 dance classes" vs "10 language classes", and teachers cannot read a student's badges at all.

**Approach:** Badges carry the class's badge subject (story 1) and are counted and awarded per subject: attendance from sessions of that subject's classes, homework Done from that subject's classes. Existing subject-less badge rows are discarded. When the admin assigns or changes a class's subject, the affected students are recomputed so their history counts. Teachers of the student's classes can read the badges; students, linked parents and admin keep their access.

## Boundaries & Constraints

**Always:** Badges stay trigger-written only (AD-3, SECURITY DEFINER recompute; no client write policy). Full recompute, never an incremental counter. Earned badges are never deleted except the one-time discard of subject-less rows in this migration. Classes with no subject count toward nothing. Milestones still come from `app_settings.badge_milestone_thresholds`. A recompute failure never blocks the attendance/homework/class write that fired it (existing exception-isolated trigger shape). Visibility enforced in RLS. Add new columns to `database.types.ts` by hand.

**Never:** No new badge UI, icons, detail, progress or badge page (stories 3–5) beyond keeping today's Badges tile correct with subjects. No ranking or leaderboard change. No migration of old badge history.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Per-subject attendance | student present on 10 dance-class days, 3 language-class days | dance attendance 1, 5, 10 and language attendance 1 earned; no subject-less rows | N/A |
| Song counts as dance | song class and dance class both have subject `dance` | their present days add into one dance count; a day present in both counts once (distinct days per subject) | N/A |
| Per-subject homework | 5 Done instances in a language class | language homework 1, 5; dance unaffected | N/A |
| Unset class | present in a class with NULL subject | no badge for that class's sessions | N/A |
| Subject assigned later | class unset, student already has 5 present days; admin sets `dance` | student earns dance attendance 1 and 5 at that moment | recompute failure logs a warning, subject save still succeeds |
| Subject changed | class `dance` → `language` after badges were earned | dance badges stay; language badges recomputed from the history | N/A |
| Teacher read | teacher of any of the student's classes | can select the student's badge rows | N/A |
| Other reads | teacher not teaching the student; another student; another student's parent | sees no rows | RLS returns empty |

**Decision (human):** attendance counts distinct present days per subject: a Sunday present in both a song and a dance class is 1 dance attendance; language and dance on the same Sunday give 1 each.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0048_badges_per_subject.sql` -- new. `delete from badges_earned`; add `badge_subject text not null` with check on the 3 values; replace unique `(student_id, badge_type, milestone)` with `(student_id, badge_subject, badge_type, milestone)`. Redefine `recompute_student_badges(p_student_id, p_badge_type)` (latest body in `0045_attendance_current.sql:255`) to loop over subjects: attendance counts from `attendance_current` → `class_sessions.class_id` → `classes.badge_subject`; homework from `homework_status_history` → `homework_instances.class_id` → `classes.badge_subject`. Keep signature so existing triggers (`0008_badges.sql:223-231`) keep working. New AFTER UPDATE OF badge_subject trigger on `classes` (when new subject not null and changed) recomputing both types for every student with an enrollment, attendance or homework history in that class, exception-isolated like `trg_recompute_student_badges`. `alter policy "badges_earned_select_admin_or_own"` (latest in `0025_parent_reads.sql:122`) adding `or public.is_teacher_of_student(student_id)` (`0016_class_enrollments.sql:64`).
- `src/lib/supabase/database.types.ts` -- `badges_earned` Row/Insert/Update gain `badge_subject`.
- `src/lib/server/badges.ts` -- `StudentBadge`/`StudentBadgeRow` gain `subject: BadgeSubject` (use `isBadgeSubject` from `src/lib/badge-subject.ts`; throw on unknown, like the existing badge_type guard).
- `src/routes/student/+page.server.ts:74` and `src/routes/parent/children/[id]/+page.server.ts:329` -- select `badge_subject`, order by subject, type, milestone.
- `src/lib/components/StudentProgressTiles.svelte` -- each key becomes `${subject}-${type}-${milestone}` (duplicate keys would crash once two subjects share a milestone); pill label prefixed with `badgeSubjectLabel(subject)`, interim until story 3.
- Tests: `src/lib/server/badges.spec.ts`, `src/routes/student/page.server.spec.ts`, `src/routes/parent/children/[id]/page.server.spec.ts` (fixtures gain `badge_subject`); `src/lib/server/rls.spec.ts` for the DB rows of the matrix.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0048_badges_per_subject.sql` -- column, unique, recompute per subject, class-subject trigger, teacher read -- matrix rows 1–8
- [x] `src/lib/supabase/database.types.ts` -- add `badge_subject` -- types are hand-maintained
- [x] `src/lib/server/badges.ts` -- carry subject -- view model
- [x] `src/routes/student/+page.server.ts`, `src/routes/parent/children/[id]/+page.server.ts` -- select/order subject -- feed the tile
- [x] `src/lib/components/StudentProgressTiles.svelte` -- subject in key and label -- no duplicate keys
- [x] `src/lib/server/rls.spec.ts` -- one test per matrix row against local Supabase -- regression cover
- [x] unit specs above -- fixtures and shaping with subject -- keep green

**Acceptance Criteria:**
- Given a reset DB, when 0048 applies, then `badges_earned` has no rows and every new row has a subject.
- Given a client session, when it inserts into `badges_earned`, then RLS rejects it.
- Given a student with dance and language badges at the same milestone, when /student renders, then both pills show without a duplicate-key error.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind, edge-case, verification-gap | 0048 wipes badges with no recompute; classes given a subject via 0047 first leave students badge-less | medium | Confirmed: 0048 only recomputes on later events; 0047 is committed and the human was told to assign subjects. patch (one-time recompute) |
| 2 | edge-case | Union student query sits outside the EXCEPTION block; a failure aborts the class save | low | Contradicts the spec's never-blocks rule; one outer BEGIN/EXCEPTION. patch |
| 3 | edge-case | Statement timeout on a large class rolls back the save (query_canceled not caught) | low | School classes are small; needs a queue to fix; rejected |
| 4 | blind | e2e fixture classes have no subject, so help-screenshot Badges tile is empty | medium | e2e/fixtures.ts:185,209 create classes without badge_subject. patch |
| 5 | blind | Tile label `subject: entry` concatenated outside paraglide | low | Interim label replaced in story 3; rejected |
| 6 | blind | BadgeSubject type defined in database.types, badge-subject.ts and rls.spec | low | Drift only if a subject is added; rejected |
| 7 | blind | No tests for subject→NULL, same-subject update, exception path | low | WHEN clause is direct; exception path hard to force; rejected |
| 8 | blind | 0008 comment still says no teacher access | low | 0048 header documents the change; rejected |
| 9 | blind | is_teacher_of_student checks current enrollment only | false | Intent: teachers of the student's classes = current classes; same rule as student_streaks (0025:112) |
| 10 | blind | "song" test creates two dance classes | low | Song is a labelling rule with no data distinction; rejected |
| 11 | blind, verification-gap | Subject order is raw English key; ordering untested | low | Interim display; story 3 defines order; rejected |
| 12 | blind | Subject-change trigger cost unmeasured | low | Tiny data scale; rejected |
| 13 | blind | No test that two subjects can share (type, milestone) | false | rls.spec per-subject attendance test asserts dance-attendance-001 and language-attendance-001 coexist |
| 14 | verification-gap | No render test of per-subject pills / each-key | medium | Filed disposition defer: story 3 replaces the tile; defer |

## Implementation Notes

- Review patches: 0048 ends with a one-time recompute for classes that already have a subject; the class-subject trigger's whole loop is exception-isolated; e2e fixture classes carry subjects.
- Final verification: reset 0; npm test 1355 pass; check 0 errors; build 0; playwright 121 passed, 4 skipped.

- Recompute is one grouped query per type (attendance via `attendance_current` → `class_sessions` → `classes`/`class_days`; homework via `homework_instances.class_id`), looping thresholds per subject row. Unknown `p_badge_type` returns early as before.
- Class-subject trigger isolates each student's recompute in its own `BEGIN…EXCEPTION` block (a failing student logs a warning; others and the class save proceed). The failure path is not covered by a test.
- Existing RLS fixtures that relied on trigger-written badges (Story 4-2 and #102 blocks) now create classes with `badge_subject: 'dance'`; the Story 4-2 teacher-read assertion flipped to allowed. New block "Badge detail 2: per-subject badges" covers matrix rows 1–8 plus the client-insert rejection.
- Tile pill label is `"<subject label>: <entry>"` (interim until story 3).

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0048 applies cleanly
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test` -- expected: exit 0 (badge tiles on /student and the parent page)
