---
title: 'Teacher class pages'
type: 'feature'
created: '2026-10-20'
status: 'done'
route: 'dispatch'
baseline_commit: 'f8aff3d0fa57b4d6f392cc6a795d952c94747c5b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The teacher dashboard and class page are still iX (cards, selects, checkboxes, pills, inputs). Attendance is marked standing up mid-class on a phone, where today's iX rows and selects are small and cramped (SPEC CAP-2, CAP-3, CAP-4).

**Approach:** Rebuild the teacher dashboard, the class page (session picker, attendance, upcoming leave, skills) and the student badges page phone-first on the new system, following stories 3–6b. Homework is stories 7b and 7c (split at the scope gate).

## Boundaries & Constraints

**Always:**
- Keep data, loads, actions, messages, and every posted field: attendance `?/markAttendance` (`sessionId`, `studentIds`, `loaded_{id}`, `present_{id}`), skills `?/setSkillStatus` (`studentId`, `skillArea`, `level`, `notes`, ids `level-{sid}-{area}`, `notes-{sid}-{area}`) with its custom `submitSkill` and `novalidate`.
- Keep today's attendance behaviour: picking a session loads its marks; unsaved ticks survive a reload from another form; the leave pill shows inside the student's row; upcoming leave (#106) as today.
- Attendance is one-handed: each student row is a ≥44px tap target that toggles present, with the save button reachable at the bottom on phone.
- Keep the skills empty-level guard and its error under the field (`aria-invalid`/`aria-describedby` by hand), and today's toasts (`showToast`).
- Native select, checkbox and text fields; pills become `Badge`s; cards become `ui.card`.
- Each page has its own `data-ui="new"` root (`data-hydrated`) as a direct child of `main`. `EnrollmentPanel` (story 8) stays iX and renders outside that root, as a sibling after it.
- Every tour target (`teacher-class-card`, `teacher-class-code`, `teacher-class-open`, `class-session`, `class-attendance-save`, `class-skills`, `class-skill-student`, `class-homework`) stays on an element visible at 375, 820 and 1440px.
- Tablet: dashboard class cards in a grid; the class page uses the width (CAP-4).

**Never:**
- No server, load, action or permission changes.
- No iX element, `$lib/ix-fields`, `componentOnReady` or `<style>` left in the three pages; no iX-only remount keys (`sessionSelectKey`, `markedKey`, `marksKey`, `skillFormVersions`) unless the native field needs them.
- No change to `EnrollmentPanel`, the homework pages or the syllabus pages.
- No Help screenshot regeneration (story 10); only their selectors change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Dashboard | Teacher with 2+ classes, 375 / 820px | Class cards (code, open link) in one column / a grid | No classes → empty state |
| Pick session | Choose another session | Its saved marks load | No markable session → hint as today |
| Mark attendance | Tap rows, save, 375px | Toast, marks saved, rows keep state | Save error → toast, ticks kept |
| Unsaved ticks | Tick, then another form reloads data | Ticks kept | — |
| Student on leave | Leave for the session | Leave badge inside the row; upcoming leave listed | — |
| Skill level | Pick a level + notes, save | Saved, toast | Empty level → error under the field, `aria-invalid` |
| Badges page | Open a student's badges | `BadgeCollection` in the new root | — |
| Fit | en, de, bo at 375px | No sideways scroll, ≥44px targets, no cut labels | — |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/+page.svelte` (110): ix-card ×3, ix-empty-state, ix-button link; tour targets :92, :95, :101.
- `src/routes/teacher/classes/[id]/+page.svelte` (715):
  - iX: ix-select ×4 (+items), ix-card ×3, ix-checkbox ×2, ix-pill ×2, ix-icon ×2, ix-button ×2, ix-input, ix-empty-state; `showToast` (:9, :210-221), `ixValue` (:314, :336), `ixFieldError` (:463, :487), `<style>` (:558, ~157 lines).
  - Attendance form :298 (plain `use:enhance`), session picker from `markableSessions`; remount keys `sessionSelectKey`/`markedKey` (:56-76, :307), `marksKey` (:106); leave pills :340; upcoming leave :362-390.
  - Skills forms :447 (`submitSkill`), `skillFormVersions` (:158), `focusField` via `componentOnReady` (:195) → plain `focus()`.
  - `EnrollmentPanel` at :551: move it outside the new root.
- `src/routes/teacher/students/[studentId]/badges/+page.svelte` (32): no iX; add the root (`BadgeCollection` is already new).
- Reuse: `ui.*` from `$lib/ui/classes`, `ui/badge`, `ui/button`, `ui/native-select`, `ui/input`, `ui/empty-state`, `createPending`; native checkbox rows as in `ScheduleFields.svelte`; `@source` lines in `src/lib/ui/tailwind.css` per file.
- e2e:
  - `e2e/teacher.e2e.ts` (attendance, skills, dashboard parts only): `toHaveJSProperty`, `#sessionId input`, `ix-select-item` (:230), `ix-checkbox` (:283, :320, :439), `ix-pill` (:275-302), `.ix-invalid` (:577, :612), `ix-toast`, `.attendance-row`, `customElements` wait (:226). Leave the EnrollmentPanel/PIN parts (`ix-modal` :1087, :1254) alone.
  - `e2e/tours.e2e.ts:253` (`ix-button` wait) and teacher targets :271-338.
  - `e2e/badges.e2e.ts:245, 475-488` (`student-badges-link`).
  - `e2e/ix-visual.e2e.ts:145` teacher-dashboard baseline: re-baseline or drop (page is new UI).
  - `e2e/help-screenshots.e2e.ts:309-334`: teacher-2 `.page h2`, teacher-4 `section.card:has(+ section[aria-labelledby="skills-heading"])`, teacher-5 `#skills-heading` — keep the markup they need or update the selectors.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/teacher/+page.svelte` -- rebuild per Always/Never.
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- rebuild per Always/Never; `EnrollmentPanel` as a sibling after the root.
- [x] `src/routes/teacher/students/[studentId]/badges/+page.svelte` -- page root.
- [x] `src/lib/ui/tailwind.css` -- `@source` for each migrated file.
- [x] e2e -- rework the Code Map selectors; new `e2e/teacher-mobile.e2e.ts` covering each matrix row at 375 and 820px (dashboard also 1440px) and the en/de/bo fit check per page.

**Acceptance Criteria:**
- Given the class page at 375px, when a teacher marks attendance with one thumb, then every row and the save button are ≥44px and save is reachable without sideways scrolling.
- Given the tours at 375, 820 and 1440px, when started on the dashboard and class page, then every step finds a visible target.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind-hunter, edge-case | Sticky save bar sits under the bottom nav before hydration | medium | patch | `bottom-[var(--bottom-nav-height,0px)]`; BottomNav sets the variable after mount; `app.css:145` already has the right fallback. |
| 2 | verification-gap | Focus back on the emptied level select after a successful skill save untested | medium | patch | Pre-verified; only the cancelled branch asserts `toBeFocused()`. |
| 3 | blind-hunter, edge-case | Re-picking the empty level option clears the error while still empty | low | patch | `onchange` deletes `levelMissing` unconditionally; one-condition fix. |
| 4 | blind-hunter | Leave `Badge` names a generic `<span>` with `aria-label` | low | patch | ARIA forbids naming generic; works only via description computation. Direct correction. |
| 5 | blind-hunter | Fit check skips plain links (tile links, Badges link) | low | patch | Query covers buttons, nav links and rows only. Widen the selector. |
| 6 | blind-hunter | New e2e fixture uses real dates (berlinToday ±7) and deletes its class days | maybe-false | defer | Could collide with other tests' class days or a run across Berlin midnight; e2e runs with 1 worker, so not seen. Medium if it bites. |
| 7 | (verification) | Tours :374 class-page popover appeared twice, then never again | maybe-false | defer | Reproduced twice before the implementer's `/calendar` wait fix; 2 fresh-reset runs since pass 8/8. Root cause unknown; may relate to #6. |
| 8 | blind-hunter | Save bar's negative margins copy `ui.card` padding | low | reject | Cosmetic coupling; no breakage named. |
| 9 | blind-hunter | EnrollmentPanel wrapper copies part of `ui.page` | low | reject | Temporary until story 8 moves the panel. |
| 10 | blind-hunter | Hydration marker and its waits copied across files | low | reject | Established pattern since story 3; no named breakage. |
| 11 | blind-hunter | One-off heading/field classes beside `ui` tokens | low | reject | Style consolidation, no user harm. |
| 12 | blind-hunter | Teacher-dashboard visual baselines removed without replacement | low | reject | Story 3 precedent; spec allowed "re-baseline or drop". |
| 13 | blind-hunter | Upcoming-leave badge has no context for screen readers | low | reject | Pre-existing (old pill the same). |
| 14 | blind-hunter | e2e tests share state across viewports | low | reject | Documented in the test comments; serial file. |
| 15 | blind-hunter | Render spec fixture untyped (`as never`) | low | reject | Test-only typing; no named breakage. |
| 16 | blind-hunter | Render spec lacks saved-session, attendanceError, skill-form cases | low | reject | Covered by e2e (`teacher.e2e.ts`, `teacher-mobile.e2e.ts`). |
| 17 | blind-hunter | Render spec finds EnrollmentPanel by an exact string | low | reject | Fails loudly if it drifts. |
| 18 | blind-hunter | Session select sets its value by `bind:value` and `selected` | low | reject | `selected` serves SSR; no breakage. |
| 19 | blind-hunter | Planning files missing from the diff | false | reject | Excluded on purpose; the spec is the claims file. |
| 20 | edge-case | Spec names `teacher/students/[studentId]/badges`; the route is `teacher/classes/[id]/students/[studentId]/badges` | low | reject | True, but the fix edits this build's spec (rule). Noted here for readers. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone, standing: open a class, pick today's session, mark attendance one-handed and save; set a skill level.
