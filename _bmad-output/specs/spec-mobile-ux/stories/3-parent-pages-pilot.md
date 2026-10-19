---
title: 'Parent pages (pilot)'
type: 'feature'
created: '2026-10-19'
status: 'done'
route: 'dispatch'
baseline_commit: '5022edc1c277c033b620d8b09a7787a345581a6b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stories/2-new-app-shell.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parents use Sherab on phones, but their pages are iX: a 1,100-line child page with a cramped session grid, an iX date/select/radio leave form, an iX modal, and wide rows (SPEC CAP-2–CAP-5). This is the go/no-go pilot for the whole migration.

**Approach:** Rebuild `/parent`, `/parent/children/[id]` (overview and sessions tabs, leave range, deletion request), `/parent/children/[id]/badges` and `/parent/homework` phone-first on the new system, with a tablet grid, keeping every behaviour, form action, tour target and message. Shared components they use move now and serve every role (stack.md rule).

## Boundaries & Constraints

**Always:** Same data, form actions, field names, validation messages and progressive enhancement (forms work without JS). Each migrated page wraps its content in its own `data-ui="new"` root; migrated shared components carry their own root so they work inside still-iX pages. Native `<input type="date">` and `<select>` (iOS pickers). Leave-range confirmation: bottom sheet below 48em, dialog from 48em. Deletion confirmation: new alert dialog (no `confirmAction`). Session answers: one-handed, full-width buttons stacked below the row on phone, ≥44px. Keep every `data-tour` target on the equivalent element. Toasts stay iX (`showToast`). Tablet (48–80em): dashboard children and overview sections in two columns.

**Never:** No server, load or action changes. No iX element, `$lib/ix-fields` attachment or `confirmAction` left in the four parent pages or the migrated shared components. No page-scoped `<style>` in migrated files (utilities only). No regeneration of the Help guide screenshots — all roles' screenshots are regenerated once in story 10 (user decision).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dashboard | Parent with an approved and a pending child, 375px | One card per child, pending one not a link; no horizontal scroll | — |
| Leave range | From/to, class, answer; preview | Sheet (375px) / dialog (820px) lists the sessions; Save sets them, toast, closes | Missing dates or class: errors on the fields, `aria-invalid`, focus moves to the first |
| Range error after preview | Server returns a dates error on save | Sheet closes, error stays on the date fields | — |
| Per-session answer | Tap Coming / On leave / Sick on a row | Saved; row shows the new state; buttons ≥44px | Action error → iX toast |
| Deletion request | Tap request deletion | Alert dialog; Confirm posts `requestDeletion`; Cancel does nothing | — |
| Badges | Earned and locked badges, tap one | Detail dialog with the badge; Escape closes | — |
| Homework | Two children, overdue item | Rows stacked with child, title, overdue pill, links | — |
| No JS | Leave range with JS disabled | Preview and save still work through the form actions | — |
| Tours | Parent first visit to `/parent` and sessions tab | Tours highlight the same steps | — |

</frozen-after-approval>

## Code Map

