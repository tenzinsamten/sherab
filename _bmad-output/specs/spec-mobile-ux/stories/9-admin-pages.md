---
title: 'Admin pages'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
baseline_commit: 'db700098cbe2515e3dcd690911276f79ffff1691'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin dashboard, classes, class students, syllabus list and detail, parents and teams pages are still iX. Inside the new shell they show iX tables, pills, inputs and modals, and on a tablet the tables scroll sideways (SPEC CAP-8).

**Approach:** Move each page to a `data-ui="new"` root using `ui.*` page classes. Use the Requests table pattern, which is stacked cards below `xl` (80em) and a full table from `xl`. Rebuild the two admin-only iX field components, `LocalizedNameFields` and `BadgeSubjectSelect`, on the new system. Every admin action that exists today stays reachable.

## Boundaries & Constraints

**Always:**
- Keep every posted field, action and result-driven behaviour:
  - Classes: `?/create`, `?/rename` (inline per row via `editingId`), `?/delete` (only when the class has no approved or pending students).
  - Teams: `?/create`, `?/rename`, `?/delete` (only with no members).
  - The class students and syllabus actions stay in the components rebuilt in story 8.
- Keep every toast, confirm message, link, pill meaning (subject not set, pending count, parent status, current year), zero-value muting on dashboard tiles, the parents load-error message, the `/requests` links and the team name's link and `title` to `/teams/[teamId]`.
- Delete class and Delete team use `createConfirm` + `ConfirmDialog` as `destructive`.
- Buttons and fields are ≥44px (`ui.touch`) and labels are visible. At ≤820px there is no sideways scroll. At ≥1280px the pages show full tables with the side nav.
- Decided (user, 2026-10-21): `/admin/teachers` is split off to story 9b and stays iX here.
- Decided (user, 2026-10-22): a missing class or team name keeps today's error toast; the server's single `error` string names no field, and server changes are out of scope.

