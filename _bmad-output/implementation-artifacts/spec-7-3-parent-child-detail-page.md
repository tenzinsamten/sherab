---
title: 'Parent child detail page (deferred from 7-3)'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '314fa3d709e63ec2f645a370113836ab35d7340e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/parent/children/[id]` shows only sessions with leave controls and the deletion card. A parent still can't see the child's homework, attendance, skills, streak, badges, team or teachers, which is the epic's core promise (CAP-12).

**Approach:**
- Add read-only sections to the existing page, built from the parent read access 7-3 added (no migration).
- Reuse the student-side loaders with the child's explicit id.

## Boundaries & Constraints

**Always:**
- **Guard:** keep the existing one (approved parent, approved linked child, else 404). Every read passes the child's id explicitly.
- **Summary:** streak and badges through `StudentProgressTiles`; the child's team with its rank and total, as on the student dashboard.
- **Homework:**
  - **Open:** the same rule and numbers as the `/parent` card and the student's To-do (`loadStudentHomework` todo, `isTodoVisible`, still enrolled). Each item shows title, class, due date, an Overdue marker, and reference links that open externally (`target="_blank" rel="noopener noreferrer"`).
  - **Done and Reviewed:** `loadStudentHomework` done, newest first, 10 per page with a `?done=` page parameter.
  - No link to `/student/homework/*` and no mark-done form: parent rows are their own read-only markup.
- **Attendance:** `child_attendance(child id)`, newest first: date, class, Present/Absent. Notes are never shown.
- **Skills:**
  - Per class and skill area, the current level (`pickCurrentSkillStatuses` on rows newest first).
  - A collapsible full history with level, date and the teacher's note (`skill_status_history.notes`).
- **Teachers:** per enrolled class, `class_people` (the parent branch returns teachers only).
- **Leaderboard:** team totals only (`team_leaderboard`), with the child's team highlighted. No other student's name or data anywhere.
- **Decision 1 — tabs:** four tabs.
  - **Overview:** streak, badges and team tiles, the leaderboard, teachers, and the existing deletion card at the bottom.
  - **Homework:** Open, then Done and Reviewed.
  - **Sessions:** the existing sessions list with leave controls.
  - **Record:** attendance and skills.
  - The active tab lives in the URL as `?tab=overview|homework|sessions|record` (default and any invalid value → overview). The tabs are plain links, so they work without JavaScript and survive reloads, back navigation and form posts.
  - Done paging keeps `tab=homework` (`?tab=homework&done=2`).
  - Leave and deletion actions return the parent to the tab they were on.
  - Tabs are marked up accessibly: a `nav` with `aria-current="page"` on the active link.
  - The load reads every section (small data), so switching tabs never shows a stale error.
- **No write controls** beyond the existing leave and deletion ones.
- **Load errors:** a failing section shows its own error line; the rest of the page still renders.
- **i18n:** reuse existing message keys where they fit; every new string exists in en, de and bo. Copy is terse, with no exclamation marks.

