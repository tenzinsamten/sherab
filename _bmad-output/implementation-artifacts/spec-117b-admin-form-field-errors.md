---
title: 'Admin create and rename forms show their errors at the field (#117b)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
baseline_commit: '9e2de639b13b7cac8ecca5f3a6b2ae90baef9efd'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the admin class, team and teacher pages, a failed create or rename shows its error only as a 5-second toast; no name, email or class field is marked and nothing stays in the form (deferred from #117).

**Approach:** As #117 did for the sign-in pages: the error also stays in the form that was submitted, under the field it belongs to (`aria-invalid`, `aria-describedby`), or above that form's submit button when it belongs to no one field. The toast stays; the inline message has no `role="alert"` (decided in #117: the toast announces it once).

## Boundaries & Constraints

**Always:** Messages use `ui.error`, ids `<input id>-error` (form-level: `<form prefix>form-error`), so per-row rename forms never share ids. A rename error shows only on the row whose id the action returned (`renameId`). A duplicate-name error goes under the name field whose submitted value it names (English, Tibetan or German). The message goes away when `form` changes (next submit). `BadgeSubjectSelect` and `ScheduleFields` keep their own inline errors as they are.

**Never:** No change to the actions, their texts or the root layout toast. The teachers' per-row class edit (`updateClasses`), Reset password and Remove, and class/team Delete stay toast-only (button actions, server failures). No new message keys. No pending states (#118).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Class/team create, no English name | `*_error_name_required` | under `name`, marked | toast too |
| Class/team create, no Tibetan name | `*_error_name_bo_required` | under `name-bo`, marked | toast too |
| Duplicate name | `*_error_duplicate_name({ name })`, name equals the submitted Tibetan | under `name-bo`, marked | toast too |
| Class create code failed / save failed / create failed | form-level text, or a raw server message | above that form's button, no field marked | toast too |
| Rename error | rename of row B fails (`renameId` = B) | message and marking only in row B, ids `edit-{B}-…`; nothing in the create form | toast too |
| Teacher create, no email / duplicate / parent pending | as named | under `email`, marked | toast too |
| Teacher create, no class | `teachers_error_class_required` | under the classes fieldset, fieldset `aria-describedby` | toast too |
| Teacher create failed / assign or promote failed | as named | above the create button | toast too |
| Promotable parent | 409 `promotable`, no `error` | the confirm dialog as today, no inline message | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/(auth)/register/+page.svelte` -- #117's pattern: `errorText`, `errorAt` mapping by `m.*()` comparison, `invalid(id)`, `describedBy(id)`, an `error(at)` snippet.
- `src/lib/components/LocalizedNameFields.svelte` -- props `label`, `idPrefix`, `values`; ids `${idPrefix}name`, `name-bo`, `name-de`. Add an optional `error?: { field: 'name' | 'nameBo' | 'nameDe'; text: string }` (or similar) that marks that input and renders `<p id="{input id}-error">` under it. Used only by admin classes and teams.
- `src/routes/admin/classes/+page.server.ts` -- `nameRequiredMessage` l.29-34 (`classes_error_name_required` → `name`, `classes_error_name_bo_required` → `nameBo`); create fails l.99 (literal `'Not signed in.'`, form-level), l.114 (`error` only when a name error; `subjectError`, `scheduleErrors` already inline), l.156 duplicate (`duplicateName()` in `src/lib/server/localized-names.ts:32` picks the colliding value), l.168 code generation or raw message; rename l.200, l.216, l.223 with `renameId`, `renameValues`.
- `src/routes/admin/classes/+page.svelte` -- create form l.182-226 (names without prefix, `BadgeSubjectSelect id="new-class-subject"`, `ScheduleFields idPrefix="new-class"`); rename rows l.352-401 (`edit-{id}-` prefix, `editingId` client state, `editValues()` l.70-88 matches `form.renameId`); create values kept via `lastCreate` l.113-128 — a create error must not show in a rename row and vice versa.
- `src/routes/admin/teams/+page.server.ts`, `+page.svelte` -- same shape: create l.48/61/67, rename l.81/92/99; create form l.108-131, rename rows l.229-275 (`idPrefix="edit-{team.id}-"`).
- `src/routes/admin/teachers/+page.server.ts` -- create l.66 (email), l.69 (classes), l.104 (raw or `teachers_error_create_failed`), l.124 assign; `promoteExistingParent` l.264 duplicate, l.265 parent pending (email), l.286 409 promotable, l.296/308 form-level.
- `src/routes/admin/teachers/+page.svelte` -- create form l.206-254 (`#email`, `#displayName`, classes fieldset snippet l.159-173), values via `createdEmail` etc. l.90-98.
- Tests: `admin/{classes,teams,teachers}/page.render.spec.ts` (server render, as `src/routes/(auth)/form-errors.render.spec.ts` does for #117); `e2e/forms.e2e.ts:585` failed class create, `:663` teacher create.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/LocalizedNameFields.svelte` -- optional error for one of its inputs: mark it, describe it, render the message under it.
- [x] `src/routes/admin/classes/+page.svelte` -- map create and rename errors per the matrix; create errors only in the create form, rename errors only in row `renameId`; form-level message above each form's button.
- [x] `src/routes/admin/teams/+page.svelte` -- same.
- [x] `src/routes/admin/teachers/+page.svelte` -- create errors per the matrix (email, classes fieldset, form-level); promotable unchanged.
- [x] `src/routes/admin/{classes,teams,teachers}/page.render.spec.ts` -- one render per matrix row: message placement, `aria-invalid` / `aria-describedby`, no `role="alert"` on the new messages, rename error only in its row.
- [x] `e2e/forms.e2e.ts` -- in the failed class create and teacher create tests, also assert the inline message and the marked field.

**Acceptance Criteria:**
- Given a duplicate team name on create, when the toast has gone, then the message is still under the name field that collided and that field is marked invalid.
- Given a failed class rename while the create form holds a typed name, when the page updates, then the message shows in the rename row only, and a later failed create shows in the create form only.
- Given the page under Tibetan, when an error shows, then the inline message is the Tibetan text.

## Implementation Notes

- Implementation (agent): `nameErrorField()` in `src/lib/localized-name.ts` maps a class/team save error to `name`, `nameBo`, `nameDe` or null (form-level) by text; `LocalizedNameFields` takes `error?: { field, text }`. Create results are recognised by the echoed names (classes also the literal 401 `'Not signed in.'`), teacher create results by the echoed `email`; delete, update, reset and remove echo neither, so they stay toast-only. `editingId` starts from `form.renameId`, so a no-JS render after a failed rename opens that row. Identical English and Tibetan names: a duplicate goes under English.
- Unrelated in the same tree: the user's own Tibetan edits to `messages/bo.json` (77 texts), committed separately.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind + edge + verification-gap | Duplicate goes under the first field with an equal value when two names are identical | low | Real only when two languages hold the same text and the later one collides; the exact field needs the server to return it, which the spec rules out (no action changes) | reject |
| 2 | blind | Name/email errors have no `role="alert"`, subject and schedule errors do | false | The subject and schedule errors are not in the toast (`error` is only the name error), so each error is still announced once; the spec keeps those components as they are | reject |
| 3 | blind | Render specs check no `role="alert"` on the whole page | low | Test maintenance only; fixtures without subject/schedule errors are deliberate | reject |
| 4 | blind | `'Not signed in.'` matched by English literal | low | Pre-existing English server text; an admin reaching the form signed out is rare; falls back to toast-only | reject |
| 5 | blind | Raw database/auth text now stays on the page | low | The same text was already shown in the toast, to the admin only; mapping raw messages is a server change (pre-existing) | defer |
| 6 | blind | Same helpers copied in classes and teams | low | No named divergence; mapping already shared in `nameErrorField` | reject |
| 7 | blind | `nameErrorField` has no direct unit test | low | Every branch pinned through the render specs (verification-gap layer) | reject |
| 8 | blind | e2e uneven across pages | low | Render specs cover each matrix row; verification-gap layer found no gap | reject |
| 9 | blind + edge | Old error stays after Cancel or reopening the row | low | Matches the frozen rule (goes away when `form` changes) | reject |
| 10 | blind | Loose types, generic ids `classes` / `form-error` | false | Each id occurs once on the teachers page; no collision | reject |
| 11 | edge | Raw auth message about the email shown above the button | low | Unknown texts fall back to form-level by design; mapping needs server codes | reject |
| 12 | edge | Rename error for a row deleted meanwhile has no inline home | low | Rare race; the toast still shows it | reject |
| 13 | verification-gap | Classes test title claims a rename-then-create case it does not render | low | Misleading for developers; direct rename | patch |
