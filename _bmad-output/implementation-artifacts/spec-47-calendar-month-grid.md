---
title: 'Calendar month grid (#47)'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e6135bb8fb16e9e97e3a922af023c9fac18018a5'
context:
  - '{project-root}/_bmad-output/specs/spec-class-tracker/stories/6-1-class-days-sessions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/calendar` (story 6-1) is a date-grouped list with inline forms; the user wants a Google Calendar–style month view where the classes are visible at a glance (#47 in `manual-verification-issues.md`, the deferred "Month-grid calendar UI").

**Approach:** Render 6-1's existing month data with the `@event-calendar/core` Svelte component: a Monday-first month grid on wide screens, its list view at phone width, each session a chip in its day cell. Editing moves into dialogs opened by clicking a chip or (admin) a day.

## Boundaries & Constraints

**Always:** Reuse 6-1's `load`, the five form actions, `calendar.ts` helpers, RLS and messages unchanged in behaviour; the only data path stays `?month=YYYY-MM`. The library's own prev/next/today buttons navigate by changing `?month=` (one month per load), so the server-side month scoping and Berlin "today" stay authoritative. Week starts Monday; the grid shows leading/trailing days of neighbouring months (sessions there appear only once their month is loaded). Chip = start time + class name (or "Time not set"); cancelled chips visibly distinct (struck through/greyed) and labelled "Cancelled" for screen readers. Today highlighted. Student: clicking a chip opens a read-only details dialog. Admin/teacher (within their rights): chip dialog edits start/duration override, shows the class default hint, and cancel/restore — the same fields and validation errors as today. Admin: clicking a day opens a dialog to add class days (start date prefilled, "weekly until" end date) or cancel/restore that day if it is already a class day. Class defaults section stays as today (below the calendar). Grid/list switch at the app's existing phone breakpoint; no horizontal page scroll. Dialogs use iX modal components and are keyboard-operable with focus returned on close; Paraglide en/de/bo for any new strings; WCAG 2.2 AA.

**Decisions (user, 2026-09-25):** library `@event-calendar/core`; month grid wide, agenda list at phone width; editing in a dialog on click; week starts Monday; chips coloured per class (small fixed palette keyed by class id, cancelled chips grey); full spec kept despite ~1,770 tokens.

