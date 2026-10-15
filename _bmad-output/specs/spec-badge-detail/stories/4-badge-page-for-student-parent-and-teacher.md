---
title: 'Badge page for student, parent and teacher'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '70f0134307f3ccb28558e69d097376c22865adaa'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-badge-detail/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-badge-detail/badge-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student only sees badges already earned; nothing shows the badges still ahead, and teachers have no place to see a student's badges at all.

**Approach:** A dedicated badge page lists every badge in each of the student's subjects: earned ones in full colour with their date (tap opens the story-3 detail dialog), locked ones as the greyed real icon with what unlocks them. The same page exists for the student (`/student/badges`), for a linked parent (`/parent/children/[id]/badges`) and for a teacher of the student's class (`/teacher/classes/[id]/students/[studentId]/badges`). The dashboard Badges tile keeps its progress list, shows only the 6 most recently earned icons, and links "See all" to the page.

## Boundaries & Constraints

**Always:** Subjects shown = the student's progress subjects (enrolled classes with a subject) plus any subject the student already holds a badge in, so an earned badge never disappears. Per subject, attendance track then homework track, each listing every milestone of `app_settings.badge_milestone_thresholds` (fallback `[1,5,10,25,50,100]`) in ascending order. Locked badge = same icon path, greyed (CSS greyscale + reduced opacity), not a button, with unlock text ("Attend 25 Dance & song classes" / "Finish 25 Dance & song homework") and progress "7 / 25" for the next locked one. Milestone without an icon: trophy pill fallback. Access as RLS already allows (student self, linked parent, teacher of the student's class, admin); any other parent/teacher/student gets 404, using the existing parent-route check and a teacher check that the class is theirs and the student is enrolled in it. All text in en, de, bo; locked/earned state conveyed in text, not colour alone. A failed load shows the page's error state, not an empty grid.

