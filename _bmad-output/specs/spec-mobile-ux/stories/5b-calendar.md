---
title: 'Calendar'
type: 'feature'
created: '2026-10-20'
status: 'done'
route: 'dispatch'
baseline_commit: '8be33a341d64408cad344d744c8206d13ce56fa6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stories/5-shared-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/calendar` is the last shared page still on iX. Its session and day dialogs are cramped iX modals on a phone, and its fields are iX date, time, number and select inputs (SPEC CAP-2, CAP-3, CAP-4).

**Approach:** Rebuild `/calendar` phone-first on the new system as one version for every role, following stories 3–5. Restyle @event-calendar/core without replacing it.

## Boundaries & Constraints

**Always:**
- Keep the data, form actions, field `name`s and `id`s, and messages. Every `?/…` form keeps `use:enhance` with `pending.submit`.
- The page has its own `data-ui="new"` root with `data-hydrated`.
- Session and day dialogs: a bottom sheet on phone (<48em) and a dialog from 48em, following story 3's leave-range pattern (`parent/children/[id]`). They keep today's rules:
  - one dialog open at a time;
  - focus returns to the chip or day that opened it (or its re-rendered replacement);
  - auto-close with a toast on success;
  - stale errors filtered out (`formAtOpen`).
- Phone keeps the `listMonth` view and larger screens `dayGridMonth`. Chip colours (`chip-c0..c5`), day buttons and the today mark keep their meaning.
- Native date, time, number and select fields, with `aria-invalid`/`aria-describedby` errors wired by hand, and values in today's formats.
- `confirmWith`/`confirmAction` become story 5's `createConfirm` + `ConfirmDialog`. Toasts stay iX (`showToast`).
- `ScheduleFields` moves now (user decision): it gets its own `data-ui="new"` root and the same props/API. It serves the calendar's schedules card and `admin/classes` (still iX) from now on; story 8 no longer owns it.
- Every role keeps exactly what it sees and can do today: admin day cancel/delete/move/add days, teacher/admin session edit and extra session, the student's own answer, the parent's ChildPicker and child answers.

