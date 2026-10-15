---
title: 'Badge icons, detail and progress'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '109ae85f03f5030a80e828125ad9e41d637c4576'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-badge-detail/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-badge-detail/badge-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Badges tile shows text pills ("Dance & song: Attendance x10"): no icon, no explanation of what a badge rewards or when it was earned, and no sign of how close the next badge is.

**Approach:** On the student dashboard and the parent's child page, the Badges tile shows each earned badge as its icon from `static/badges/`. Tapping one opens a detail dialog: large icon, what it rewards, subject, date earned, and the next milestone in that track. Below the icons, each of the student's subjects shows progress toward the next attendance and homework badge ("7 / 10").

## Boundaries & Constraints

**Always:** Icon file is `/badges/{subject}-{type}-{milestone}.svg`; a milestone with no icon falls back to today's trophy pill. Earned icons are ordered by subject (language, dance, instrument), then attendance before homework, then milestone. Progress counts are the same counts the badge recompute uses (distinct present days per subject; distinct Done homework per subject; classes without a subject excluded), computed in Postgres and readable only by the student, their linked parents, their teachers and admin. Progress lists the subjects of the student's enrolled classes that have a subject, both tracks each, even at 0. After the top milestone, progress says the top badge is reached. All text in en, de, bo. Each icon button has an accessible name (subject, track, milestone); the dialog is keyboard-closable and returns focus. A failed load shows "—" as today.