- `src/routes/parent/+page.svelte` (147) -- ix-empty-state ×5, ix-pill ×3, ix-card; tours `parent-child-card` (l.70), `parent-child-name` (l.74); grid `ul.children`.
- `src/routes/parent/children/[id]/+page.svelte` (1139) -- ix-pill ×13, ix-button ×8, ix-date-input ×2, ix-select, ix-radio-group, ix-modal; `showToast` (112, 115, 237), `confirmAction` (251); `ixValue`/`ixFieldError` attachments; `createPending` (`$lib/pending.svelte`) drives loading/disabled — keep; forms: `requestDeletion` (409), `previewLeaveRange` (467, ids `range-from`, `range-to`, errors `range-dates-error`, `range-class-error`, `range-answer-error`), `setLeaveRange` (632, hidden inputs), per-session `setLeave` / `preview`; modal open/close logic 200–246 (`openRangeModal`, `onRangeClosed`, focus `#range-preview`); tours `child-tabs`, `child-tab-sessions`, `leave-range`, `session-row`, `session-answer`, `session-controls` (first answerable row only); ~215 lines of scoped style.
- `src/routes/parent/children/[id]/badges/+page.svelte`, `src/routes/parent/homework/+page.svelte` -- small; homework ix-pill ×1.
- Shared, migrated here: `PageBreadcrumb` (iX breadcrumb + shadow workarounds; 14 other routes), `Pager` (2× `ix-button href`; student homework/classes), `StudentProgressTiles` (student dashboard), `BadgeCollection` + `BadgeDetailDialog` (student, teacher badges). `ChildPicker` has no iX (calendar too) — restyle only.
- `src/lib/ix-fields.ts`, `src/lib/ix.ts` -- unchanged (other pages still use them).
- e2e: `leave-range.e2e.ts` (iX date/select/modal/radio selectors — main rework), `breadcrumbs.e2e.ts` (`ix-breadcrumb` ×9), `badges.e2e.ts` (`ix-modal[data-testid="badge-detail"]`), `team-students.e2e.ts` (`ol.leaderboard li`), `tours.e2e.ts`, `ix-visual.e2e.ts` (parent shots).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/ui/` -- generate shadcn `dialog`, `alert-dialog`, `badge`, `label`, `radio-group`, `breadcrumb`; add a native-input `input`/`select` styling and an `empty-state` component.
- [x] Shared components above -- rebuild on the new system with their own `data-ui="new"` root, same props.
- [x] The four parent pages -- rebuild per Always/Never; leave sheet/dialog via `Sheet`/`Dialog` by breakpoint; deletion via alert dialog.
- [x] `src/lib/ui/tailwind.css` -- `@source` lines for the migrated folders.
- [x] e2e: rework `leave-range`, `breadcrumbs`, `badges`, `team-students` selectors to roles / labels / `data-testid`; drop the parent shots from `ix-visual` (page is no longer iX); new `parent-mobile.e2e.ts` covering each matrix row at 375 and 820px (No-JS row with `javaScriptEnabled: false`).

**Acceptance Criteria:**
- Given any parent page at 375px in en, de and bo, when loaded, then `scrollWidth` ≤ viewport and every button is ≥44×44px.
- Given the full e2e suite after `supabase:reset`, when it runs, then all tests pass except the known Reset PIN failure; remaining `ix-visual` shots still match, or a changed shot is explained by a migrated shared component and re-baselined on this story's baseline commit.

## Implementation Notes

- Generated with `shadcn-svelte@1.7.0` (button folder set aside so the CLI did not prompt; its `package.json` edits reverted): `dialog`, `alert-dialog`, `badge`, `label`, `radio-group`, `breadcrumb`, plus `input`, `native-select` and `empty` for the native input/select styling and the empty state. Sherab edits: dialog and alert-dialog portals default to `#ui-portal`; `dialog-content` has `closeLabel` and a 44px close button; `input`/`native-select` default to 44px high with 16px text (no iOS zoom); `native-select`'s `ref` typed as `HTMLSelectElement` (TS 6 rejects it under `WithElementRef`); `badge` gets iX's pill colours (`warning`, `success`, `alarm`, `info`, `*-outline`) and wraps instead of clipping (Tibetan, long German). `ui/empty-state/` wraps `empty` with `header` / `subHeader` / `icon` props.
- The range form's answer uses **native radios**, not the generated Bits `radio-group`: Bits radios are buttons and do nothing without JavaScript, and the No-JS row requires the form to work. The generated `radio-group` (and the unused `alert-dialog-media`) were deleted; the generated parts' English labels (`closeLabel` defaults, the dialog footer's Close, the breadcrumb ellipsis' More) come from paraglide, and `leading-none` was dropped from `dialog-title` and `label` (it beat the Tibetan line height).
- Shared utility sets live in `src/lib/ui/classes.ts` (`ui.page`, `ui.card`, `ui.touch`, …), sourced by Tailwind. `ui.page` uses `-mx-4 md:mx-auto`: the shell's `<main>` still pads 2rem for the iX pages, so a migrated phone page takes 1rem back for a 16px gutter. Remove it once every page is migrated and `<main>`'s padding changes.
- `@source` lines list only the parent pages' `.svelte` files and the six shared components: words in server code would otherwise become global `!important` utilities. Checked the build: no new utility matches a class used on a remaining iX page (only `block` and `sr-only`, as before).
- Leave period: one Bits `Dialog.Root`; below 48rem (`MediaQuery('min-width: 48rem')`) it renders `Sheet.Content side="bottom"`, from 48rem `Dialog.Content`. Summary and list scroll; Cancel / Save stay in view. Focus after close goes to Preview, or to From when it closed for a dates error. Focus waits until no submit is pending (Preview is disabled while the save that closed it finishes). A field error moves focus to its field. Without JavaScript (`!hydrated`), a posted preview shows in the page with its own Save form and a Cancel link, and a saved period shows a status line (no toast without JS).
- Per-session errors: the root layout already toasts `form.error` (iX `showToast`); the inline row error is kept.
- Deletion: the button is the `requestDeletion` form's submit button (without JavaScript it posts directly); with JavaScript its click opens a Bits `AlertDialog`, whose Confirm (disabled while busy, guarded against a second tap) submits the form. After saving, focus moves to the pending status.
- `BadgeDetailDialog`: same `open(badge, next, opener)` API; titled with the subject (as iX's header), the reward text in the body. Focus returns to the opening badge.
- `PageBreadcrumb`: own root, same props. Below 40rem only the last two linked levels show; earlier ones are in a "…" dropdown (44px trigger). A link-less level is left out on a phone, as before. Long labels truncate with vertical padding so Tibetan glyphs are not clipped. Done in CSS (no remount on resize).
- Pages set `data-hydrated` on their root (and the breadcrumb on its own) once mounted; tests wait for it. The range preview pins Sheet or Dialog when it opens (no swap on rotation). A posted class that is no longer an option falls back to All classes. Crumb links are at least 44px wide.
- Test hooks: `data-testid` `child-card`, `range-sheet` / `range-dialog`, `range-list`, `range-preview-page`, `deletion-confirm`, `homework-list`, `badge-next`, `page-breadcrumb`, `breadcrumb-more`; `data-session` on session rows, `data-progress` / `data-visual` on locked badges, `data-crumb-menu` on the phone "…" item.
- e2e: `leave-range` (native date/select, dialog by role), `breadcrumbs` (role `navigation` "Breadcrumb"; the iX 36/40px height check is replaced by a ≥44px link check), `badges` (testids, the dialog by role, plus a focus-return check), `team-students` (the team page's breadcrumb; `ol.leaderboard` is on `/leaderboard`, still iX, unchanged), `tours` (tabs by role), `ix-visual` (parent shots and baselines removed). New `parent-mobile.e2e.ts`: 24 tests covering every matrix row at 375 and 820px, plus the fit check in en/de/bo.
- Verification (after `supabase:reset`): 1531 unit tests passed; check 0 errors; ESLint 0 errors (2 existing warnings in the generated `worker-configuration.d.ts`); Prettier clean on changed files; build OK (manifest and `sw.js` emitted). Full e2e: 184 passed, 4 skipped (help screenshots), 1 failed: the known `teacher.e2e.ts:1235` Reset PIN test. The remaining `ix-visual` shots (login, teacher dashboard, admin classes) match without re-baselining. One earlier partial run had a one-off failure in `tours.e2e.ts:360` (Help did not open on the teacher calendar, a page this story does not touch); it passed on the rerun and in the full run.

- Final verification (after review patches, `supabase:reset`): 1531 unit tests, check 0 errors, ESLint 0 errors, Prettier clean, build OK. Full e2e: 187 passed, 4 skipped (help screenshots), 1 failed — the known `teacher.e2e.ts:1235` Reset PIN.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter BH, edge-case-hunter EH, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| BH1 | Deletion request needs JS | medium | "Request deletion" only opens the alert dialog; the real form is hidden and empty, so with JS off nothing happens — breaks the Always "forms work without JS" | patch |
| own | Badge dialog heading changed from subject to reward text | medium | Old `ix-modal-header` showed `badgeSubjectLabel(badge.subject)`; new `Dialog.Title` shows the reward text — behaviour change the spec forbids | patch |
| BH2/EH4 | Focus lost after confirming deletion | medium | Alert dialog returns focus to `#deletion-request`, which `pending.busy` disables and the pending status then replaces; focus falls to `<body>` | patch |
| EH3 | Confirm double-tap posts twice | low | `requestSubmit` can run again during the close animation; second POST fails on the unique request | patch |
| BH5b | `leading-none` on dialog titles and labels | medium | `leading-none` utilities are `!important` and beat the `bo` line-height 2; wrapped Tibetan titles/labels overlap | patch |
| BH5/VG1/EH7 | #86 Tibetan crumb clipping check removed | medium (pre-verified) | Old label-height assertion deleted; new crumb text is `truncate` (overflow hidden) and only the link's 44px height is checked | patch |
| BH3/EH6 | 820px skips deletion and session-answer rows; order-dependent | medium | Tablet deletion test returns early and relies on the phone run; answers only at 375px — matrix requires both | patch |
| VG2 | Pager never rendered by any test | medium (pre-verified) | Fixtures have one Done item, so `pageCount > 1` never happens; Previous/Next rewrite untested | patch |
| VG3 | Phone breadcrumb's link-less level untested | low (pre-verified) | Only the all-links teacher trail is tested at phone width | patch |
| BH4 | Hydration wait uses `ix-button` definition | low | Root-layout signal, not the page's; clicks on Bits triggers can land before hydration | patch |
| BH6 | Crumb links can shrink far below 44px wide | low | `min-w-0 shrink-[2]` with a long current label; `expectFits` measures buttons only | patch |
| BH8 | Unused generated files; English default labels | low | `radio-group`, `alert-dialog-media` unused; `breadcrumb-ellipsis`, `dialog-footer`, `closeLabel` defaults hard-code English | patch |
| BH10 | Answer radios: duplicate `aria-describedby`, no `aria-invalid` | low | Error read several times; radios not marked invalid while dates/select are | patch |
| BH10b/EH2 | Sheet ↔ dialog swap while open on rotation | low | Variant follows the live breakpoint; old content's close handler moves focus behind the open modal | patch |
| EH1 | Posted `classId` missing from `rangeClasses` blanks the select | low | Bound value matches no option, resubmit posts no class | patch |
| EH5 | Locked next-badge name not announced | low | `aria-label` on a plain `Badge` span is ignored by screen readers | patch |
| VG4 | Focus on answer / no-field errors untested | low (pre-verified) | Needs a forged radio value; focus-only | defer |
| BH7 | Date inputs have no `min` | low | New behaviour, not in the spec; server validates | reject |
| BH9 | Section load errors grey, alias tokens | low | Style consistency, no named harm | reject |
| BH11 | Shared components on iX pages not visually tested | low | `breadcrumbs`, `badges` e2e exercise them functionally on student/teacher/admin pages; old-UI baselines would differ by design | reject |
| BH12 | Diff omits staged PNG deletions and the spec edit | false | Spec and binaries are excluded from the review diff by design | reject |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run test:e2e` -- expected: all pass except the known Reset PIN test.

**Manual checks:**
- On an iPhone: request leave for a date range and answer one session one-handed; open a badge.