**Never:**
- No server, load, action or permission changes.
- No replacement of @event-calendar/core.
- No iX element, `$lib/ix-fields`, `confirmWith`/`confirmAction` or page-scoped `<style>` left in the page or in `ScheduleFields`.
- No Help screenshot regeneration (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Phone view | Any role, 375px | List view, chips readable, no sideways scroll | Load error → error state |
| Tablet / desktop | 820 and 1440px | Month grid, chips in class colours, weekday names readable | — |
| Open a session | Tap a chip | Bottom sheet on phone, dialog from 48em; actions visible without scrolling the page | — |
| Edit session | Teacher changes time/duration and saves | Sheet closes, toast, chip updated, focus on the chip | Invalid field → error under it, `aria-invalid`, sheet stays open, stale errors gone on reopen |
| Extra session / add days | Teacher adds an extra session; admin adds class days | Saved, toast, calendar updated | Invalid date → error under the field |
| Cancel / delete / move day | Admin on a day | Alert dialog for cancel/delete; Confirm saves with a toast; Cancel does nothing; focus returns to the day | Action error → toast |
| Parent, 2+ children | ChildPicker | The picked child's answers shown | No children → hint |
| Student | Opens a session | Own answer line, read-only | — |
| Keyboard | Escape in a dialog | Closes, focus returns to the opener | — |

</frozen-after-approval>

## Code Map

- `src/routes/calendar/+page.svelte` (1320):
  - Script (1–418):
    - Dialog state is `sessionModal`/`dayModal`, `sessionOpen`/`dayOpen`, `formAtOpen`/`freshForm`, `opener`/`focusSelector`.
    - `showModal` (209) waits for `customElements.whenDefined('ix-modal')`.
    - `onClosed` (249) returns focus to the opener or the re-rendered chip/day.
    - The success `$effect` (264) shows a toast and closes the dialog.
    - `cancelDay` (293) uses `confirmAction` + `requestSubmit`.
    - `PHONE_QUERY` `matchMedia` (407) picks `listMonth` vs `dayGridMonth`.
  - Snippets (424–478): `eventContent`, `childAnswerList`, `dayCellContent` (`button.day-button`).
  - Page (480–609): header with h1, admin add-days button, ChildPicker, empty/error states, `.calendar-wrap`, and the schedules card (`button.schedule-toggle` accordion, `form.schedule-form`, ScheduleFields).
  - Session dialog (613–731) and day dialog (733–999): cancel/restore, delete, move, extra session, add days.
  - iX elements (36): ix-button ×12, ix-pill ×5, ix-modal ×2, ix-date-input ×3, ix-time-input ×2, ix-number-input ×2, ix-select ×2, ix-icon ×1.
  - `ixValue`/`ixFieldError` at 667–976. The `{#key}` remounts (comment at 889) exist only for ix-select.
  - `<style>` (1002–1320): about 40 `.calendar-wrap :global(.ec-*)` overrides. Move them to `src/lib/ui/tailwind.css`, scoped under the page root, with `--ec-*` mapped to theme tokens.
- `src/lib/components/ScheduleFields.svelte` (199, 9 iX elements): ix-checkbox, ix-select, time/number/date inputs, `ixValue`/`ixFieldError`. Consumers: calendar and `admin/classes/+page.svelte` (create/edit class form, `schedule` derived at :66). Migrate it now; its admin/classes e2e (`calendar.e2e.ts:776–870`, `ix-checkbox` at 548 and 924) is reworked here.
- Reuse:
  - The leave-range dialog/sheet switch in `parent/children/[id]/+page.svelte:768+` (`Dialog.Root` + width check, `onCloseAutoFocus`).
  - `ui/sheet`, `ui/dialog`, `ui/native-select`, `ui/input`, `ui/badge`, `ui/button`, `ui/empty-state`.
  - `createConfirm`/`ConfirmDialog` (story 5).
  - `ChildPicker` (already migrated).
  - `ui.*` classes; `@source` in `tailwind.css`.
- Tours and help: there is no calendar tour (`tours.spec.ts:33`, `tours.e2e.ts:387`). Help shot teacher-8 is full-page and needs no selector change.
- e2e to rework:
  - `e2e/fixtures.ts:344` (`openCalendar` waits for ix-modal).
  - `calendar.e2e.ts`:
    - 52–54 (`ix-modal`, `dialog[open]`);
    - 213, 244, 321, 571, 596 (`.ix-invalid`);
    - 180, 314, 567 (`#id input`);
    - 312, 440, 543–605 (JS `value`);
    - 338, 986 (confirm inside ix-modal);
    - 397;
    - 438 (`ix-button.add-days-button`);
    - 700–731 (`ix-select-item`).
  - Keep the `.ec-*`, `.chip-*`, `button.day-button[data-date]`, `button.schedule-toggle[data-class-id]` and `#session-start`/`#add-start` hooks.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/calendar/+page.svelte` -- rebuild per Always/Never, with the dialog/sheet switch, native fields and story 5's confirm.
- [x] `src/lib/ui/tailwind.css` -- `@source` for the page, and the ec overrides scoped under the page root.
- [x] `src/lib/components/ScheduleFields.svelte` -- rebuild with its own root, native checkbox/select/time/number/date fields, the same props and field names -- shared with the iX `admin/classes` page.
- [x] e2e -- rework the Code Map selectors to roles, labels and `data-testid`s. Add a new `calendar-mobile.e2e.ts` covering each matrix row at 375 and 820px (admin at 1440px) and the en/de/bo fit check. The load-error row goes in a vitest render spec.

**Acceptance Criteria:**
- Given `/calendar` at 375px in en, de and bo for each role, when loaded and with a dialog open, then `scrollWidth` ≤ viewport, every button is ≥44×44px, and the dialog's actions are visible.
- Given `admin/classes`, when an admin creates or edits a class schedule, then `ScheduleFields` saves and shows errors as before inside the iX page.
- Given the full e2e suite after `supabase:reset`, when it runs, then everything passes except the known Reset PIN failure.

## Implementation Notes

- Page: one `data-ui="new"` root (`data-page="calendar"`, `data-hydrated`). Session and day dialogs are each a `Dialog.Root` with `Sheet.Content side="bottom"` below 48rem and `Dialog.Content` from 48rem (fixed while open), test hooks `session-dialog` / `day-dialog`; the body scrolls and the Close button stays in view. `onCloseAutoFocus` returns focus to the opener or its re-rendered replacement (`.ev-<id>`, `[data-date]`, `.add-days-button`). `formAtOpen` is now `$state.raw` (a `$state` proxy never equalled `page.form`, so stale errors were never filtered).
- The list/grid switch moved from 640px to 48rem, the same breakpoint as the sheet/dialog switch (SPEC phone < 48em).
- Cancel day and delete day use `createConfirm` + `ConfirmDialog` through `pending.submit`'s `confirm` (cancel and restore are now two forms). The alert dialog's content and overlay are `z-[60]` (shared `ui/alert-dialog`), so an alert asked from an open dialog is on top whichever portal mounted last.
- Library CSS: `reset.css` skips the `.ec` subtree (`:where(:not(.ec, .ec *))`, no added weight) in the box-model, heading and control rules, so the library keeps its own layout; `tailwind.css` restyles it under `[data-page='calendar'] .calendar-wrap` with `:not(#__)` weight, `--ec-*` on theme tokens, 44px toolbar buttons, day buttons and list chips; the class chip palette lives there as `--chip-c*` tokens.
- ScheduleFields: own root, native checkboxes (≥44px label rows), NativeSelect, time/number/date `Input`s; same props, names and ids; errors wired by `aria-invalid`/`aria-describedby` (weekdays: `aria-invalid` on each checkbox, the message described once on the fieldset). Unsaved edits survive reloads because Svelte only writes a field when its incoming value changes. In `admin/classes` a wrapper div spaces it from the iX button.
- The schedule form's `hidden` is mirrored by `flex`/`hidden` classes (an important display utility beats `[hidden]`).
- Tests: `calendar.e2e.ts` and `fixtures.ts` (`openCalendar` waits for the hydrated root) reworked to native fields, roles and test ids, plus a new admin/classes schedule-error test. New `e2e/calendar-mobile.e2e.ts` (19 tests): matrix rows at 375/820 (admin 375/1440) and the en/de/bo fit check per role with a sheet open. `page.render.spec.ts`: load error, empty month, parent hints. `ix-visual` admin-classes re-baselined (the schedule fields are now new UI, hidden by that test).

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | Unsaved-edit survival tested only for duration, not select/checkbox/time/date | medium | patch | Pre-verified gap; `calendar.e2e.ts:593-635` edits only `#schedule-B-duration`. Extend the test. |
| 2 | verification-gap | Weekday error id described on the fieldset and on every checkbox | low | patch | Both carry `aria-describedby={describedBy('weekdays')}`; direct deletion on the checkboxes. |
| 3 | blind-hunter | Inner layout switches at `sm:` (640px), sheet/dialog at 48rem | medium | patch | 7 `sm:` uses in the page; 640–767px gets a bottom sheet with desktop button rows. |
| 4 | blind-hunter, edge-case | Cancelled chip contrast dropped from ~7:1 to ~5.2:1 | low | patch | `--muted-foreground` rgba(0,10,20,.6) on `--muted` #eff0f1 ≈ 5.2:1; old #475569/#f1f5f9 ≈ 7:1. Direct correction. |
| 5 | blind-hunter | `durationValue` in `$lib/ix-fields` is now dead | low | patch | `grep durationValue src` finds no caller outside ix-fields. Direct deletion. |
| 6 | edge-case | Closing day dialog flashes the add-days title/form after move/delete | low | patch | Old page guarded with `{#if dayOpen && selectedDate}` (old :743); new `dayBody` checks only `selectedDate`, `selectedDay` turns null on reload. |
| 7 | blind-hunter | Move-day error toast not announced while the modal makes the page inert | maybe-false | defer | Spec matrix mandates "Action error → toast"; old iX `showModal` was equally modal, so pre-existing. Needs a screen-reader check. |
| 8 | edge-case | Focus falls to body when the opener day is gone (moved/deleted, list view) | medium | defer | Old `onClosed` had the same no-fallback path; pre-existing. |
| 9 | blind-hunter, edge-case | Focus return gives up after tick + one frame | maybe-false | defer | New code retries more than the old (tick only); `toBeFocused()` e2e pass. Would need a slow-device trace. |
| 10 | blind-hunter | `minutesText` duplicated in page and ScheduleFields | low | reject | Two identical copies; fix adds a shared export for little gain. |
| 11 | blind-hunter | ix-visual hides the new island, so no visual coverage of ScheduleFields in the iX page | low | reject | Functional e2e covers admin/classes; adding a screenshot test is more than a direct fix. |
| 12 | blind-hunter | `spinner` snippet used on only two buttons | low | reject | Cosmetic repetition, no user or developer harm named. |
| 13 | blind-hunter | Chip palette has no dark-mode values | false | reject | `dark` is only an explicit `.dark` class (tailwind.css:26) and nothing in `src/` sets it. |
| 14 | blind-hunter | `.ec` loses `box-sizing`; `::file-selector-button` rule not excluded | false | reject | Library `dist/index.css` sets `box-sizing: border-box` itself; the calendar has no file inputs. |
| 15 | blind-hunter | `expectFits` skips inputs/alertdialog; locales only at 375px | low | reject | AC requires buttons ≥44px and the locale check at 375px, which the test does. |
| 16 | blind-hunter | No resize test for `dialogWide` lock or list↔grid switch | low | reject | Rare in use; adds tests beyond a direct fix. |
| 17 | blind-hunter | z-index edit inside vendored shadcn files | false | reject | Project convention: 10 `ui/` files already carry "Sherab" edits. |
| 18 | blind-hunter | Render spec casts props `as never` | low | reject | Test-only typing looseness; no named breakage. |
| 19 | blind-hunter | Spec/story files missing from the diff | false | reject | Excluded on purpose from the review diff; the spec is the claims file. |
| 20 | edge-case | Interval outside 1–4 leaves the select empty | false | reject | DB check `schedule_interval_weeks between 1 and 4` (migration 0026:28) makes it unreachable. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run test:e2e` -- expected: everything passes except the known Reset PIN test.

**Manual checks:**
- On an iPhone: open a session as a teacher and change its time with the iOS picker; as admin, cancel a day.