**Never:** No locked/greyed badges or badge page (story 4), no teacher-facing page (story 4), no celebration (story 5). No change to how badges are awarded. No client-side counting from raw attendance/homework rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Earned icons | dance attendance 1, 5; language homework 1 | three icons, order language-homework-1, dance-attendance-1, dance-attendance-5 | N/A |
| Detail | tap dance-homework-5 earned 2026-10-12 | dialog: icon, "5 Dance & song homework done", earned date in the viewer's locale, "Next: 10" | N/A |
| Top badge detail | tap a 100 badge | "Next" replaced by "Top badge reached" | N/A |
| No icon | a milestone not in 1/5/10/25/50/100 | trophy pill with text label, still opens the detail | N/A |
| Progress | enrolled in language + dance; 7 dance days, 0 language homework | dance attendance 7 / 10, dance homework 0 / 1, language attendance and homework rows shown | N/A |
| Unset subject class | enrolled only in a class without a subject | no progress rows; empty-state text | N/A |
| Parent view | parent opens their child's page | same icons, detail and progress for that child | N/A |
| Access | another student/parent/unrelated teacher calls the progress function for this student | no rows | function returns empty |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0049_badge_progress.sql` -- new `badge_progress(p_student_id uuid)` returns table (subject text, badge_type text, total int, next_milestone int null): SECURITY DEFINER, `set search_path = public`; returns nothing unless `is_admin() or p_student_id = auth.uid() or is_parent_of(p_student_id) or is_teacher_of_student(p_student_id)`. Subjects = distinct `classes.badge_subject` of the student's `class_enrollments` (not null). Totals use exactly the per-subject queries of `recompute_student_badges` in `0048_badges_per_subject.sql`; next milestone = smallest threshold from `app_settings.badge_milestone_thresholds` (same fallback list) greater than total. Grant execute to authenticated.
- `src/lib/supabase/database.types.ts` -- add the function under `Functions` by hand.
- `src/lib/server/badges.ts` -- `shapeStudentBadges` sorts by `BADGE_SUBJECTS` order, type, milestone; new `shapeBadgeProgress(rows)` view model; `badgeIconPath(badge)` returning the path or null when the milestone has no icon (`BADGE_ICON_MILESTONES = [1,5,10,25,50,100]`).
- `src/routes/student/+page.server.ts` and `src/routes/parent/children/[id]/+page.server.ts` -- call `rpc('badge_progress', { p_student_id })` alongside the badge read; a failure sets the existing `loadError`.
- `src/lib/components/StudentProgressTiles.svelte` -- replace pills with icon buttons + progress section; drop the interim `subject: entry` label.
- `src/lib/components/BadgeDetailDialog.svelte` -- new; `ix-modal` opened like `src/routes/calendar/+page.svelte:204-215` (`showModal`, aria-label on the shadow `<dialog>`), restores focus to the opener.
- `messages/*.json` -- rewards text per type, earned-on, next, top reached, progress labels, empty state, icon accessible name.
- Tests: `src/lib/server/badges.spec.ts` (ordering, icon path, progress shaping), both page specs (rpc wiring, loadError), `src/lib/server/rls.spec.ts` (function counts and access matrix rows), one e2e on /student: icons render, two subjects at the same milestone both show (covers the deferred item in `implementation-artifacts/deferred-work.md`), detail opens and closes.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0049_badge_progress.sql` -- progress function with access check -- progress rows + access row
- [x] `src/lib/supabase/database.types.ts` -- function type -- hand-maintained
- [x] `src/lib/server/badges.ts` -- ordering, icon path, progress shaping -- earned icons + no-icon rows
- [x] both `+page.server.ts` -- load progress -- student + parent rows
- [x] `src/lib/components/StudentProgressTiles.svelte`, `src/lib/components/BadgeDetailDialog.svelte` -- icons, dialog, progress -- detail rows
- [x] `messages/en.json`, `de.json`, `bo.json` -- new keys -- localization
- [x] unit, RLS and e2e tests above -- every matrix row

**Acceptance Criteria:**
- Given the student marks homework Done crossing a milestone, when /student reloads, then the new icon appears and the progress row shows the next target.
- Given keyboard only, when the student tabs to an icon and presses Enter, then the dialog opens, Escape closes it and focus returns to the icon.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | all three | Dialog "Next" from hardcoded list and relative to the tapped badge, not app_settings / the student's track | medium | badges.ts nextBadgeMilestone(badge.milestone); holding 1,5,10 and tapping 1 shows "Next: 5". patch: use the progress row's next |
| 2 | edge-case, blind | badge_progress failure folds into page-wide loadError, blanking streak and badges | medium | student +page.server.ts loadError, parent errors.summary. patch: separate flag |
| 3 | blind | Icon buttons have no visible name for mouse users | low | aria-label only; direct one-attribute fix. patch (title) |
| 4 | edge-case, blind, verification-gap | Progress subjects only from current enrollments; left subject keeps badges, loses progress | low | Frozen spec says "subjects of the student's enrolled classes"; matches intent; rejected |
| 5 | edge-case | Missing track defaults to next null ("top reached") | false | badge_progress always returns both tracks per subject (cross join in 0049) |
| 6 | edge-case | Non-integer threshold element makes the rpc raise | low | DB-only setting, no UI; rejected |
| 7 | edge-case, blind | open() has no re-entry guard on rapid double activation | low | Rare; guard adds state; rejected |
| 8 | edge-case | Early return when modal element missing keeps stale state | low | Element is always mounted with the tile; rejected |
| 9 | edge-case, blind | aria-label set through ix-modal shadow DOM silently | low | Same established pattern as calendar/+page.svelte:204-215; rejected |
| 10 | blind | Per-subject count SQL duplicated between 0048 and 0049 | low | Drift only on a future edit; song/dance RLS test cross-checks; rejected |
| 11 | blind | No unit tests for badgeTrackLabel/RewardText/IconLabel or dialog component | low | Static text; no component-test setup; e2e covers dialog; rejected |
| 12 | blind, verification-gap | e2e misses parent page, pill fallback, top badge, Close button | medium | Shared component pinned by student e2e; filed disposition defer |
| 13 | blind | e2e waits on networkidle | low | Passed repeatedly; rejected |
| 14 | blind | homeworkDone fixture uses skill_area language for dance | low | Cosmetic; rejected |
| 15 | blind | Story file not in the diff | false | Story spec is committed in the docs commit at step 5 |
| 16 | verification-gap | Tile UI only covered by Playwright, outside npm test | false | This build's verification runs `npx playwright test` (Verification section) |

## Implementation Notes

- Icon path is computed server-side (`badgeIconPath`), since components cannot import `$lib/server`.
- Review patches: the dialog's Next comes from the matching progress row (app_settings ladder, the student's real next target; omitted when no row); `progressLoadError` is separate from the page/summary error; icon buttons carry a `title`.
- Anonymous callers get an execute error from `badge_progress` (no grant); signed-in unrelated users get no rows.
- bo strings are a best effort; need a native check.
- Final verification: reset 0; npm test 1374 pass; check 0 errors; build 0; playwright 122 passed, 4 skipped.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0049 applies
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test` -- expected: exit 0

**Manual checks:**
- /student and a parent child page in en, de, bo: icons sharp at tile and dialog size; Tibetan text readable.
