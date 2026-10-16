---
title: 'New-badge celebration'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '716ceda50d1217e6a583ddec7140ca1d14bdd29b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-badge-detail/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-badge-detail/badge-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A badge is earned silently; the student only notices if they look at the tile, which wastes the motivating moment the badges exist for.

**Approach:** The first time a student opens any page of the app after earning one or more badges, a "New badge!" dialog shows the new badges' icons with what each rewards. Dismissing it records them as seen on the account, so it never shows again for those badges, on any device. Parents, teachers and admin viewing a student never trigger or consume it.

## Boundaries & Constraints

**Always:** "Seen" is stored per badge row in Postgres (nullable `seen_at`), written only through a SECURITY DEFINER function that updates the caller's own rows (`student_id = auth.uid()`), mirroring `mark_tour_seen` (`0044_tours_seen.sql`). Badge rows existing when the migration runs count as seen (no retroactive celebration). Several new badges show together in one dialog, ordered like the tile (subject, attendance before homework, milestone), each with icon (trophy fallback) and reward text, plus a link to `/student/badges`. Shown only when the signed-in active role is student and the student is approved. Marked seen on dismiss (Close, Escape, or the link), not on display; if marking fails the dialog closes anyway and may show again next visit. Accessible: dialog is named, focus moves into it and returns. All text in en, de, bo. A failed read of unseen badges shows nothing (no error toast).

