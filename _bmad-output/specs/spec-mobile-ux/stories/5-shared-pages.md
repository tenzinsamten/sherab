---
title: 'Shared pages — requests, leaderboard, account, help, teams'
type: 'feature'
created: '2026-10-19'
status: 'done'
route: 'dispatch'
baseline_commit: '76dce349c791e562e04bb0a6303f8d5dbe578a6f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stories/4-student-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Several pages every role shares are still iX. On a phone, the Requests page's ten wide tables scroll sideways, the account forms are cramped iX inputs, and the leaderboard is made of iX cards (SPEC CAP-2, CAP-3, CAP-4).

**Approach:** Rebuild `/requests`, `/account`, `/leaderboard`, `/help` and `/teams/[teamId]` phone-first on the new system as one version for every role, admin included, following the patterns from stories 3 and 4. Move their shared components now. The calendar is split off to story 5b (user decision).

## Boundaries & Constraints

**Always:**
- Keep the data, form actions, field `name`s and `id`s, messages and progressive enhancement. Forms keep `use:enhance` with `pending.submit`.
- Each page and each migrated shared component has its own `data-ui="new"` root.
- iX confirms (`confirmWith`/`confirmAction`) become Bits alert dialogs, following story 4's `MarkDoneForm` pattern. Toasts stay iX (`showToast`).
- Requests:
  - Stacked cards below 80em with every column's data; full tables from 80em (CAP-8), checked inside the admin shell at 1440px.
  - The `teacher-requests` tour's `data-tour` targets sit on whichever element is visible at each breakpoint.
  - The header count pill still updates after a decision.
  - When a decided row leaves, focus goes to the next card or row, or to the section heading.
- `PasswordInput` and `CredentialFields` move now and keep their behaviour and autocomplete attributes. Login, register, reset-password, `admin/teachers`, `EnrollmentPanel` and join pending keep using them inside iX pages.
- `HelpGuide` and `HelpFaq` move now, which also restyles the shell help sheet (`shell/HelpSheet.svelte`).
- Account fields are native inputs. The readonly email stays readonly, and the hidden username field for password managers stays.

