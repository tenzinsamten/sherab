---
title: 'B8b — iX form fields, part 2b: teacher class page and homework (#66)'
type: 'refactor'
created: '2026-09-29'
status: 'done'
baseline_commit: '24830b5acbf53ff02c4f87d6364b96f7ffcadc95'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The teacher class page (attendance session select, per-student skill level + notes) and the homework new/edit forms still use native fields, so they look inconsistent with the iX UI (#66). This completes #66.

**Approach:** Convert them to iX (`ix-select`, `ix-input`, `ix-textarea`, `ix-date-input`, `ix-number-input`, `ix-radio-group`/`ix-radio`, `ix-checkbox`), keeping field names, posted values and server actions. Reuse `src/lib/ix-fields.ts` and the B7/B7b/B8a patterns.

**Decisions:** 2026-09-28 — per-student skill fields become collapsible student rows: each student is a one-line row (name + current level per skill area, e.g. "Language: Learning · Song: No entry yet · Dance: Confident"); expanding it shows the three skill forms (level + notes + Save) and the student's history. A row's forms render only once it has been opened and stay mounted (hidden) when collapsed, as on /calendar. B8 split: this is B8b.

## Boundaries & Constraints

**Always:** Same `name`s and posted values (`mode` once/weekly, `targetMode` all/subset, one `studentIds` entry per ticked student, dates `YYYY-MM-DD`, `dueOffsetDays` number, `level`/`notes` per student×area). Visible labels. The attendance leave pills follow the chosen session live. After a successful skill save the level select is back on its placeholder and notes are empty; after a successful homework edit the fields show the saved values. Unsaved edits are not overwritten by another form's save. Radio groups support arrow keys (iX default).

**Never:** No server, schema or migration changes. Hidden inputs stay native. No change to the attendance `ix-checkbox`es or `LinkRows`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pick session | choose another session in `#sessionId` | leave pills update for that session; attendance posts that `sessionId` | N/A |
| After attendance save | save for session S | select stays on S | N/A |
| Skill save | expand student, set Song = Confident + note | posts `studentId`, `skillArea=song`, `level=confident`, `notes`; summary shows Song: Confident; select back to placeholder, notes empty | server error → toast |
| Skill save empty level | Save with no level picked | nothing sent; select invalid with an inline, announced message | N/A |
| Many students | class with ~40 students | page renders promptly; rows collapsed | N/A |
| Homework once, subset | mode once, due date, subset with 2 students | posts `mode=once`, `dueDate`, `targetMode=subset`, two `studentIds` | empty subset → server toast |
| Homework weekly | mode weekly, start date, offset 7 | posts `mode=weekly`, `startDate`, `dueOffsetDays=7` | N/A |
| Homework edit | change title and offset, save | saved; form shows the new values | server error → toast, edits kept |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/classes/[id]/+page.svelte` -- attendance (153-190): `#sessionId` native select `bind:value={selectedSessionId}` (161-165); `$effect.pre` reselect (47-52); `leaveFor()` (55-57) reads it → `ix-select` with `onvalueChange`, value via `ixValue`/`{#key}` (ix-select takes its form value only on load). Skills (192-306): `<table>` of students × areas, one `?/setSkillStatus` form per cell (221-249: hidden studentId/skillArea, select `level` with disabled placeholder, text `notes` + `#notes-hint-{sid}-{area}`), history `<details>` (252-299). Helpers 13-42: `skillAreas`, `skillLevels`, `skillLabel`, `levelLabel`, `currentLevel`. Toasts in `$effect` 70-86. Replace the table with collapsible rows (pattern: `src/routes/calendar/+page.svelte` 94-104 sets + toggle, 539-563 disclosure button in `h3` with `aria-expanded`/`aria-controls` set only when the panel exists, summary span, form kept mounted `hidden`).
- `src/routes/teacher/classes/[id]/homework/new/+page.svelte` -- `#title`, `#skillArea` (3 options, no placeholder), `#description` (2000), radio `mode` (`bind:group`, drives once/weekly `{#if}`), `#dueDate`, radio `targetMode` (drives subset list), native `studentIds` checkboxes, `#startDate`, `#dueOffsetDays` (0–365, default 7). Success redirects; failure toast, typed values stay.
- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.svelte` -- edit form in `<details>` (118-193): `#edit-title-{id}`, `#edit-description-{id}`, `#edit-offset-{id}` (recurring only), `pending.submit('edit')`, stays mounted → values via `ixValue`.
- iX: `ix-radio-group` is not form-associated, sets children's `checked` from `value`, emits `valueChange` but doesn't update its own `value` → `value={mode}` + `onvalueChange`; each `ix-radio` needs `name` and `value`. `ix-checkbox name="studentIds" value={id}` posts one entry each. `ixFieldError(errorId, describedBy)` needs `novalidate`; use `describedBy` for `#notes-hint-*`.
- Messages: `roster_skill_*`, `roster_level_*`, `roster_no_entry_yet`, `roster_level_placeholder`, `roster_notes_*`, `homework_mode_*`, `homework_target_*` (messages/en.json 176-191, 241-246).
- Tests: no e2e or server spec covers skills or homework; `page.server.spec.ts` covers `markAttendance` only. Fixtures (`e2e/fixtures.ts`) have a teacher linked to classes A/B.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- `#sessionId` → `ix-select` driving `selectedSessionId`; skill table → collapsible student rows with summary; per-area `ix-select` (placeholder) + `ix-input` notes (hint linked), empty-level submit blocked with inline message (as `EnrollmentPanel`), fields cleared after a successful save (remount)
- [x] `src/routes/teacher/classes/[id]/homework/new/+page.svelte` -- convert fields; `ix-radio-group`s for mode/target; `ix-checkbox` subset list; `dueOffsetDays` default 7
- [x] `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.svelte` -- convert edit fields with `ixValue`
- [x] `e2e/teacher.e2e.ts` (new) -- session pick updates leave pills; skill save posts and updates the summary, fields cleared, empty level blocked; ~40-student class renders collapsed rows; homework create once+subset and weekly (captured posts or DB); homework edit saves and shows new values
- [x] `_bmad-output/manual-verification-issues.md` -- #66 part 2b "fixed, to verify"; #66 complete

**Acceptance Criteria:**
- Given any B8b form, when submitted, then the server receives the same names and values as before and `page.server.spec.ts` passes unchanged.
- Given a keyboard user on the homework form, when they use arrow keys in the mode group, then the choice changes and the matching fields appear.

## Implementation Notes

- 2026-09-29 matrix audit: added `e2e/teacher.e2e.ts` tests "homework create: an empty subset shows the server error and keeps the typed title" (Homework once, subset → empty subset → server toast) and "homework edit: a server error shows the toast and keeps the typed values" (Homework edit → server error → toast, edits kept; offset 400 is rejected by `editAssignment`). Both pass on a freshly reset DB.

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | E1 + E4 + B4: after an attendance save, picking another session is reverted to the saved one and the select remounts | high | new `$effect.pre` reads `selectedSessionId` unconditionally, so it re-runs on every pick while `form.sessionId` is set; baseline only read it in the `else` branch | patch |
| 2 | B1: skill-save server error (matrix "server error → toast") untested | medium | no test for a failed `setSkillStatus`; matrix audit gap | patch |
| 3 | V2: homework edit keeping unsaved edits across another action on the page untested | medium | edit tests only save/fail the edit form itself; `markDone`/`archiveInstance` reload data | patch |
| 4 | B11 + E2: focus is moved after a skill save even if the row was collapsed or the user is typing elsewhere | low | `focusField` runs unconditionally after success; direct guard | patch |
| 5 | B9 + E3: `roster_col_student` now unused in en/de/bo | low | only use was the removed table header; `roster_view_history` is still used on the parent page | patch |
| 6 | B8: e2e cleanup `ids.indexOf(parentId)` can be -1 | low | direct guard | patch |
| 7 | V1: e2e is not part of the reset/test/check/build rule | low | process-level (memory/CI), not caused here; every build in this batch ran e2e on a fresh DB anyway | defer |
| 8 | V3: skill double-submit guard untested | low | needs a delayed-route timing test; harm is a duplicate history row | rejected |
| 9 | B2: subset students not checked in the DB | low | the POST carries both `studentIds`; server unchanged | rejected |
| 10 | B3: create-form required fields not tested for empty submit | maybe-false | server validates title/dates with a toast; would be low | rejected |
| 11 | B5: `onSessionPick` may set '' on an empty pick | maybe-false | single-mode `ix-select` without allowClear gives no empty pick; would be low | rejected |
| 12 | B6 + B7: e2e fixture random years / broad schedule could touch another run's data | low | only on a shared DB used by parallel runs; suites run serially on a reset DB | rejected |
| 13 | B10: long accessible names on the row toggles | low | carried: same pattern accepted for /calendar rows (B7 triage #42) | rejected |
| 14 | B12: many identical "Save" buttons | false | baseline table had the same per-cell "Save" | rejected |
| 15 | B13: notes label taken from a placeholder message | false | the text is "Notes (optional)" / "Notiz (optional)", a proper label | rejected |
| 16 | B14 + B15: weekly test doesn't switch back; fragile locators | low | test style only | rejected |
| 17 | B16: spec Code Map line numbers now stale | false | the Code Map records the pre-change state by design | rejected |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
