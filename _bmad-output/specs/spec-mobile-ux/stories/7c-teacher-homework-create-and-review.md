---
title: 'Teacher homework create and review'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
baseline_commit: '2eaff2ab27730cf9dde0353f704f3ca47e1ef5eb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The teacher's homework create page (`/teacher/classes/[id]/homework/new`) and review page (`.../homework/[assignmentId]`) are still iX. On a phone, the review table scrolls sideways, the fields and buttons are small, and the confirms are iX modals (SPEC CAP-2, CAP-3).

**Approach:** Rebuild both pages phone-first on the new system, together with their shared fields `LinkRows`, `ContentLanguageSelect` and `RichTextEditor`. Each field gets its own `data-ui="new"` root, so the iX syllabus forms (story 8) keep working, as `ScheduleFields` did in 5b. The review table turns into stacked cards below 80em, as on Requests, and `confirmWith` becomes `createConfirm` + `ConfirmDialog`.

## Boundaries & Constraints

**Always:**
- Keep every posted field name and value (create: `title`, `skillArea`, `contentLanguage`, `content`, `linkUrl`/`linkLabel`, `mode`, `dueDate`, `targetMode`, `studentIds`, `startDate`, `dueOffsetDays`; edit: `assignmentId`, the same content fields and `dueOffsetDays`; end: `archiveCopies`), all defaults (skill `language`, offset 7, content language = interface language) and `required`.
- Keep the per-row pending keys (`done:`, `reviewed:`, `archive:` + ids) and every confirm's message and OK label. End-series asks the archive question when the box is ticked. Archive and End are `destructive`.
- Keep `startDateNote` (#96) as the start-date field's description, and keep `pickMode` clearing the start date.
- The edit form keeps unsaved edits when another action reloads the page, and shows the saved values after a save.
- Each page has a `data-ui="new"` root (`ui.page`, `data-hydrated`) as a direct child of `main`, with `PageBreadcrumb`. Inputs and buttons are ≥44px (`ui.touch`), and labels are visible.
- Each review card keeps every column: due, done x/y, reviewed x/y, status badge, student list, actions. Badges: Archived `secondary`, Overdue `alarm`, Recurring `outline` with `RepeatIcon`.
- Tour targets `homework-language`, `homework-schedule`, `homework-due` and `homework-target` stay visible at 375, 820 and 1440px.
- `RichTextEditor` keeps its Tiptap behaviour, its hidden JSON field, its link panel and its toolbar labels. Its icons come from Lucide.

**Never:**
- No server, load, action, message or tour-registry changes.
- No iX element, `$lib/ix-fields`, `confirmWith` or `<style>` left in the two pages or the three components. `showToast` from `$lib/ix` stays.
- No change to `SyllabusForm`, `SyllabusDetail`, `SyllabusFiles` or the list page, except their e2e locators.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create one-off subset | Title, skill, content, due date, two students | Same POST as today; redirected to the list with its toast | Empty subset → server error toast, typed title kept |
| Create weekly | Pick Weekly, then a future start date | Note reads "from {date}"; switching mode empties the start date | Bad date → the generic note |
| Links | Add 3 rows, leave the middle URL empty | `linkUrl` posts `[a, '', c]`; remove the last row → one blank row | Max 10 → Add hidden |
| Review cards | 375 / 820px, instance with overdue student | Cards, no sideways scroll; ≥80em a table | No instances → empty text |
| Mark done / reviewed / archive | Tap, then confirm in ConfirmDialog | Only that row's button spins, the others are disabled, toast | Cancel → no POST |
| End series | Tick "archive copies", End | The archive question, then `archiveCopies=on` | Archive failure → warning toast |
| Fit | en, de, bo at 375px | Targets ≥44px, no cut labels | — |

</frozen-after-approval>

## Code Map

- `src/routes/teacher/classes/[id]/homework/new/+page.svelte` (213): iX fields :92-205, `pickMode`/`startDate`/`startDateNote` :31-58, `<style>` :207.
- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.svelte` (425): edit `<details>` :145-246 (`ixValue` keeps edits), five `confirmWith` calls :205, :225, :328, :357, :392, the table :256-414, the toast `$effect` :55-86 (keep it).
- `src/lib/components/LinkRows.svelte` (99), `ContentLanguageSelect.svelte` (45, `data-tour="homework-language"`), `RichTextEditor.svelte` (456: `ix-icon` toolbar, `ix-button` link panel, `<style>` using iX variables).
- Patterns to copy:
  - `ScheduleFields.svelte`: own `data-ui="new"` root, `Label`/`Input`/`NativeSelect`, native checkbox labels (`min-h-11 … has-checked:`), `ui.error`.
  - `parent/children/[id]/+page.svelte:698`: native radio rows.
  - `requests/+page.svelte:283-300`: table → cards (`table`/`thead`/`tr` consts, `role=` attributes), `spinner` snippet :308, `confirm.with(…, { destructive })`, `<ConfirmDialog {confirm} />`.
  - `RichText.svelte`: the content classes for the editor body.
- `src/lib/ui/tailwind.css` :83-87: add `@source` for `homework/new/+page.svelte`, `homework/[assignmentId]/+page.svelte` and the three components.
- e2e:
  - `teacher.e2e.ts`: the `open` helper :229 (waits on `ix-select`); `pick` :255; homework tests :648-1170 (`#title input`, `toHaveJSProperty('value')`, the `#dueDate input` fields).
  - `forms.e2e.ts`: :80-210 (`ix-select[name="contentLanguage"]`, `ix-input[name="linkUrl"]`, `.rte-input`).
  - `syllabus-sections.e2e.ts`: :85-116.
  - `tours.e2e.ts`: :493-530.
  - `teacher-mobile.e2e.ts`: reuse `expectFits`, `toast`, `classPath`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/LinkRows.svelte`, `ContentLanguageSelect.svelte`, `RichTextEditor.svelte` -- rebuild with native fields, `Button` and Lucide, each in its own `data-ui="new"` root, with no `<style>` -- shared by homework and syllabus.
- [x] `.../homework/new/+page.svelte` -- rebuild per Always/Never -- the create page.
- [x] `.../homework/[assignmentId]/+page.svelte` -- rebuild: cards below 80em, `createConfirm`, edit form posted with `reset: false` -- the review page.
- [x] `src/lib/ui/tailwind.css` -- the `@source` lines.
- [x] `e2e/teacher.e2e.ts`, `forms.e2e.ts`, `syllabus-sections.e2e.ts`, `tours.e2e.ts` -- swap the iX locators for native ones and the iX modal for ConfirmDialog -- keep the existing coverage.
- [x] `e2e/teacher-mobile.e2e.ts` -- a create and review block for each matrix row at 375 and 820px (tour at 1440px too), with an en/de/bo fit check -- a regression net for these pages.

**Acceptance Criteria:**
- Given an iX syllabus section form, when a teacher edits its title, language, content and links, then it saves as before (`syllabus-sections.e2e.ts` passes).
- Given the new-homework tour at 375, 820 and 1440px, when it starts, then all four steps find a visible target.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

- Implemented in the main session (no subagent: the user did not approve them).
- The three shared fields carry `mb-4` on their root, the spacing of iX's `.field`, so the iX syllabus form around them keeps its rhythm; the new pages use the same `mb-4` field blocks.
- `rte-input` and `rte-body` stay on the editor as test hooks; toolbar buttons are now 44px.
- Labels carry no `*`, like the other migrated pages (the editor's own label keeps its existing `*`).
- Each copy on the review page is its own `<tbody>` (one card: the numbers row, then the student-status row); `data-testid="homework-instance"` and `homework-student` are new test hooks.
- `teacher.e2e.ts`: `open()` now waits only for the hydrated new-UI root; the iX `pick()` helper is gone (native `choose()`).
- `tours.e2e.ts` needed no change (its targets keep their `data-tour`).
- Behaviour change, kept on purpose: the native offset field's `max="365"` (and `min`) now stops an out-of-range offset in the browser before posting; iX let it reach the server's toast. The "homework edit: a server error" test now checks both: the browser blocks 400 with no post, and a post rewritten to 400 gets the server toast with the typed values kept.
- Found by e2e: passing `value={assignment.title}` reset the typed title when another action reloaded the page (a new `assignment` object re-applies the prop). The edit fields now take `$derived` strings (`savedTitle`, `savedOffset`), which only change when the saved value does.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | No test saves links or language on the edit form and checks they stay (the `reset: false` dependency) | medium | patch | Pre-verified: only title and offset were saved in e2e. Added the language and link to the weekly test's edit step, with posted and kept values. |
| 2 | verification-gap | The rebuilt editor link panel (focus, Enter applies without posting) is untested | medium | patch | Pre-verified: no e2e touches "Web address". Added a `teacher.e2e.ts` test: focus, Enter applies `https://example.org`, no create POST. |
| 3 | blind-hunter | Edit-error test no longer proves 400 reached the server; route never unrouted | low | patch | True: `capturePosts` sees the browser's '6'. The route now records the rewritten body (asserted 400) and is unrouted. |
| 4 | blind-hunter | `<summary>` loses its disclosure marker (`flex`) | false | patch | `reset.css:170` forces `display: list-item` with higher specificity, so the marker stays; but `flex items-center` were dead classes: replaced with `py-2.5` (direct correction). |
| 5 | blind-hunter | Start-date note change not announced | low | patch | Only `aria-describedby`; added `aria-live="polite"` (one attribute). |
| 6 | blind-hunter | Editor toolbar buttons lost `cursor: pointer` | low | patch | The old `.rte-tool` had it; added `cursor-pointer`. |
| 7 | blind-hunter | Redundant `@source` for `homework/new` | low | patch | `homework/*/+page.svelte` already matches `new`; line deleted. |
| 8 | blind-hunter | Empty-subset test checks too few kept fields | low | patch | Added skill, link and due date to the mobile test's kept-value checks (assertions only). |
| 9 | blind-hunter | Required `*` gone from most labels | low | reject | Every migrated page (calendar, account, auth) shows no `*`; recorded in Implementation Notes. Adding it would make these pages the odd ones. |
| 10 | blind-hunter | Status cell unlabeled on cards; `thead` hidden below xl | low | reject | Same pattern as Requests (story 5); the badge text is self-describing. |
| 11 | blind-hunter | Focus after confirm lands on body; `aria-busy` on disabled button | low | reject | Same `pending`/`ConfirmDialog` pattern as Requests and calendar; changing it is a shared-pattern change, not this story's. |
| 12 | blind-hunter | LinkRows label fields all named "Label" | low | defer | Pre-existing: the iX version had the same unnumbered label. |
| 13 | blind-hunter | Create page not tested at 1440px; syllabus hosts unchecked for fit | low | reject | Matrix asks 375/820; the syllabus forms are story 8 and keep their functional e2e. |
| 14 | blind-hunter | Test helpers duplicated across e2e files | low | reject | Each e2e file keeps its own helpers (house style, e.g. 7b). |
| 15 | blind-hunter | `pending.svelte.ts` doc still describes iX `loading` / `confirmWith` | low | defer | Pre-existing since story 5 (Requests, calendar already use `aria-busy`); a shared-doc update. |
| 16 | blind-hunter | Due date has no `min` | low | reject | A new validation rule: SPEC "presentation only"; iX had none. |
| 17 | blind-hunter | Spec file and issue log missing from the diff | false | reject | Excluded on purpose; the spec is the claims file. |
| 18 | edge-case | Server-normalised title equal to the old one leaves untrimmed text in the field | low | reject | Needs a typed title that only differs by surrounding spaces; the saved value is right. Fix adds a key or effect. |
| 19 | edge-case | Specific students in a class with no students shows an empty fieldset | low | defer | Pre-existing: the iX page rendered the same empty list. |
| 20 | edge-case | Copy with no students and not whole-class: empty status list | low | defer | Pre-existing condition (`&& assignment.wholeClass`) carried over unchanged. |
| 21 | edge-case (claim) | `tours.e2e.ts` listed as changed but untouched | false | reject | Implementation Notes say it needed no change; its fallback still works via `data-hydrated`. Fix would be a spec edit. |
| 22 | edge-case (claim) | Edit-error test's 400 rejection only inferred; `edits` length 0 could pass before a post starts | low | patch | Same defect as #3 (one fix: the route records the rewritten body). Browser validation blocks the submit synchronously, so no later post can start. |

## Design Notes

- Native fields keep the edit form's values as `value={…}` from props, which change only when the saved value changes. A form reset would put back the server-rendered defaults, so the edit form posts with `reset: false`.
- The editor body is a ProseMirror node outside Svelte's markup, so it is styled with descendant variants on the host (`[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 …`), matching `RichText.svelte`.
- The end-series confirm stays a function, so it reads the box when pressed: `confirm: () => confirm.ask(archiveCopiesOnEnd ? … : …, m.homework_series_end_action(), { destructive: true })`.

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone, create a weekly homework with links and Tibetan content, then mark a student done and archive a copy.
