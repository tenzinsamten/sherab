---
title: 'Parent pages (pilot)'
type: 'feature'
created: '2026-10-19'
status: 'ready-for-dev'
route: 'dispatch'
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
- [ ] `src/lib/components/ui/` -- generate shadcn `dialog`, `alert-dialog`, `badge`, `label`, `radio-group`, `breadcrumb`; add a native-input `input`/`select` styling and an `empty-state` component.
- [ ] Shared components above -- rebuild on the new system with their own `data-ui="new"` root, same props.
- [ ] The four parent pages -- rebuild per Always/Never; leave sheet/dialog via `Sheet`/`Dialog` by breakpoint; deletion via alert dialog.
- [ ] `src/lib/ui/tailwind.css` -- `@source` lines for the migrated folders.
- [ ] e2e: rework `leave-range`, `breadcrumbs`, `badges`, `team-students` selectors to roles / labels / `data-testid`; drop the parent shots from `ix-visual` (page is no longer iX); new `parent-mobile.e2e.ts` covering each matrix row at 375 and 820px (No-JS row with `javaScriptEnabled: false`).

**Acceptance Criteria:**
- Given any parent page at 375px in en, de and bo, when loaded, then `scrollWidth` ≤ viewport and every button is ≥44×44px.
- Given the full e2e suite after `supabase:reset`, when it runs, then all tests pass except the known Reset PIN failure; remaining `ix-visual` shots still match, or a changed shot is explained by a migrated shared component and re-baselined on this story's baseline commit.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run test:e2e` -- expected: all pass except the known Reset PIN test.

**Manual checks:**
- On an iPhone: request leave for a date range and answer one session one-handed; open a badge.