**Never:** No migration, RLS or action-contract change. No week/day time-grid views, drag-and-drop, resizing, or event creation by selecting ranges. Do not load more than one month per request. No other calendar library.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wide screen | 3 class days in Oct, 2 classes | Mon-first grid, 6 chips in 3 cells, today marked | N/A |
| Phone width | Same data | List view grouped by date, same chips | N/A |
| Navigate | Click next month | URL becomes `?month=2026-11`, grid shows November | Load error → alert |
| Cancelled | Day or session cancelled | Chip greyed/struck, "Cancelled" | N/A |
| Edit session | Teacher clicks own class chip, sets 11:00 | Dialog closes, chip shows 11:00 | Invalid time → error shown in dialog |
| Student | Clicks chip | Read-only details, no edit controls | N/A |
| Admin day click | Empty date | Add-class-days dialog with start prefilled | End before start → error in dialog |
| Admin day click | Existing class day | Cancel/restore day dialog | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/calendar/+page.svelte` -- replace the day list (230–402) with the calendar; keep header month label/`aria` semantics, the defaults section (166–228), toasts `$effect`, `pending`, `timeText`/`defaultHint`, error mapping. Existing forms move into dialogs; keep `use:enhance` + field names so actions and `page.server.spec.ts` stay valid.
- `src/routes/calendar/+page.server.ts` -- unchanged except, if needed, exposing month `first`/`last` for the calendar's `date`; `data.days` (from `shapeMonth`) is the event source.
- `src/lib/server/calendar.ts` -- `CalendarDay`/`CalendarSession` types; map to library events in a new pure helper (e.g. `toCalendarEvents(days)` in `src/lib/calendar-events.ts` + spec) with `id`, `start`/`end` as local date-times (all-day when start unset), `title`, and `extendedProps` holding the session.
- `@event-calendar/core` 5.x -- `import { Calendar, DayGrid, List, Interaction } from '@event-calendar/core'`, CSS `@event-calendar/core/index.css`; options `view: 'dayGridMonth' | 'listMonth'`, `firstDay: 1`, `date`, `eventClick`, `dateClick` (Interaction), `datesSet` for navigation, `eventContent` snippet, `locale` from `getLocale()`. Component touches the DOM: render client-side only (`browser` guard) with the server list/empty state as SSR fallback if needed.
- `src/lib/ix.ts` -- register any new icons; iX web components are browser-only (`setupIx`). `ix-modal` exists in `@siemens/ix` 5.2.
- `messages/{en,de,bo}.json` -- reuse `calendar_*`; add only dialog titles/close labels.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- do not edit; the month-grid entry is closed by this spec.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add `@event-calendar/core` ^5.15 -- the chosen library.
- [x] `src/lib/calendar-events.ts` + `.spec.ts` -- pure `CalendarDay[]` → event mapping (timed vs all-day, cancelled flag, class colour/status class) -- matrix rows testable without DOM.
- [x] `src/routes/calendar/+page.svelte` -- calendar (grid/list by breakpoint), `?month=` navigation, session dialog (edit or read-only), admin day dialog, keep defaults section.
- [x] `messages/{en,de,bo}.json` -- new dialog strings.
- [x] `src/routes/calendar/page.server.spec.ts` -- still passes unchanged (action contract untouched).

**Acceptance Criteria:**
- Given any signed-in role at 1280px, when opening `/calendar`, then a Monday-first month grid shows that role's sessions as chips and today is highlighted.
- Given a keyboard-only user, when tabbing to a chip and pressing Enter, then its dialog opens and Escape returns focus to the chip.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter = BH, edge-case-hunter = EC, verification-gap = VG):

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | EC, VG | Header "Add class days" opens cancel/restore when its default date (today / 1st) is already a class day | medium | `openDay` looks the date up in `data.days`; a hit renders the day branch, which has no add form | patch |
| 2 | EC | Admin click on a leading/trailing other-month cell shows the add form even if that date is a class day | low | `data.days` covers only `data.month`, so `selectedDay` is null there; admins click month edges routinely, fix is a guard line | patch |
| 3 | BH, EC | Load error renders an empty calendar next to the error | low | the `{#if !data.loadError}` gate was removed; fix is re-adding it | patch |
| 4 | BH, EC | Empty month shows no "no class days" message, admin hint lost; `calendar_empty_admin_hint` / `calendar_edit_session` orphaned | low | `noEventsContent` applies to list views only; grep finds no other use of either key | patch |
| 5 | BH | Modal `aria-label` set after `showModal()` resolves, so the dialog may be announced unnamed | low | the shadow `<dialog>` exists before opening; moving the line before `showModal` is a direct correction | patch |
| 6 | VG | "Time not set" chip / dialog text untested | low | no fixture session is unset; no test asserts the text | patch (test) |
| 7 | VG | Non-admin date click opening nothing is untested | low | only admin date-click tests exist | patch (test) |
| 8 | BH | Session cancel/restore from the dialog untested | low | no e2e drives `setSessionCancelled` | patch (test) |
| 9 | VG | `test:e2e` missing from the spec's Verification commands | medium | fix edits this build's spec | reject (spec edit) |
| 10 | BH | Cancelled chip ignores `day.cancelled` | false | `sessionStatus()` already returns `cancelled` when `day_cancelled` is set | reject |
| 11 | BH | `order` comment claims sorting the code does not do | false | `shapeMonth` sorts by start (unset last) then class name; `order` preserves that | reject |
| 12 | BH | Chip palette is light-only | false | app is light-only (`data-ix-color-schema="light"`, app.css phase-1 note) | reject |
| 13 | BH | Page needs JS / nothing before mount | low | spec Code Map sanctions client-only rendering; fix is non-trivial | reject |
| 14 | BH | Library "today" button uses the browser clock | low | only outside Europe/Berlin around a month boundary; non-trivial fix | reject |
| 15 | BH | Fast prev/next can bounce | maybe-false | SvelteKit aborts the superseded `goto`; low even if true | reject |
| 16 | BH | Admin phone day management untested | low | list `Day.svelte` renders the day-cell content, so the admin day-button exists in list view | reject |
| 17 | BH | Assorted missing e2e/unit cases (focus after save, defaults save, locale, `eventDomClass`) | low | edge cases, not everyday paths | reject |
| 18 | BH | `dayMaxEvents: false` makes crowded admin cells tall | low | only with many classes (local DB is test-polluted); matrix counts chips per cell | reject |
| 19 | BH | New `bo` keys are English copies | low | pre-existing project convention for `bo` | defer |
| 20 | BH | Playwright setup gaps (install step, CI flags, `loadEnv` comments) | low | no CI exists; local-only tooling | reject |
| 21 | BH | `aria-live` on h1; day-button label lacks status | low | chips next to the button carry the status | reject |
| 22 | EC | 00:00 start with no duration renders no chip | low | midnight classes unrealistic; needs a special case | reject |
| 23 | EC | `goto` rejection leaves grid on the new month | low | navigation failure is rare; needs catch/rollback logic | reject |
| 24 | BH, EC | Failed `showModal` locks later dialogs | low | modals render under the same `mounted` gate as the calendar, so they are bound before any click | reject |
| 25 | EC | A late success closes an unrelated newly opened dialog | low | requires closing a dialog mid-submit and opening another; needs submit tracking | reject |
| 26 | EC | Session dialog empty if the session vanishes on reload | low | needs a concurrent delete by another user | reject |
| 27 | EC | Fixture year collision across concurrent runs | low | 1-in-6000 and `workers: 1` | reject |
| 28 | EC | `prevMonth` / `nextMonth` / `currentMonth` unused in load | low | the server file is meant to stay unchanged | reject |

## Verification

**Commands:**
- `npm test` -- expected: pass (apart from the known Story 5-1 `classes` test), incl. new mapping spec.
- `npm run check` -- expected: 0 errors.
- `npx eslint` / `npx prettier --check` on changed files -- expected: clean.

**Manual checks (if no CLI):**
- As admin, teacher and student at 1280px and phone width: grid vs list, navigation, chip dialogs, admin day dialog, no horizontal scroll.
