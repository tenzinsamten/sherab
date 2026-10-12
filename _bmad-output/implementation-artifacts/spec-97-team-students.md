---
title: 'Team page: the students of a team, by name (#97)'
type: 'feature'
created: '2026-10-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'eb2444d5b60c0a9d4f685e9bfe251a382cf4e57f'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No page lists the students of a team. The admin sees a count per team, the leaderboard shows totals, and a student or parent sees only the team's name (user, 2026-10-12: "Currently we cannot see the students in the team . but we need it").

**Approach:** Clicking a team opens a page that lists its students by name. The admin, teachers and approved students can open every team. An approved parent can open the team of each of their own children, and no other.

## Boundaries & Constraints

**Always:**
- The page shows the team's name in the viewer's interface language and its students' names, sorted by name. Nothing else about a student: no class, streak, rank, homework or attendance.
- The name is the one the app already shows for a student elsewhere (display name, else the registration name). Only approved students are listed.
- Who may see a team's students is enforced in the database, not only by the page: admin; any teacher; any approved student; an approved parent, only for a team one of their own approved children is in. Everyone else, signed in or not, gets nothing.
- A team is a link wherever its name is shown to someone who may open it: the leaderboard rows, the admin's Teams list, the student's team tile, and the team line on the parent's child page. Where the viewer may not open a team (a parent on the leaderboard, for other teams), the name stays plain text.
- New text in en, de and bo (Tibetan is the assistant's draft, recorded as unreviewed).

**Never:**
- No moving a student to another team, no editing from this page.
- No individual results on this page or added to the leaderboard: the leaderboard keeps showing team totals only.
- No change to what a parent sees of a class (`class_people` keeps hiding classmates from parents).
- Do not regenerate `database.types.ts`. Do not push the migration or commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student opens any team | Approved student, team with 3 approved students | Team name and the 3 names, sorted | N/A |
| Teacher or admin | Any team | Same list | N/A |
| Parent, child's team | Approved parent with an approved child in the team | Same list | N/A |
| Parent, another team | No child of theirs in it | "Not found"; on the leaderboard that team is not a link | 404, no names |
| Parent with two children in two teams | Opens either | Both open; a third team does not | N/A |
| Pending or rejected account, signed out | Any team | Signed out: sign-in page. Otherwise "not found" | No names |
| Team without students | New team | Team name and "No students in this team yet" | N/A |
| Pending or rejected student in the team | Approved viewer | Not listed | N/A |
| Unknown team id | Any viewer | "Not found" | 404 |
| Direct database call | A parent calls the function for another team | Refused | Error, no rows |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0025_parent_reads.sql` -- `class_people(p_class_id)`: the pattern to follow (SECURITY DEFINER, `search_path = ''`, refuses with `42501`, `coalesce(p.display_name, p.registration_name, '')`, approved students only). Helpers available: `is_admin()`, `is_parent()`, `is_parent_of(p_student_id)`; check how a teacher and an approved student are recognised there and in 0016. Student's team: `profiles.team_id` (0002). Next migration number: `0041`.
- `supabase/migrations/0036_localized_names.sql:77-` -- `team_leaderboard()` returns `team_id`, `team_name`, `team_name_bo`, `team_name_de`; `src/lib/localized-name.ts` (`pickLocalized`, `localizeName`) picks the shown name.
- `src/routes/leaderboard/+page.server.ts`, `+page.svelte`, `src/lib/server/leaderboard.ts` (`shapeTeamLeaderboard`, `TeamRank`) -- rows to turn into links; any signed-in role reaches this page, so the load must say which teams this viewer may open.
- `src/routes/admin/teams/+page.svelte`, `+page.server.ts` -- team list with `profiles(count)`.
- `src/routes/student/+page.svelte:99-104`, `+page.server.ts` -- the student's team tile (`data.team`).
- `src/routes/parent/children/[id]/+page.svelte:303-309` -- the child's team line.
- `src/lib/server/class-access.ts` (`rowOr404`) and `PageBreadcrumb.svelte` -- 404 handling and breadcrumbs for the new page.
- New route: `src/routes/teams/[teamId]/` (signed-in page, like `/leaderboard`).
- `src/lib/supabase/database.types.ts` -- hand-maintained. Tests: `src/lib/server/rls.spec.ts`, a spec next to the new route, `src/routes/leaderboard/page.server.spec.ts`, and a browser test (new `e2e/team-students.e2e.ts`, helpers in `e2e/fixtures.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0041_team_students.sql` -- a function that returns a team's name columns and its approved students' names for an allowed caller and refuses everyone else; and a way for the app to learn which teams the caller may open (for the parent case) -- access decided in the database.
- [x] `src/lib/supabase/database.types.ts` -- add the new function(s) by hand -- typed calls.
- [x] `src/routes/teams/[teamId]/+page.server.ts`, `+page.svelte` -- the team page: breadcrumb to the leaderboard, team name, sorted names, empty state; 404 for a refusal or an unknown id; sign-in redirect when signed out -- the list.
- [x] `src/routes/leaderboard/*`, `src/lib/server/leaderboard.ts`, `src/routes/admin/teams/+page.svelte`, `src/routes/student/+page.svelte`, `src/routes/parent/children/[id]/+page.svelte` (and their server files where data is needed) -- make the team name a link where the viewer may open it -- "when you click on a team".
- [x] `messages/en.json`, `de.json`, `bo.json` -- page heading, empty state, link labels for screen readers -- translations.
- [x] `src/lib/server/rls.spec.ts`, the new route's spec, `leaderboard/page.server.spec.ts`, `e2e/team-students.e2e.ts` -- every matrix row -- tests.
- [x] `_bmad-output/manual-verification-issues.md` -- #97 to "built, to verify"; note that PRD §8 ("a Parent sees … no other child's data beyond what the leaderboard already shows") now has this exception -- records.

**Acceptance Criteria:**
- Given an approved student on the leaderboard, when they click any team, then they see that team's students by name and nothing else about them.
- Given an approved parent, when they open their child's page and click the team, then they see that team's students; given another team's address, then "not found".
- Given the leaderboard, when any viewer looks at it, then it still shows team totals only.
- Given a phone at 390 px, when the team page is opened, then names wrap and nothing scrolls sideways.

## Implementation Notes

- Database (`0041_team_students.sql`, not pushed): `can_view_team(team)` holds the rule (admin, `profiles.role = 'teacher'`, approved student, or `is_parent_of()` a student in the team); `team_students(team)` raises `42501` unless it is true, and returns one row per approved student (`team_name`, `team_name_bo`, `team_name_de`, `student_name`), sorted by name, one row with a null `student_name` for a team without students, and no row for an unknown team; `viewable_team_ids()` lists the teams the caller may open. No student id is returned.
- Page (`src/routes/teams/[teamId]/`): a refusal, an unknown id and a malformed id are all 404 "Team not found." (`TEAM_MESSAGES` in `class-access.ts`, English like the other "not found" messages); another database error is a 500.
- Leaderboard: `markOpenableTeams()` adds `canOpen` to each row from `viewable_team_ids()`; if that read fails, no team is a link and the leaderboard still loads.
- Student tile: the whole tile was already one link (to the leaderboard). With a team and an approved profile it now opens the team page instead; a link inside a link is not possible. No `aria-label` there, so the tile's rank stays in its name.
- Admin Teams list: the link's label is its `title`, not `aria-label`, because an `aria-label` replaced the table cell's name that `e2e/forms.e2e.ts` (#76) reads.
- Parent's child page: only the team line is a link; the leaderboard list below it stays plain text.
- `e2e/forms.e2e.ts` "admin team names … (#76)" fails at the language picker with and without this change.

- Review pass 1 (2026-10-12): 8 fixes applied, 10 rejected, see the triage log. No finding concerned the access rule.
- Verified after the fixes on a reset database: 1170 unit and database tests, `npm run check` and `npm run build` exit 0; on a second reset `e2e/team-students.e2e.ts` (7) and `e2e/breadcrumbs.e2e.ts` (7) pass. The full browser suite was not run; the implementer saw the known "admin team names" failure (#93) in `forms.e2e.ts`, also without these changes.
- Not committed and not pushed; migration 0041 is local only.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-12). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| V1 | The team page is never tested to show the team name in the viewer's language | medium | Filed evidence: every test runs in English, where `pickLocalized` returns its first argument whatever the order. | patch (test) |
| V2 | "Display name, else registration name" is not pinned | medium | Filed evidence: `handle_new_user` copies the registration name into the display name, so every fixture has both equal; a student can change the display name on the account page. | patch (test) |
| B2 / E1 | A failed `viewable_team_ids` read is swallowed without a trace | low | `leaderboard/+page.server.ts` destructures only `data`; every link would vanish with nothing logged. | patch |
| B4 | German texts say "Schüler" where the catalogue says "Schüler:innen" | low | Three new `de` messages; 27 existing uses of "Schüler:innen". | patch |
| B9 / E5 | The #97 database tests depend on their order | low | "Parent with two children" adds students to the shared teams that earlier tests assert exactly. | patch (dedicated teams) |
| B10 / E4 / E6 / E7 | Test helpers ignore errors from fixture updates | low | `signInStudent` dereferences `data.user!`; the "rejected" updates are unchecked, so that case could silently test the pending state. | patch |
| B11 / E8 / E9 | The e2e fixture swaps a module-level `parent`; `boundingBox()` results are used unchecked | low | True of `e2e/team-students.e2e.ts`. | patch |
| B14b | `team.id` is returned by the load and never used; `can_view_team` is true for an unknown team id for staff and students, undocumented | low | True; `team_students` then returns no row and the page answers 404. | patch (remove, comment) |
| B3 / E2 | A student with an empty name would be a blank list item | low | Same `coalesce` as `class_people`; needs an empty display name, which the account form does not save. | rejected (low) |
| B5 | The admin Teams link uses `title` where the others use `aria-label` | low | Deliberate: an `aria-label` replaced the table cell's name and broke an existing test; the link text is the team name. | rejected (low) |
| B6 | The leaderboard row's own `aria-label` and the link's label overlap | maybe-false | Needs a screen-reader check; would be low. | rejected |
| B7 | The breadcrumb always leads to the leaderboard | false | As specified ("breadcrumb to the leaderboard"). | rejected |
| B8 | The student's "My team" tile now opens the team page, not the leaderboard | low | As specified (the tile is one of the four link places); the leaderboard stays in the menu and the breadcrumb. | rejected (intent); reported to the user |
| B1 | `viewable_team_ids()` checks each team separately; no index on `profiles.team_id` | low | True; a handful of teams and about 100 students. | rejected (low) |
| B12 | No test of duplicate names, a child moving team, or the leaderboard's wrap at 390 px | low | True; localized names and display-name precedence are V1 and V2. | rejected (low) |
| B13 | Names are sorted by the database's collation, not the reader's locale | low | True; same as `class_people`. | rejected (pre-existing pattern) |
| B14a | Parents and students now read other children's names; consent text and PRD are not updated | medium | True and intended (user's decision of 2026-10-12, recorded in log entry #97). The registration consent text says "Nothing is shown publicly". | rejected as a code finding; reported to the user |
| E3 | An expired session between the two calls gives a 500 page | low | True of every load in the app. | rejected (pre-existing pattern) |

## Verification

**Commands:**
- `npm run supabase:reset` then `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/team-students.e2e.ts` on a freshly reset database -- expected: all pass