**Never:**
- No server, load, action or permission changes.
- No new no-JS path for join or deletion approval; it needs JS today and still will.
- No iX element, `$lib/ix-fields`, `confirmWith`/`confirmAction` or page-scoped `<style>` left in the five pages or in the migrated components.
- No calendar changes (story 5b).
- No Help screenshot regeneration (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Requests, phone | Teacher with registration, sick and join requests, 375px | Cards with every column's data, no sideways scroll, count pill shown | Empty → empty state |
| Approve / reject | Tap Approve or Reject | Alert dialog where iX asked before; Confirm → toast, the item leaves, the count pill drops; Cancel does nothing | Error → error bar / toast as today |
| Approve with credentials | Teacher approves a registration | Outcome message with CredentialFields, Copy and Copy all | — |
| Requests, desktop | Admin, 1440px | Full tables for all ten sections, actions in reach | — |
| Teacher tour | Start the Requests tour at 375 and 1440px | Each step highlights a visible element | — |
| Account | Change name, password, push, request parent access | Same results and toasts; the password manager fills the fields | Wrong current password → error under the field |
| Leaderboard | Student, 375px and 820px | Ranked rows, top rank highlighted; two columns on tablet (own-row marking deferred, user decision: the load has no own-team flag) | Empty → empty state |
| Team | Student opens their team | Breadcrumb and member list, no sideways scroll | — |
| Help | Switch role tab | Tabs ≥44px with `aria-current`; the same guide in the shell sheet | — |

</frozen-after-approval>

## Code Map

- `src/routes/requests/+page.svelte` (881):
  - 10 `section.card` tables: registrations, decided, sick, sick decided, upcoming leave, join; admin also gets deletion, deletion decided, parents and parents decided.
  - iX elements: 19 `ix-pill`, 11 `ix-button`, 2 `ix-message-bar` (outcome with credentials; error), 1 `ix-empty-state`.
  - 6 `confirmWith`, and `confirmAction` (join, deletion approval, unconfirmed parent).
  - Hidden `<form bind:this>` + `tick()` + `requestSubmit` for join and deletion.
  - `data-tour` on 3 `<tr>`.
  - Kicker and subtitle differ for teacher and admin.
  - The shell nav count (`CountText.svelte`, `nav.ts` `pendingRequests`) is separate; leave it alone.
- `src/routes/account/+page.svelte`:
  - Sections: name, password, push, parent access.
  - 4 `ix-input` (display name, student-only username, readonly email), 4 `ix-button`, 2 `ix-pill`, `ixValue`.
  - 3 `PasswordInput`s and a hidden username field.
- `src/routes/leaderboard/+page.svelte`: an `ix-card` list plus `ix-empty-state`; the style draws the rank circle and the `.top` highlight.
- `src/routes/help/+page.svelte`: link tabs (`?role=`, `aria-current`) with `--theme-*` style.
- `src/routes/teams/[teamId]/+page.svelte`: `PageBreadcrumb` plus a `ul.students` list with its own style.
- Shared components:
  - `PasswordInput` (`ix-icon` eye toggle, scoped style).
  - `CredentialFields` (`ix-button` copy-all, scoped style).
  - `HelpGuide`/`HelpFaq` (scoped CSS on `--theme-*`). Check the comment in `HelpSheet.svelte` around line 46, which relies on that CSS.
  - Already migrated: `CopyField`, `PageBreadcrumb`.
- Reuse:
  - `src/lib/ui/classes.ts` (`ui.*`, `ui.filter`, `ui.touch`), `ui/alert-dialog`, `ui/badge`, `ui/input`, `ui/empty-state`, `ui/button`.
  - `MarkDoneForm.svelte` for the confirm pattern.
  - `data-hydrated` roots.
  - `@source` lines in `src/lib/ui/tailwind.css`.
- Tours and help screenshots:
  - `src/lib/tours.ts:210` (`teacher-requests`).
  - `e2e/help-screenshots.e2e.ts:255` waits for `ix-button`; switch it to a hydrated-root wait. Shots: teacher-1/3/9 (`#parent-access-heading`), student-6/8.
- e2e selectors to rework:
  - `credentials.e2e.ts`: 110, 142, 255–307.
  - `forms.e2e.ts`: 546–580 (`ix-message-bar`, `.credential`).
  - `class-join.e2e.ts`: 297 (`.page-header ix-pill`), 310.
  - `parent-access.e2e.ts`: 290.
  - `auth-fields.e2e.ts`: 292–306 (JS `value`).
  - `team-students.e2e.ts`: 157, 181–287, 202–204.
  - `ix-toast` selectors can stay.
  - Confirm selectors (`ix-modal`) become `alertdialog` roles.

## Tasks & Acceptance

**Execution:**
- [x] `PasswordInput`, `CredentialFields`, `HelpGuide`, `HelpFaq` -- rebuild with their own root and the same props -- shared with iX pages and the shell sheet.
- [x] `src/routes/requests/+page.svelte` -- cards below 80em and tables from 80em, alert-dialog confirms, tour targets per breakpoint, focus after a decision.
- [x] `src/routes/account/+page.svelte`, `leaderboard`, `help`, `teams/[teamId]` -- rebuild per Always/Never.
- [x] `src/lib/ui/tailwind.css` -- `@source` for the migrated files.
- [x] e2e -- rework the selectors listed in the Code Map to roles, labels and `data-testid`s. Add a new `shared-mobile.e2e.ts` that covers each matrix row at 375 and 820px (requests desktop at 1440px) and the en/de/bo fit check on all five pages. Empty and error rows go in vitest render specs.

**Acceptance Criteria:**
- Given any of the five pages at 375px in en, de and bo, when loaded, then `scrollWidth` ≤ viewport and every button is ≥44×44px.
- Given login, register, reset-password, admin/teachers and join pending, when used, then `PasswordInput`/`CredentialFields` work as before inside the iX page.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

- Confirms: new `createConfirm()` (`src/lib/confirm.svelte.ts`) + `ConfirmDialog.svelte` (Bits alert dialog, one per page). `confirm.with(message, okay)` plugs into `pending.submit`'s `confirm` option, so every former `confirmWith` keeps its flow; `confirm.ask()` replaces `confirmAction` for join, deletion approval and the unconfirmed parent. Without JS the forms post directly, as before (join/deletion approval still need JS). Reject/clear/erase Confirm buttons are red.
- Requests: one markup for both layouts -- a `<table>` whose table/tbody/tr/td are block/flex below `xl` (stacked cards, thead hidden) and table display from `xl` (80em). So the tour's `data-tour` rows are the visible element at every width and there are no duplicate forms. Test hooks: section `data-testid`s (`requests-registrations`, `-decided`, `-sick`, `-sick-decided`, `-upcoming-leave`, `-join`, `-deletion`, `-deletion-decided`, `-parents`, `-parents-decided`), `request-row`, `requests-count`, `requests-outcome`, `requests-no-teams`. `decide()` wraps `pending.submit` and, when a decided row leaves and focus was lost with it, focuses the row now in its place (`data-request-row`, tabindex -1), else the section heading (`data-section-heading`; registrations: its empty state). The ix-message-bars became bordered success/warning boxes (`role="status"` on the outcome).
- Account: native `Input`s with labels; a field's error (matched by message: wrong current password, length/same, mismatch, name required) also shows under it with `aria-invalid`/`aria-describedby`, the layout toast stays. Name form keeps its typed value (`reset: false`). From 80em the cards sit in two columns.
- PasswordInput: own root, native input via `ui/input` with a 44px Lucide eye toggle; props unchanged (type now also omits `files`). CredentialFields: own root, outline "Copy both" button. HelpGuide/HelpFaq: own roots, utilities (FAQ summaries ≥44px with a chevron); HelpSheet's restoring classes dropped.
- Leaderboard: rows with a rank circle, the first `data-top` (primary border, filled circle); `md:` two columns; empty state via `EmptyState`. Help: link tabs use `ui.filter` (≥44px, `aria-current`); signed out (no shell padding) the page uses its own 16px frame. Team page: list in two columns from `md`.
- "Own row marked" on the leaderboard: dropped from this story and deferred (user decision at the step-3 matrix audit) -- the load returns no own-team flag and loads may not change (Never). Logged in `deferred-work.md`.
- Tests: e2e reworked in credentials, forms, class-join, parent-access, auth-fields, team-students, help-screenshots (hydrated-root wait). New `e2e/shared-mobile.e2e.ts` (20 tests): every matrix row at 375/820 (Requests admin at 1440, tour at 375/1440), error toast (request decided meanwhile), credentials Copy/Copy both (clipboard), fit check en/de/bo on all five pages plus signed-out Help. Push is not configured locally, so its card is covered by `src/routes/account/page.render.spec.ts`; empty states by `requests/` and `leaderboard/page.render.spec.ts`.

- `ix-visual` login re-baselined (phone and desktop): the password field is now a new-UI element, which ix-visual hides (it shoots iX content only), and it is 44px tall instead of 40px.
- Final verification (`supabase:reset` first): 1547 unit tests, check 0 errors, ESLint 0 errors (2 existing warnings), Prettier clean, build OK. Full e2e: 224 passed, 4 skipped (help screenshots), 2 failed -- the known `teacher.e2e.ts:1235` Reset PIN and `ix-visual` login phone (re-baselined, then 6/6 pass).

- Review patches (pass 1):
  - `refocus` falls back to the row in the decided row's place, then the previous row, then the section heading, and only focuses a connected element; otherwise it focuses `main h1`. This covers the last join request and the last registration row.
  - Every table has explicit `table`/`rowgroup`/`row`/`cell`/`columnheader` roles (`svelte-ignore a11y_no_redundant_roles`), so WebKit keeps the semantics on the restyled cards.
  - A new credential outcome scrolls into view (`block: 'nearest'`) without moving focus.
  - ConfirmDialog and the deletion Approve button use the Button `destructive` variant.
  - Tests:
    - e2e: Erase end to end (own fixture), join and sick focus asserted exactly, admin `/requests` in the en/de/bo fit loop.
    - Render specs: account length / same / name-required, Requests no-teams.
    - New `src/lib/confirm.spec.ts` (named `*.spec.ts`, since vitest excludes `*.svelte.spec.ts`).
- Final verification after the review patches (`supabase:reset` first):
  - 1554 unit tests pass.
  - check: 0 errors, 0 warnings.
  - ESLint: 0 errors (2 existing warnings).
  - Prettier clean; build OK.
  - Full e2e: 230 passed, 4 skipped (help screenshots), 1 failed: the known `teacher.e2e.ts:1235` Reset PIN.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter BH, edge-case-hunter EH, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| EH2/BH1 | Focus lost when the last join request is decided | medium | The join section is inside `{#if data.joinLoadError \|\| data.joinPending.length > 0}` (`requests/+page.svelte:688`); it unmounts, so `refocus` finds a detached heading and focus falls to body | patch |
| EH1/EH3/EH5 | Deciding the last row of a non-empty registrations list loses focus | medium | Registrations has no `data-section-heading` while the list is non-empty (only the empty state has one, :361); `children[index]` is past the end, and `querySelector` returns null | patch |
| BH2 | Stacked cards drop table semantics | medium | `display:block/flex` on table, tr and td below `xl` makes WebKit drop table, row and cell roles; there are no explicit roles | patch |
| BH3 | One-time PIN outcome can be off-screen on phone | medium | The outcome box is at the top of the page; after approval, focus moves to the next row lower down, and nothing scrolls the box into view | patch |
| VG1/BH5 | Deletion approval (Erase) never confirmed end to end | medium (pre-verified) | Only Cancel is tested (`shared-mobile.e2e.ts` admin 1440); the hidden-form `deletionRow` path is rewritten | patch |
| VG2 | Join decision focus not asserted | medium (pre-verified) | `focusedSpot` is checked only for registrations and loosely for sick notes | patch |
| VG3/BH7a | Account length / same / name-required mappings untested | medium (pre-verified) | `page.render.spec.ts` covers current-password and mismatch only | patch |
| VG4/BH13a | No-teams note and disabled Approve never rendered | medium (pre-verified) | The render spec always sets `hasTeams: true` | patch |
| BH4 | Admin sections never fit-checked at 375px | low | The fit loop uses teacher and student; admin-only buttons ("Resend confirmation email", Erase) are unchecked | patch |
| BH6/VG-o | `createConfirm` has no unit test (supersede, Cancel, once) | low | No spec file; supersede and Escape-false are never exercised | patch |
| BH8 | Hand-written destructive classes in ConfirmDialog / Erase button | low | `bg-destructive text-primary-foreground` instead of the shared `destructive` variant; the two will drift | patch |
| BH12 | Test comment "FAQ opens one question at a time" is untrue | low | `<details>` have no shared `name`; the comment is wrong | patch |
| BH6b | `with()` uses `this.ask`, which breaks if detached | false | Every call site is `confirm.with(...)`; no detached use exists | reject |
| BH7b | Inline account error stays until the next submit | low | Same as before (the toast-only errors also persisted until the next action); the fix adds input listeners | reject |
| BH9 | `aria-haspopup` only on some buttons | low | No named harm; alert dialogs announce themselves | reject |
| BH10 | `expectFits` skips links and inputs | low | Test breadth only; leaderboard links are `min-h-11`; story 4 rejected the same (BH9) | reject |
| BH11a | 44px PasswordInput next to 40px ix-inputs on iX auth pages | low | Cosmetic and temporary until story 6 migrates those pages | reject |
| BH11b | Full suite not re-run after the ix-visual re-baseline | low | Settled by the full verification run after this pass's patches | reject |
| BH13b | Hooks `field-error`, `team-students-empty`, `confirm-dialog` unused | low | Test hooks without a consumer; no harm | reject |
| BH14 | Registrations section has no visible h2 | low | Pre-existing: the old page's first section had no heading either | reject |
| BH15 | Programmatically focused row shows no ring after a click | low | `:focus-visible` follows the last input modality; keyboard users get the ring | reject |
| BH16 | Leaderboard load error shows only the header | low | Pre-existing: the old page had the same `{#if !data.loadError}` and no inline message | reject |
| BH17 | Account two columns at 80em untested | low | Layout only; no behaviour | reject |
| EH4 | No-teams `<p>` lost a live role | maybe-false | Only low at most: the note is rendered with the page, not after an action; reject | reject |
| EH6 | Credentials and error rows run at 375px only | low | Same components at both widths; the fit check covers 820 | reject |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone: approve a request, and change the password with the password manager filling it.
