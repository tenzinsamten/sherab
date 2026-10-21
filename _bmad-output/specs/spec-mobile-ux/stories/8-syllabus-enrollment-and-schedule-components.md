---
title: 'Syllabus, enrollment and schedule components'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
baseline_commit: '64f299c6cb734980b202e9aef322e100c385382a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The syllabus components (`SyllabusList`, `SyllabusForm`, `SyllabusDetail`, the edit half of `SyllabusFiles`) and `EnrollmentPanel` are still iX. Teachers and admins use them on the class's syllabus pages, the teacher class page and `/admin/classes/[id]/students`. On a phone their buttons are small, their selects are iX, and their confirms are iX modals (SPEC CAP-2, CAP-3).

**Approach:** Rebuild the five components phone-first on the new system. Each gets its own `data-ui="new"` root, so the admin pages, which stay iX until story 9, keep working around them, as `ScheduleFields` (5b) and the 7c fields did. `confirmWith` / `confirmAction` become `createConfirm` + `ConfirmDialog`, and the PIN `ix-message-bar` becomes the Requests outcome box.

## Boundaries & Constraints

**Always:**
- Keep every posted field and action (`?/create`, `?/addSection`, `?/updateSection`, `?/moveSection`, `?/deleteSection`, `?/delete`, `?/uploadFile`, `?/replaceFile`, `?/deleteFile`, `?/enroll`, `?/unenroll`, `?/resetPin`), every pending key, every toast and confirm message, and every result-driven behaviour: a section opens after add or failed save and closes after save, the title error sits under its field, a cancelled failure's error is not shown again, `?deleted=` gives one toast, the add form clears after add, the 1 MB check runs before upload, Replace posts when a file is chosen, the upload field is hidden at 5 files, an empty enrol shows its error without posting, and the one-time PIN box scrolls into view.
- Buttons and fields are ≥44px (`ui.touch`), labels are visible, and long titles and file names wrap without sideways scroll at 375px.
- The Delete section, Remove file, Remove student and Delete syllabus confirms are `destructive`.
- `SyllabusFiles`'s read-only half (the student page) stays as it is.
- Pages that host these components keep working for teacher and admin. On the teacher class page, `EnrollmentPanel` moves inside the page's new-UI root.
- Decided (user, 2026-10-21): the two teacher syllabus pages (`teacher/classes/[id]/syllabus/+page.svelte` and `.../[syllabusId]/+page.svelte`) move to the new UI here: `ui.page` root with `data-hydrated`, `PageBreadcrumb`, `ui.*` header, and the Current marker as a `Badge` (`success`).
- Decided (user, 2026-10-21): the enrol picker is a native select (`NativeSelect`), like the other migrated selects. There's no type-to-filter, and each option keeps today's label (name, username, other classes).