**Never:** No push, email or sound. No confetti/animation library. No change to how badges are awarded. Not shown on parent, teacher or admin pages.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One new badge | student earned dance attendance 5, unseen | next page load shows dialog with that badge | N/A |
| Several | subject assigned later awards language attendance 1 and 5 | one dialog listing both | N/A |
| Dismiss | student closes the dialog | both rows get seen_at; reload shows no dialog | mark fails → dialog closes, shows again next load |
| Other device | dismissed on phone | laptop shows no dialog | N/A |
| Existing badges | rows present before migration | never celebrated | N/A |
| Not the student | parent/teacher/admin pages; a parent views the child | no dialog; rows stay unseen | N/A |
| Others' rows | student calls the mark endpoint with another student's badge ids | nothing changes | 200 with nothing marked |
| Pending student | not yet approved | no dialog | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0050_badges_seen.sql` -- `alter table badges_earned add column seen_at timestamptz`; `update ... set seen_at = earned_at` for existing rows; `mark_badges_seen(p_ids uuid[])` SECURITY DEFINER, `set search_path = ''`, raises 42501 when not signed in, `update public.badges_earned set seen_at = now() where id = any(p_ids) and student_id = auth.uid() and seen_at is null`; revoke from public/anon, grant to authenticated.
- `src/lib/supabase/database.types.ts` -- `seen_at` on badges_earned; the function under `Functions` (hand-edited).
- `src/routes/api/badges/seen/+server.ts` -- new POST `{ ids: string[] }` (UUIDs, max 50), copy of `src/routes/api/tours/seen/+server.ts`.
- `src/routes/+layout.server.ts` -- when the active role is student and approved, read the caller's `badges_earned` where `seen_at is null` (id, subject, type, milestone); shape with `shapeStudentBadges` + `badgeIconPath` from `src/lib/server/badges.ts`; return `newBadges` ([] otherwise or on error).
- `src/lib/components/NewBadgeDialog.svelte` -- new `ix-modal` opened on mount when `newBadges.length > 0`, same open/aria-label pattern as `BadgeDetailDialog.svelte`; reuse `badgeRewardText`/`badgeIconLabel` from `src/lib/badge-subject.ts`; on close POSTs ids to `/api/badges/seen`.
- `src/routes/+layout.svelte` -- mount `NewBadgeDialog` for the student role, next to `PageTour` (~line 371); must not open together with a page tour (students get no tours today; keep it that way).
- `messages/*.json` -- dialog title, intro, close, see-all.
- Tests: `src/routes/api/badges/seen/server.spec.ts` (copy tours spec), `src/routes/layout.server.spec.ts` (newBadges only for approved student role), `src/lib/server/rls.spec.ts` (function marks own rows only; migration marks existing rows), `e2e/badges.e2e.ts` (earn → dialog → close → reload without dialog).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0050_badges_seen.sql` -- seen_at, backfill, mark function -- dismiss/others'/existing rows
- [x] `src/lib/supabase/database.types.ts` -- column + function types -- hand-maintained
- [x] `src/routes/api/badges/seen/+server.ts` -- mark endpoint -- dismiss row
- [x] `src/routes/+layout.server.ts` -- newBadges for approved students -- role rows
- [x] `src/lib/components/NewBadgeDialog.svelte`, `src/routes/+layout.svelte` -- celebration dialog -- one/several rows
- [x] `messages/en.json`, `de.json`, `bo.json` -- new keys -- localization
- [x] tests above -- every matrix row

**Acceptance Criteria:**
- Given keyboard only, when the dialog opens, then focus is inside it and Escape closes and marks the badges seen.
- Given the student opens /student/badges from the dialog's link, then the badges are marked seen and the page loads.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind | >50 unseen ids make the dialog undismissable | false | At most 36 badges exist (3 subjects x 2 types x 6 milestones), below the 50 cap |
| 2 | blind | Title always singular with several badges | low | badge_new_title has no plural; direct message change. patch |
| 3 | blind | Focus lost on close when opened after the sign-in redirect | medium | opener is document.body, onClosed skips restore; spec requires focus to return. patch |
| 4 | blind | Screen readers hear each badge twice (img alt + reward text) | low | Direct alt="" fix. patch |
| 5 | blind | Parent/teacher "no dialog" e2e asserts before ix-modal can open | medium | Negative check right after networkidle; patch (wait for whenDefined) |
| 6 | verification-gap | In-session dismissed memory untested under a layout re-run | medium | Homework Done invalidates the layout; no test re-delivers badges after dismissal. patch (e2e) |
| 7 | verification-gap | help-screenshots student shots may capture the dialog | low | Student may hold unseen badges; one fixture update. patch |
| 8 | blind, verification-gap | Backfill tested by SQL text regex only | medium | No harness to seed rows before one migration; filed disposition defer |
| 9 | blind | No component test for NewBadgeDialog logic | low | No component-test setup; e2e covers the flow; rejected |
| 10 | blind | Tour/dialog exclusivity enforced only by comment | low | Students have no tours; rejected |
| 11 | blind | shapeNewBadges shapes per row | low | Correct today; rejected |
| 12 | blind | Story spec not in the diff | false | Committed in the docs commit at step 5 |
| 13 | blind | Endpoint does not dedupe ids | low | Duplicates are harmless to the update; rejected |
| 14 | edge-case | open() rejection leaves isOpen true | low | Undemonstrated failure; rejected |
| 15 | edge-case | New badge while dialog open does not re-run the effect | low | Rare; shows on next load; rejected |
| 16 | edge-case | closeModal without close events leaves closing true | low | ix-modal fires dialogClose on closeModal; rejected |
| 17 | edge-case | Middle-click on the link does not mark seen | low | Dialog shows again next visit, as for a failed mark; rejected |
| 18 | edge-case | Badge earned mid-session shows only after a reload/invalidation | low | Student-caused awards (homework Done) invalidate the layout; teacher-marked attendance shows on next load, matching "next page load"; rejected |

## Implementation Notes

- Review patches: plural dialog title; focus falls back to the page's h1 when the dialog opened with no opener; icons in the dialog are decorative (alt=""); "no dialog" e2e checks wait for ix-modal to settle; new e2e for the in-session dismissed memory across a layout re-run; help screenshots mark the student's badges seen first.
- Final verification: reset 0; npm test 1430 pass; check 0 errors; build 0; playwright 130 passed, 4 skipped.

- `shapeNewBadges` (src/lib/server/badges.ts) wraps `shapeStudentBadges` per row to keep each row's id, and shares its sort (`compareBadges`). The layout also selects `earned_at`, which the shaper needs.
- The layout reads unseen badges only when the active role is student, the profile role is student and the status is approved; a read or shaping failure logs and returns `[]` (no `loadError`).
- `/api/badges/seen` refuses an empty list as well as more than 50 ids or non-UUIDs (400).
- `NewBadgeDialog` remembers ids dismissed in this browser session (the single-role layout load does not re-run per navigation), marks seen in `dialogClose`/`dialogDismiss` and in the link's click (once), with `keepalive` so the link navigation does not cancel it.
- Focus: SvelteKit resets focus to the body after the sign-in redirect, after the dialog opened, so the dialog moves focus to its Close button after `showModal()` and again in `afterNavigate` while it is open (not while it is closing).
- The "existing rows count as seen" check in rls.spec.ts is a static check of the migration's backfill statement (a reset database has no badge rows before 0050 runs).

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: 0050 applies
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0
- `npm run build` -- expected: exit 0
- `npx playwright test` -- expected: exit 0

**Manual checks:**
- Earn a badge as a student (teacher marks attendance), open the app: dialog in en, de, bo; close; reopen on another browser: no dialog.