**Never:** No celebration (story 5). No change to awarding or to `badge_progress`. No badges for subjects the student has never had. No ranking.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student page | enrolled language + dance; earned dance attendance 1, 5 | 24 badges: 2 earned with dates, 22 locked; no instrument | N/A |
| Left subject | holds instrument homework 1, no longer enrolled in instrument | instrument section shown with its 12 badges | N/A |
| Locked text | dance attendance total 7, next 10 | dance attendance 10 locked: "Attend 10 Dance & song classes", "7 / 10"; 25+ show requirement only | N/A |
| Earned tap | tap an earned badge | story-3 detail dialog opens | N/A |
| Tile | 8 earned badges | tile shows the 6 most recent by earned date + "See all" link to the page | N/A |
| Parent | linked parent opens child's page | same content for the child | other parent → 404 |
| Teacher | teacher of a class the student is enrolled in, via that class's roster | same content | teacher of another class, or student not in that class → 404 |
| No subjects | student whose classes have no subject and no badges | empty-state text | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/server/badges.ts` -- new `loadBadgePage(supabase, studentId)` reading `badges_earned`, `rpc('badge_progress')` and `app_settings` key `badge_milestone_thresholds` in parallel; returns `{ sections: [{ subject, tracks: [{ type, total, next, badges: [{ milestone, icon, earnedAt | null }] }] }], loadError }`. Reuse `shapeStudentBadges`, `shapeBadgeProgress`, `badgeIconPath`, `BADGE_SUBJECTS` order.
- `src/lib/components/BadgeCollection.svelte` -- new; renders sections; earned = icon button opening `BadgeDetailDialog.svelte` (story 3, pass the track's next); locked = greyed `<img>` + unlock text.
- `src/routes/student/badges/+page.server.ts` / `+page.svelte` -- new; student's own id.
- `src/routes/parent/children/[id]/badges/+page.server.ts` / `+page.svelte` -- new; reuse the child-link check from `src/routes/parent/children/[id]/+page.server.ts:140-160`; breadcrumb back to the child.
- `src/routes/teacher/classes/[id]/students/[studentId]/badges/+page.server.ts` / `+page.svelte` -- new; 404 unless the class is the teacher's (`class_teachers`) and the student has a `class_enrollments` row in it; breadcrumb Dashboard › class › student.
- `src/routes/teacher/classes/[id]/+page.svelte` -- in each student's skills panel (~line 98), a "Badges" link to the teacher page.
- `src/lib/components/StudentProgressTiles.svelte` -- tile shows the 6 most recent earned (by `earnedAt` desc), plus a `seeAllHref` prop rendered as "See all"; passed by `/student` and the parent child page.
- `messages/*.json` -- page titles, unlock texts per type, earned-on, locked label, see-all, empty state.
- Tests: `src/lib/server/badges.spec.ts` (`loadBadgePage` shaping: union of subjects, all milestones, locked/earned, next-locked progress), page specs for the three routes (access 404s), `e2e/badges.e2e.ts` (student page grid + locked text, tile See all, teacher link and page, parent page).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/badges.ts` -- `loadBadgePage` -- all matrix data rows
- [x] `src/lib/components/BadgeCollection.svelte` -- earned/locked rendering + dialog -- earned tap, locked text
- [x] three route pairs above -- load + access + page -- student/parent/teacher rows
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- Badges link per student -- teacher entry point
- [x] `src/lib/components/StudentProgressTiles.svelte` + its two callers -- recent 6 + See all -- tile row
- [x] `messages/en.json`, `de.json`, `bo.json` -- new keys -- localization
- [x] unit, page and e2e tests above -- every matrix row

**Acceptance Criteria:**
- Given a screen reader, when it reads a locked badge, then it hears the badge name and that it is locked with its unlock requirement.
- Given a student with no badges yet, when they open /student/badges, then every badge of their subjects shows as locked.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind | Unlock text not pluralised ("Attend 1 … classes"); German subject lacks a preposition | medium | en/de badge_unlock_* interpolate count before a fixed plural; e2e asserts the wrong form. patch |
| 2 | verification-gap, blind | "6 most recent" tile limit untested (fixture has 2 badges) | medium | No test exercises slice/sort; matrix row claimed covered. patch (pure fn + unit test) |
| 3 | blind, edge-case | loadBadgePage drops read errors without logging | low | Direct one-line addition, matches rowOr404. patch |
| 4 | blind | "See all" link has no 44px touch size | low | Direct CSS addition like other new links. patch |
| 5 | edge-case | Shaping throws on unknown subject/type → 500 not loadError | low | Throw is the deliberate loud-drift guard from story 2; rejected |
| 6 | edge-case | linked_children rpc error shows as 404 | low | Pre-existing behaviour moved verbatim into linked-child.ts; rejected |
| 7 | edge-case | Student profile read error redirects to / | low | Rare DB failure; rejected |
| 8 | edge-case, blind | parseBadgeMilestones vs SQL disagree on malformed settings; progress can vanish | low | DB-only setting with no UI; rejected |
| 9 | blind | UUID_PATTERN copied in three places | low | No behaviour harm; rejected |
| 10 | blind | Teacher route re-checks session the layout already checks | low | Redundant but correct; rejected |
| 11 | blind | Admin listed in access but has no badge route | low | Intent (CAP-8) names parents and teachers; admin route not asked for; rejected |
| 12 | blind | Left-subject locked text reads as still doable | low | Frozen spec keeps left subjects with their badges; rejected |
| 13 | blind | Teacher route's failed profile read uses class message | low | Logged; message wording only; rejected |
| 14 | blind | e2e checks one 404 per role, cross-tenant only in unit specs | low | Unit specs cover the checks; rejected |
| 15 | blind | Page error/empty markup untested | low | Simple branches; loadBadgePage loadError unit-tested; rejected |

## Implementation Notes

- Review patches: unlock texts use Paraglide plural variants (en/de; German "… in {subject}"); `recentBadges(badges, 6)` extracted and unit-tested with 8 badges; `loadBadgePage` logs the first read error; "See all" has a 44px touch size.
- Final verification: reset 0; npm test 1408 pass; check 0 errors; build 0; playwright 125 passed, 4 skipped.

- `loadBadgePage` treats a failed `badges_earned`, `badge_progress` or `app_settings` read as `loadError` (page error state). Milestones = the setting (fallback list) plus any earned milestone no longer configured, so an earned badge never disappears.
- A subject kept only because the student holds a badge in it (no enrolled class) has no `badge_progress` row: its tracks have `total: null`, show requirements only, and its detail dialog shows no "Next" line.
- The parent child check moved into `src/lib/server/linked-child.ts` (`loadLinkedChild`), used by the child page and the new badge page.
- Tile: the 6 most recent badges are shown newest first (stable on ties), so the story-3 e2e now expects dance (earned second) before language.
- Teacher breadcrumb is Dashboard › class › student, as specified; the roster link is labelled "Badges of {name}" for screen readers.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test` -- expected: exit 0

**Manual checks:**
- Badge page in en, de, bo on a phone-width window: grid wraps, greyed icons clearly distinct from earned ones.