**Never:**
- No server, load, action, route, permission, message-key or tour-registry changes. A new message key is allowed only for a screen-reader-only label that the card layout needs.
- No iX element, `$lib/ix-fields`, `confirmWith`/`confirmAction` or page `<style>` left in the in-scope pages, `LocalizedNameFields` or `BadgeSubjectSelect`. `showToast` from `$lib/ix` stays until story 10.
- No change to `/admin/teachers` and no removal of iX or its global page CSS (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create class | Names (en/de/bo), subject, schedule | Created toast, row appears, form clears, class code copyable | Missing subject → error under the field; missing name → the existing error toast; nothing saved |
| Create team | Names | Created toast, row appears, form clears | Missing name → the existing error toast, nothing saved |
| Rename class/team | Edit, change names, Save | Row shows new names, toast | Cancel → nothing posted, edit closes |
| Delete class/team | Delete, confirm (red) | Row gone, toast | Cancel → nothing; button absent when students or members exist |
| Parents | Mixed statuses, load error | Status badges, children listed, pending → Requests link | Load error → danger message; none → empty state |
| Fit | 375 / 820 / 1440px, en/de/bo | Cards below 80em and table from 80em; no sideways scroll at ≤820px | — |

</frozen-after-approval>

## Code Map

- `src/routes/admin/+page.svelte` (88): 6 `ix-card` tiles (3 links, 3 passive, `valueClass` muting). Becomes `ui.tileLink` / `ui.card` + `ui.stat`.
- `src/routes/admin/classes/+page.svelte` (331): `ix-button`, `ix-pill warning`, `<table>` in `.table-wrap`, hidden delete form :307, page `<style>`. Uses `CopyField` and `ScheduleFields` (new; `idPrefix="new-class"`).
- `src/routes/admin/teams/+page.svelte` (214): `ix-button`, inline rename, hidden delete form. The name links to `/teams/[teamId]` (`team-students.e2e.ts:271` relies on its `title`).
- `src/routes/admin/parents/+page.svelte` (104): `ix-message-bar danger`, `ix-empty-state` → `EmptyState`, `ix-pill` → `Badge`.
- `src/routes/admin/classes/[id]/students/+page.svelte` (42): `ix-empty-state` only. `EnrollmentPanel` moves inside the root.
- `src/routes/admin/classes/[id]/syllabus/+page.svelte` (38), `.../[syllabusId]/+page.svelte` (45): copy `teacher/classes/[id]/syllabus/**` from story 8. The current year becomes `Badge success`.
- `src/lib/components/LocalizedNameFields.svelte`, `BadgeSubjectSelect.svelte`: iX (`ix-input`/`ixValue`, `ix-select`/`ixFieldError`). Used only by admin classes and teams. Rebuild them with their own `data-ui="new"` root, keeping ids (`name`, `name-de`, `name-bo`, `{idPrefix}-subject`) and field names.
- Patterns:
  - Table constants: `src/routes/requests/+page.svelte:282-302`.
  - Fields: `ScheduleFields.svelte` (`Label`, `Input`, `NativeSelect`, `ui.error`).
  - Root and `data-hydrated`: `teacher/classes/[id]/syllabus/+page.svelte`.
  - Page classes in `src/lib/ui/classes.ts`; confirms in `src/lib/confirm.svelte.ts`.
- `src/lib/ui/tailwind.css` `@source` list (~29–101): add the admin routes and the two components.
- e2e to update:
  - `forms.e2e.ts` (`openForm` ix wait ~80, teams 299–400, rename 453, classes 581–610): `#name input`, `ix-input[name=…] input`, `ix-select-item`, `ix-modal`, `.page-counter`.
  - `calendar.e2e.ts:762-900` (class create), `teacher-mobile.e2e.ts:1646` `openAdminPage` and its "admin hosts (still iX)" block at 1873–1990.
  - Conditional `ix-button` waits in `syllabus-sections.e2e.ts:47,156` and `syllabus-files.e2e.ts:131,167`.
  - `ix-visual.e2e.ts:96-157`: retire the `admin-classes-*` snapshots, as story 7 did.
- Do not change: `admin/teachers/**`, `admin/**/+page.server.ts`, `messages/*.json` keys, `ix-toast` locators, the teachers tests in `forms.e2e.ts` and `parent-access.e2e.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/LocalizedNameFields.svelte`, `BadgeSubjectSelect.svelte` -- rebuild on `Label`/`Input`/`NativeSelect` with `ui.error`, keep ids and names -- admin-only iX fields.
- [x] `src/routes/admin/+page.svelte`, `parents/+page.svelte` -- new root, tiles, badges, empty state, Requests-style table -- read-only pages.
- [x] `src/routes/admin/classes/+page.svelte` -- table/cards, inline rename, `createConfirm` delete, no `<style>` -- CAP-8.
- [x] `src/routes/admin/teams/+page.svelte` -- same pattern as classes -- CAP-8.
- [x] `src/routes/admin/classes/[id]/students/+page.svelte`, `syllabus/**` -- new root, `EmptyState`, `Badge` -- thin hosts.
- [x] `src/lib/ui/tailwind.css` -- `@source` lines -- the classes are collected.
- [x] `e2e/*` listed above -- native selectors and `confirm-dialog`, drop the admin ix waits, add 375/820/1440 fit checks for these pages -- regression net.
- [x] `src/routes/admin/classes/page.render.spec.ts`, `admin/teams/page.render.spec.ts` -- render specs (row actions present, destructive confirm, delete absent with students or members), copying `teacher/classes/[id]/page.render.spec.ts` -- matrix edge cases.

**Acceptance Criteria:**
- Given an admin at 1440px, when they open any in-scope page, then they see the side nav and a full table where there is one, and no `ix-*` element renders inside `main`.
- Given an admin at 820px, when they open classes or teams, then rows are cards, every row action is reachable, and `scrollWidth ≤ clientWidth`.
- Given the existing admin e2e flows, when the suite runs after reset, then they pass with only selector changes.

## Design Notes

- Tables: copy the Requests class-string constants into each page rather than adding a shared Table component. This matches house style (Requests, homework review); 9b can extract one if a third copy appears.
- Native fields reset with the form, so any `{#key}` remount kept for iX can go.

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all exit 0.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: all pass except the known Reset PIN and B14b failures.

**Manual checks:**
- On an iPad at 820px and a laptop at 1440px in en and bo: create, rename and delete a class and a team; open parents and a class's students and syllabus.

## Implementation Notes

- A missing name keeps the existing toast (user decision 2026-10-22). The server returns one `error` string that names no field. The subject error shows under its select with `aria-invalid` and `aria-describedby`.
- `ScheduleFields` keeps its `{#key form}` remount on the classes create form. Its defaults aren't empty (Sunday, from today), so they come from props rather than from form reset. The name and subject fields drop their remounts, because native fields reset with the form.
- Delete now uses a form per row, posting the same fields as the old hidden form. The confirm is written inline in the template (`confirm: () => confirm.ask(…cls.label…)`) so that it reads the row's current name at submit time. A helper that takes the row captures the old label at mount, which the new rename-then-delete e2e caught.
- In card layout each value carries its column name (`cardLabel`, hidden from 80em). The Code label is `aria-hidden` because `CopyField` labels itself. The parents email cell has its own `tdEmail` with `wrap-anywhere` only.
- New test hooks: `page-counter`, `class-row`, `class-edit-row`, `class-create`, `class-list`, `team-row`, `team-create`, `team-list`, `dashboard-tiles`, `tile-value`.
- Render specs: `admin/page.render.spec.ts`, `admin/classes/page.render.spec.ts`, `admin/teams/page.render.spec.ts`, `admin/parents/page.render.spec.ts`. `ix-visual.e2e.ts` drops the admin-classes shots and their PNGs, as story 7 did.
- Verified 2026-10-22 after a reset: `npm test` 98 files, 1574 tests; check, eslint, Prettier and build exit 0; e2e 352 passed, 4 skipped, 1 failed (the known Reset PIN, `teacher.e2e.ts:1284`).

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | edge-case | Class Delete dialog names the old class after an in-place rename | medium | patch | `deleteConfirm(cls)` runs when `use:enhance` mounts and enhance has no update, so `confirm.with` keeps the old message; the iX version read `deleteTarget` at click time. |
| 2 | edge-case | Same for team Delete | medium | patch | Same defect as #1 in `teams/+page.svelte`. |
| 3 | edge-case | Parents email cell: `wrap-break-word` overrides `wrap-anywhere` | low | patch | Built CSS has `.wrap-anywhere` at 239017 and `.wrap-break-word` at 239065, both `!important`, so the later one wins; drop it from that cell. |
| 4 | edge-case | Teams create echo goes to '' on another action's result and overwrites retyped names | low | reject | Needs a failed create, then retyping, then another row action before submitting; the iX `ixValue` attach did the same (pre-existing). Fix adds state. |
| 5 | edge-case | Render specs don't prove the confirm is destructive | low | reject | SSR specs can't open the dialog; the e2e checks the dialog's own Confirm button (`confirmDelete`, `ConfirmDialog.svelte:27` variant from `question.destructive`). |
| 6 | blind-hunter | Table class strings copied into three more pages | low | reject | Deliberate per Design Notes (house style, Requests and homework review); fixing it means editing the spec. |
| 7 | blind-hunter | `BadgeSubjectSelect` sets selection via `value` and option `selected` | false | reject | No bad outcome: `calendar.e2e` asserts `#new-class-subject` is empty after create, and edit rows close on success. |
| 8 | blind-hunter | Every row's Edit/Delete has the same accessible name | low | defer | Pre-existing: the iX buttons had the same labels; adding row names to labels is a new a11y pattern. |
| 9 | blind-hunter | Inline edit moves no focus and returns none on Cancel/Save | low | defer | Pre-existing in the iX page; needs focus management across rows. |
| 10 | blind-hunter | German and English name inputs have no `lang` | low | reject | Pre-existing (the iX fields set only `bo`, which drives the Tibetan font); no user report. |
| 11 | blind-hunter | de/bo fit not run at 1440px; comment says 375px | low | patch | The loop covers 375/820 only; long German headers in the full table at 1440px are untested. Adding the viewport is direct. |
| 12 | blind-hunter | 821–1279px untested | low | reject | Not in the matrix; cards apply below 80em, same CSS as at 820px. |
| 13 | blind-hunter | Admin screenshot baselines removed, none added | low | reject | Same as story 7; fit checks replace them until story 10. |
| 14 | blind-hunter | Dashboard has no test | medium | patch | Same as #17. |
| 15 | blind-hunter | 1440px `thead` check depends on seeded rows | false | reject | `supabase:reset` seeds classes, teams and parents deterministically, and the suite passed after a reset. |
| 16 | blind-hunter | Spec Implementation Notes empty, task list misses parents spec, "token gate" vs "scope gate" | low | reject | Spec edits; Implementation Notes are filled at the end of this step. |
| 17 | verification-gap | Dashboard tiles, links and zero muting untested | medium | patch | Pre-verified: no `admin/page.render.spec.ts`, and `dashboard-tiles`/`tile-value` are not asserted for `/admin`. |
| 18 | verification-gap | Edit row's subject error never rendered in a test | medium | patch | Pre-verified: only the create form's error is checked; "Not set" now makes the edit error reachable. |
| 19 | verification-gap | Class students empty roster untested | low | defer | Pre-verified; filed as defer (one-branch host swap). |
| 20 | blind-hunter | Team missing-name test checks only the Tibetan name; redundant `fill` | low | reject | Same server path as the English case, already asserted for classes. |
| 21 | blind-hunter | Card labels: only Code is `aria-hidden`; parents has no Email/Status labels | low | reject | `CopyField` labels itself (hence hidden); email and status are self-describing values. |