**Never:**
- A migration or RLS change.
- Showing `attendance_records.notes`, classmates, or another child's data.
- Links into student-only routes.
- A syllabus section (parents can't read `class_syllabi`).
- Pushing to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full child | approved child with open, overdue, done and reviewed homework, attendance, skills with notes, streak, badges, team | every section filled; Open equals the card's count, overdue marked | N/A |
| Links | homework with reference links | anchors with target _blank and rel noopener noreferrer | N/A |
| Sibling isolation | parent with two children, open child A | only A's homework, skills and attendance (history filtered by id) | N/A |
| Empty child | new approved child, no data | each section shows its empty line | N/A |
| Paging | 12 done items, `?done=2` | items 11-12 | invalid page → page 1 |
| Section failure | the skill query errors | skills error line; other sections render | loadError per section |
| Guard | other parent's child / pending child | 404 | N/A |
| Tabs | `?tab=record`; `?tab=bogus`; no tab | Record shown; Overview; Overview | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/parent/children/[id]/+page.server.ts`:
  - `:54-64` the load guard (keep); `:66-70` enrollments; `:75-143` sessions, leave and Sick; `:145-156` deletion; `:158-164` return keys (extend).
  - `:40` `plusDays` duplicates `addDays` (`student-homework.ts:68`): reuse it.
- `+page.svelte:105` header; `:112-256` sessions card; `:258-295` deletion card.
- `page.server.spec.ts`:
  - `:15` fake — add `range` (for `fetchAllHistoryRows`) and `maybeSingle`.
  - Guard tests `:88`; sessions tests `:100`.
- `src/lib/server/student-homework.ts`:
  - `loadStudentClasses` :187, `loadStudentHomework` :225 (explicit id; `splitProgress` :107 filters to one student).
  - `toItem` :81, `teamRank` :404, `loadClassPeople` :419.
- `src/routes/student/+page.server.ts:21-99` -- streak, badges, team, leaderboard read pattern.
- `src/lib/server/streak.ts:18`, `src/lib/server/badges.ts:21` -- shapers.
- `src/lib/components/StudentProgressTiles.svelte` -- reuse as is.
- `src/routes/student/+page.svelte:62-67` -- the team tile markup.
- `src/lib/server/skill-status.ts:25` `pickCurrentSkillStatuses`.
- `src/routes/teacher/classes/[id]/+page.server.ts:133-177` and `+page.svelte:13-33,193-290` -- skill reads, labels, grid and `<details>` history pattern.
- `supabase/migrations/0025_parent_reads.sql:183` `child_attendance`, `:291` `class_people`; `0009_leaderboard.sql:51` `team_leaderboard`.
- `src/lib/components/TextWithLinks.svelte:23` -- external link pattern.
- Do **not** reuse `StudentHomeworkRows.svelte`: it links to `/student/homework` (:40) and has a mark-done form (:71-85).
- Message keys to reuse: `student_homework_*`, `student_streak_*`, `student_badges_*`, `student_tile_team`, `student_team_rank`, `leaderboard_*`, `student_class_taught_by`, `roster_skill_*`, `roster_level_*`, `roster_history_empty`, `roster_present`/`roster_absent`.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/parent/children/[id]/+page.server.ts` -- load the summary, homework (open + done page), attendance, skills, teachers and leaderboard for the child id, with a load-error flag per section.
- [x] `src/routes/parent/children/[id]/+page.svelte` -- the four link-based tabs and their read-only sections (decision 1).
- [x] `src/routes/parent/children/[id]/page.server.spec.ts` -- one test per matrix row (fake with `range` and `maybeSingle`).
- [x] `messages/{en,de,bo}.json` -- new headings and empty lines only.

**Acceptance Criteria:**
- Given a parent whose child has 2 Open homework (1 overdue), when they open the child page, then the page lists exactly those 2 with 1 marked overdue, matching the `/parent` card.
- Given a freshly reset local DB, when `npm test` and `npm run check` run, then all pass with 0 errors.

## Implementation Notes

- Class names come from one `classes` read over the enrolled class ids (not `loadStudentClasses`, which also reads `class_syllabi`, unreadable for parents). Homework or skills from a class the child has left show the existing "Former class" label.
- Open and Done call `loadStudentHomework` twice (todo, done page); each reads the full visible history, which for a parent covers all their children and is filtered to this child by `splitProgress`.
- Forms post to `?tab=sessions&/setLeave`, `?tab=sessions&/preview` and `?tab=overview&/requestDeletion` so a no-JS post lands back on its tab.
- The kicker changed from "Sessions and leave" to "Parent" since the page is no longer only about leave.
- `npm test` needed a local `supabase db reset` first: stale local data made `rls.spec.ts` fail on the unique class name index.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | edge | `export const CHILD_TABS` from `+page.server.ts` is an invalid SvelteKit export | high | patch | `npm run build` fails: "Invalid export 'CHILD_TABS' … valid exports are load, … or anything with a '_' prefix"; `npm run check` and vitest don't catch it. |
| 2 | edge | The attendance `{#each}` key `sessionDate:classId` can repeat and crash the Record tab | medium | patch | `attendance_records` has no uniqueness (0008:47,137), and marks are append-only (AD-5), so a re-marked session returns two rows with the same key. |
| 3 | blind, edge ×2, vgap-other | A failed classes/enrollments read isn't flagged on Done or Skills; current classes show as "Former class" with no error | medium | patch | `classNamesError` feeds only `errors.open` and `errors.teachers`. |
| 4 | vgap | The skill "current level" depends on a sort order the fake ignores | medium | patch | The fixture is pre-sorted and the fake's `order` doesn't reorder; dropping `.order(...)` still passes. |
| 5 | blind, vgap | Most per-section error flags (summary, team, teachers, open, done) have no test | medium | patch | Only skill, attendance and leaderboard errors are injected. |
| 6 | vgap | The "still enrolled" Open rule and the Former-class path are untested on the parent page | medium | patch | Every fixture instance is in the enrolled class `k1`. |
| 7 | blind, edge | The Open heading shows "(0)" next to its error line | low | patch | A direct template condition. |
| 8 | blind | The browser `<title>` still says "Sessions and leave" on every tab | low | patch | `+page.svelte:146` uses `leave_kicker`; a direct fix. |
| 9 | blind | Homework due dates render as raw ISO while Sessions and Record use `formatDay` | low | patch | A direct fix. |
| 10 | vgap, blind | Tab-returning form actions, external-link attributes and `aria-current` aren't verified in a browser | medium | defer | No parent e2e fixtures; repo e2e is `calendar.e2e.ts` only. |
| 11 | blind | Homework history is fetched twice per load | low | reject | School scale; the fix restructures a shared loader. |
| 12 | blind | Teachers load in a second round trip | low | reject | One extra request at school scale. |
| 13 | blind | Attendance and skill history have no paging | low | reject | ~40 sessions a year. |
| 14 | blind | bo strings are English | false | reject | Project convention. |
| 15 | blind | Load errors use `role="alert"` | low | reject | Cosmetic; matches existing error lines. |
| 16 | blind | No test runs the `/parent` card and the page on one fixture | low | reject | Both share the Open rule; the fix adds cross-route fixtures. |
| 17 | blind | A team read error hides the whole leaderboard | low | reject | Rare transient; the fix adds a branch. |
| 18 | blind | Several former classes share one "Former class" heading | low | reject | Rare; needs new copy. |
| 19 | blind | The team line doesn't use a tile like streak and badges | low | reject | Cosmetic. |
| 20 | edge | A rejected promise in `Promise.all` 500s the whole page | false | reject | supabase-js resolves `{ data, error }` rather than throwing on query errors. |
| 21 | review (own) | The `/parent` card link still reads "Sessions and leave" though the page now has four tabs | low | patch | Reported by the implementer; a direct string fix. |

## Verification

**Commands:**
- `npm test` -- expected: all pass.
- `npm run check` -- expected: 0 errors.

**Manual checks (if no CLI):**
- Local: as an approved parent, open a child with seeded data and check every section on a phone-width window.