**Never:**
- No server, load, action, message or tour-registry changes.
- No iX element, `$lib/ix-fields`, `confirmWith`/`confirmAction` or `<style>` left in the five components. `showToast` from `$lib/ix` stays.
- No admin page migration (story 9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Add syllabus | Addable years, current year among them | Current year preselected; posts `schoolYear`, lands on the detail page | All years taken → its text, no form |
| Sections | Add "Song 1", edit, move down, delete | Add opens its form and clears the add field; Save closes it; move posts `direction`; delete asks (red) | Empty title → error under the field, nothing saved |
| Files | Upload a PDF; then > 1 MB; Replace; Remove | Upload lists it; > 1 MB refused before sending; Replace posts on choose; Remove asks (red) | Server refusal → message at that file or the upload field |
| Delete syllabus | Delete, confirm | `?/delete` posts, the list shows the one-time toast | Cancel → nothing |
| Enrol | Pick a student, Add to class | Enrolled, toast, field cleared and focused | Nothing picked → error under the select, no post |
| Remove / Reset PIN | Confirm | Remove posts `unenroll`; Reset PIN shows the PIN box, scrolled into view | Cancel → nothing |
| Fit | 375 / 820px, en/de/bo, teacher and admin hosts | No sideways scroll, targets ≥44px, no cut labels | — |

</frozen-after-approval>

## Code Map

- `src/lib/components/SyllabusList.svelte` (154): `ix-pill` current, `ix-select` year in `{#key initialYear}`, `ix-button`, `?deleted=` toast effect, `<style>`.
- `src/lib/components/SyllabusForm.svelte` (95): `ix-input` title with `ixValue`/`ixFieldError`, two `ix-button`s; posts with `reset: false`; hosts the 7c fields.
- `src/lib/components/SyllabusDetail.svelte` (318): `editingIds`/`cancelledResult`/`addKey` result logic (keep), `ix-icon-button` moves, Edit/Delete section, add form (`novalidate`, `ixFieldError`), `confirmAction` delete syllabus via hidden form, `<style>`.
- `src/lib/components/SyllabusFiles.svelte` (337): edit half :146-280 (`confirmWith` in `submitRemove`, `pick`/`chosen`, `submitFile`), `<style>`; read-only half :107-145 already new.
- `src/lib/components/EnrollmentPanel.svelte` (300): `ix-select` with `ixFieldError` and `focusSelect` (iX waits), `confirmAction` remove / reset PIN via hidden forms, `ix-message-bar` credential with `showCredential` (iX waits), `<style>`.
- Hosts: `teacher/classes/[id]/+page.svelte` (EnrollmentPanel after the root, comment :32), `teacher/classes/[id]/syllabus/**`, `admin/classes/[id]/syllabus/**`, `admin/classes/[id]/students/+page.svelte`, `student/classes/[classId]/+page.svelte` (read-only files).
- Patterns: `ScheduleFields.svelte` (own root, `Label`/`Input`/`NativeSelect`, `ui.error`), `requests/+page.svelte:351-367` (outcome box with `CredentialFields`), `requests/+page.svelte:283-312` (`spinner` snippet, `confirm.with(…, { destructive })`), `homework/[assignmentId]/+page.svelte` (7c).
- `src/lib/ui/tailwind.css`: add `@source` for the five components (`SyllabusFiles` is already listed) and the teacher syllabus pages (`teacher/classes/*/syllabus/**/*.svelte`).
- e2e: `syllabus-sections.e2e.ts` (288), `syllabus-files.e2e.ts` (679; `ix-modal` :303, :600-642, `customElements` wait :160), `forms.e2e.ts` :80-290 (syllabus add, enrol `ix-select`), `teacher.e2e.ts:1284` (Reset PIN, `.member-list`, `ix-modal`), `breadcrumbs.e2e.ts`, `teacher-mobile.e2e.ts` (`expectFits`, `toast`).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/SyllabusList.svelte`, `SyllabusForm.svelte`, `SyllabusDetail.svelte`, `SyllabusFiles.svelte` (edit half) -- rebuild on the new UI, each in its own root; `SyllabusDetail` owns one `createConfirm` + `ConfirmDialog` and passes it to `SyllabusFiles` -- the syllabus editor.
- [x] `src/lib/components/EnrollmentPanel.svelte` -- rebuild with a native select, `ConfirmDialog` and the outcome box -- class members.
- [x] `src/routes/teacher/classes/[id]/+page.svelte` -- move `EnrollmentPanel` inside the root and update its comment -- one UI per page.
- [x] `src/routes/teacher/classes/[id]/syllabus/+page.svelte`, `.../[syllabusId]/+page.svelte` -- the new-UI page frame (pattern: `teacher/classes/[id]/homework/+page.svelte`) -- the teacher's syllabus fully on the new UI.
- [x] `src/lib/ui/tailwind.css` -- the `@source` lines.
- [x] `e2e/syllabus-sections.e2e.ts`, `syllabus-files.e2e.ts`, `forms.e2e.ts`, `teacher.e2e.ts` -- swap the iX locators and `ix-modal` for native ones and `confirm-dialog` -- keep the coverage.
- [x] `e2e/teacher-mobile.e2e.ts` -- a syllabus and members block for each matrix row at 375 and 820px, an admin-host check at 1440px, and the en/de/bo fit check -- a regression net.

**Acceptance Criteria:**
- Given an admin on `/admin/classes/[id]/syllabus/[syllabusId]` and `/admin/classes/[id]/students` (still iX pages), when they add, edit and delete a section, upload a file and enrol a student, then each works as before.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

- Implemented by a subagent from this spec. It reported: unit 1558 passed; check, eslint, Prettier and build clean; e2e 341 passed, 4 skipped, 1 failed (the known Reset PIN test).
- `SyllabusForm`'s title field now carries `lang` = the chosen content language, as the homework edit form does.
- `addKey` is gone: the add-section form posts with the default reset, so a successful add clears it and a failure keeps the text. `EnrollmentPanel` holds the picked student in state and empties it after an enrol (the enrolled option disappears), then focuses the select.
- `SyllabusFiles` takes an optional `confirm` from `SyllabusDetail`. Remove-file and Delete-section now read the file name or title when they ask: the iX version captured it at mount, so after a Replace the question named the old file (found by the new test; the message text is unchanged).
- New test hooks: `section-title`, `section-edit`, `file-name`, `file-size`, `file-error`, `pin-credential`, `member-list`. `teacher-mobile.e2e.ts` gets an admin user in its fixture.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | Admin hosts never fit-checked at 375/820px | medium | patch | Pre-verified: admin pages only opened at 1440px, no scroll-width check; `expectFits` needs `main > [data-ui="new"]`. Matrix Fit row names admin hosts. |
| 2 | verification-gap (other) | A new regression in the Reset PIN test would hide behind the known failure | low | reject | True but no code change in scope; the PIN box is covered by the passing `class members` tests. |
| 3 | edge-case | `SyllabusFiles` Remove posts unasked when `confirm` is missing | medium | patch | `confirm?: Confirm`; `submitRemove` passes `confirm: undefined`. Only `SyllabusDetail` passes `pending` today, but nothing enforces it. |
| 4 | blind-hunter | Same as #3 | medium | patch | Same defect as #3. |
| 5 | edge-case | Enrolling the last student drops focus to body | low | patch | `{#if enrollable.length === 0}` unmounts the form; `focusSelect` finds nothing. Direct fallback. |
| 6 | blind-hunter | Same as #5 | low | patch | Same defect as #5. |
| 7 | edge-case | Failed enrol whose student vanished leaves a stale select value | low | reject | Needs another user to enrol that student between pick and post; the server refuses it. Fix adds an effect. |
| 8 | edge-case | Members test leaves enrolments behind on failure | low | patch | `finally` only closes the context; serial file. |
| 9 | blind-hunter | Same as #8 | low | patch | Same defect as #8. |
| 10 | blind-hunter | PIN scroll test passes without `scrollIntoView` | low | reject | Playwright scrolls the clicked button into view next to the box; a stronger test needs a contrived layout. |
| 11 | blind-hunter | ConfirmDialog never fit-checked at 375px | low | reject | Shared since story 5 and fit-checked on Requests/calendar there; not changed here. |
| 12 | blind-hunter | Long section title without spaces untested | low | patch | Seed always has spaces; changing the seed is direct. |
| 13 | blind-hunter | Render spec renamed "inside" but doesn't assert it | low | patch | Asserts order only. |
| 14 | blind-hunter | forms.e2e comment claims username/classes in option label are checked | low | patch | Only the name is asserted. |
| 15 | blind-hunter | `pending.svelte.ts` and `PageTour.svelte` comments still describe iX | low | defer | `pending` doc already deferred in 7c; PageTour's ix-modal note is pre-existing wording. |
| 16 | blind-hunter | `sm:mt-6.5` button alignment may drift under taller Tibetan labels | maybe-false | reject | Would only be low (cosmetic misalignment ≥640px); settle with a `bo` screenshot at 820px. |
| 17 | blind-hunter | Preselected year set twice in SyllabusList | low | patch | `value=` and `selected=` both set it; deletion. |
| 18 | blind-hunter | PIN live region mounts filled, may not be announced | low | reject | Same outcome-box pattern as Requests (story 5); changing it is a shared-pattern decision. |
| 19 | blind-hunter | Hydration wait and dialog locator duplicated across e2e files | low | reject | Each e2e file keeps its own helpers (house style). |

## Design Notes

- One `ConfirmDialog` per page: `SyllabusDetail` creates the confirm and passes it to `SyllabusFiles`, since `createConfirm` asks one question at a time.
- The delete-syllabus and members flows keep their hidden forms. `confirm.ask(…)` replaces `confirmAction`, then `tick()` + `requestSubmit()` as today.
- Native fields take part in form reset, so the `{#key}` remounts that existed for iX (`addKey`, `enrollKey`) can go: a successful post resets them. Focus still moves to the enrol field after an add.
- Without iX the `customElements.whenDefined` waits in `focusSelect` and `showCredential` go. The outcome box scrolls into view after `tick()`.

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone: add a syllabus section with a PDF, reorder, then enrol and remove a student on the class page.
