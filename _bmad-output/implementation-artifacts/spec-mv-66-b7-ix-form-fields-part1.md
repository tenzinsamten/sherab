---
title: 'B7 — iX form fields, part 1: shared form components (#66)'
type: 'refactor'
created: '2026-09-28'
status: 'done'
baseline_commit: 'e23c27e9ce36284c76cd4d6c6eceed0fb0f90509'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/component-specs.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Forms mix native fields with iX components, so they look inconsistent with the rest of the iX classic UI (#66).

**Approach:** Replace the visible native fields in the five shared form components (ScheduleFields, LinkRows, SyllabusForm, SyllabusList, EnrollmentPanel) with iX form fields (`ix-checkbox`, `ix-select`, `ix-time-input`, `ix-number-input`, `ix-date-input`, `ix-input`, `ix-textarea`). Keep the same `name`s, native form posts and `use:enhance`, so the server actions don't change. These components set the field patterns that B7b (auth/account) and B8 (other pages) reuse.

**Decisions:**
- 2026-09-28 — credential fields (email/username/password) stay native in later builds (password managers); no credential fields are in this build's scope.
- 2026-09-28 — /calendar class schedules become collapsible rows: each class shows a one-line summary (name, weekdays, start time, duration, interval when not weekly) and its ScheduleFields render only while that row is expanded (option A; rendering all forms expanded froze the page with ~128 classes).

## Boundaries & Constraints

**Always:** Keep every field `name` and submitted value format the same (dates `YYYY-MM-DD`, times `HH:mm`, one `weekday` entry per checked day, `linkUrl`/`linkLabel` entries in row order). Labels are always visible. Required, min/max/step and length limits keep working. ScheduleFields' server errors show under the right field with the iX invalid state and stay linked by `aria-describedby`. Where a form resets after a successful submit today, the iX fields clear too. Saving one form never overwrites unsaved edits in another. Messages go through paraglide `m.*()`.

**Never:** No server action, loader, schema or migration changes. Don't touch auth pages, `/account` (B7b) or page-level fields in calendar, admin, teacher, homework, requests (B8) — the /calendar change is limited to the collapsible schedule rows. Hidden inputs stay native `type="hidden"`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Schedule save | Mon+Wed, every 2 weeks, 17:00, 60 min, start and end dates | FormData identical to today (`weekday`×2, `intervalWeeks=2`, `startTime=17:00`, `durationMinutes=60`, ISO dates) | N/A |
| Schedule prefill | class with saved schedule | all fields show saved values; untouched submit posts them unchanged | N/A |
| Schedule error | server returns `errors.weekday` / `errors.endsOn` | message under that field, field invalid, linked via aria | existing `errors` prop |
| Link rows | 3 rows, middle empty | `linkUrl`/`linkLabel` posted in row order, empty row as empty strings | server `parseReferenceLinks` unchanged |
| Required select empty | EnrollmentPanel, no student chosen | no request sent; iX required state shown | browser/iX validation |
| Many classes | /calendar with ~130 classes | grid renders; schedule rows collapsed with summaries; expanding one shows its form | N/A |
| Schedule error on collapsed page | save in an expanded row fails | that row stays expanded and shows the error | existing `errors` prop |

</frozen-after-approval>

## Code Map

- `src/lib/components/ScheduleFields.svelte` -- 7 `weekday` checkboxes, `intervalWeeks` select (1–4), `startTime`, `durationMinutes` (15–480 step 5), `startsOn` (required) / `endsOn`; `errors` prop → `.field-error` (`role="alert"`) + aria. Hosted by `src/routes/calendar/+page.svelte:480-520` (one form per class, `reset:false`) and `src/routes/admin/classes/+page.svelte:97` (inside `{#key form}`).
- `src/routes/calendar/+page.svelte:480-520` -- schedules `<ul class="row-list">`: make each `<li>` collapsible (e.g. `<details>`/disclosure button with `aria-expanded`), summary line from `cls.*`, render the form only when open; keep open the row whose save returned errors (`form.classId`). e2e must expand a row before using its fields.
- `src/lib/components/LinkRows.svelte`, `SyllabusForm.svelte`, `SyllabusList.svelte`, `EnrollmentPanel.svelte` -- as in the first attempt (see KEEP in Spec Change Log).
- `src/lib/pending.svelte.ts` -- default `update({reset:true})`; iX fields have no `formResetCallback`.
- `src/app.css:310-380` -- forms comment; keep rules still used by B8 pages.
- iX facts: fields are form-associated; `ix-date-input format="yyyy-MM-dd"`; `ix-time-input format="HH:mm"`; `ix-number-input` defaults to 0 and `ix-time-input` to now unless set to `null` after load; `required` does not block submit; the date input omits an empty value from FormData (server treats it as "").
- First attempt for reference: `/private/tmp/claude-501/-Users-tenzinsamten-Desktop-personal-project-tib-class/aeeac47d-6522-4f8d-8aaf-dfb669044c58/scratchpad/b7-attempt1/` (`tracked.diff`, `ix-fields.ts`, `forms.e2e.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/ix-fields.ts` -- field helpers: error state (only clear `ariaDescribedByElements` it set; `aria-invalid`/`aria-describedby` on the host only for `ix-checkbox`, otherwise on the native control) and value setting that writes only when the incoming value actually changed, so a reload of other data never overwrites unsaved edits; export a pure duration mapping (null/''/whitespace/NaN → null) -- triage #2, #9, #11, #13
- [x] `src/lib/ix-fields.spec.ts` -- unit-test the duration mapping
- [x] `src/lib/components/ScheduleFields.svelte` -- convert fields; set every value (dates, interval, time, duration) through the value helper
- [x] `src/routes/calendar/+page.svelte` -- collapsible schedule rows per Decisions
- [x] `src/lib/components/{LinkRows,SyllabusForm,SyllabusList,EnrollmentPanel}.svelte` -- convert fields; EnrollmentPanel guards empty submit and remounts after success
- [x] `src/lib/pending.svelte.ts` -- doc: iX fields ignore reset; name the real `{#key}` sites (EnrollmentPanel, `admin/classes/+page.svelte`) -- triage #10
- [x] `src/app.css` -- update the native-fields comment
- [x] `e2e/calendar.e2e.ts` -- expand rows before editing; seed class D with interval 2 and duration 45 and assert both survive a weekday-only save (field + DB); an "Until before From" save shows `ix-invalid` + accessible description on the date field; admin create with blank time/duration stores null for both; many-classes check that the grid renders with collapsed rows -- triage #3–#6
- [x] `e2e/forms.e2e.ts` -- link-rows and enrol tests; fail on any `?/enroll` request via route instead of `waitForTimeout`; after enrol the select is empty and a second submit is blocked; assert the new syllabus `school_year` is the current year -- triage #7, #8, #12
- [x] `_bmad-output/manual-verification-issues.md` -- note #66 part 1 "fixed, to verify"

**Acceptance Criteria:**
- Given the admin classes or calendar schedule form, when saved, then the stored schedule is identical to what the native form produced for the same choices.
- Given two expanded schedule rows with an unsaved edit in one, when the other is saved, then the unsaved edit stays.
- Given a syllabus with links, when saved and reopened, then text and links round-trip unchanged.
- Given an enrollment, when a student is chosen and submitted, then the student is enrolled and the select resets.

## Implementation Notes

2026-09-28 (dev):
- New `src/lib/ix-fields.ts`: `ixFieldError(errorId)` is an attachment that sets `ix-invalid`, `aria-invalid` and `aria-describedby` on the host. It also sets `ariaDescribedByElements` on the native control inside the shadow DOM, pointing at the light-DOM `.field-error`. `ixValue(value)` sets `value` after the component has loaded. It is needed because `ix-number-input` defaults to 0 and `ix-time-input` defaults to the current time, so an empty duration or start time would otherwise post "0" or the time of day. Pass `null` for an empty value.
- Error and invalid state are set in attachments, not template attributes. Svelte sets a template's attributes in one effect, so an error appearing would otherwise re-apply the server `value`/`checked` over the user's edits (calendar uses `reset: false`).
- ScheduleFields: `ix-checkbox` (with `aria-label`), `ix-select`, `ix-time-input` (`HH:mm`), `ix-number-input`, and two `ix-date-input` fields (`yyyy-MM-dd`). Errors stay as light-DOM `.field-error` with `role="alert"`. The weekday pill styling was dropped.
- LinkRows: `ix-input` with `value` and `onvalueChange`. Checked that the POST keeps row order and sends an empty middle row as empty strings. `inputmode=url` was dropped (ix-input has no such attribute; `type=url` would add URL validation).
- SyllabusForm: `ix-textarea`. SyllabusList: `ix-select`, preselecting the current year or the first addable year.
- EnrollmentPanel: `ix-select` with a placeholder. `required` on an iX field doesn't block submit, so the enhance handler cancels an empty submit and shows `ix-invalid` with `enroll_error_pick`. After a successful enrol the form is remounted with `{#key}`. `pending.svelte.ts` doc updated; admin/classes already remounts via `{#key form}`.
- `ix-date-input` omits `endsOn` from FormData when empty (native sends ""). The server reads it as "", so the stored schedule is the same. Invalid typed dates keep the last valid value.
- Touched: src/lib/ix-fields.ts (new), src/lib/components/{ScheduleFields,LinkRows,SyllabusForm,SyllabusList,EnrollmentPanel}.svelte, src/lib/pending.svelte.ts, src/app.css (comment only, no rules removed: all still used by B8 pages), e2e/calendar.e2e.ts (host `value` via `toHaveJSProperty`; typing into the inner `input`; `click()` + `expect` instead of `check()` because ix-checkbox updates `aria-checked` asynchronously; new asserts that time and duration start empty), _bmad-output/manual-verification-issues.md (#66 part 1 fixed, to verify).
- Matrix tests added in e2e/forms.e2e.ts (calendar fixture, class C, admin): "link rows: a blank middle row is skipped, rows 1 and 3 save and reopen in order" (posted order incl. empty middle row, stored links, reopened form) and "enrol: no student chosen sends nothing and marks the select; choosing one enrols them" (no ?/enroll POST, `ix-invalid` + message, then enrolment in DB). `supabase:reset` then `test:e2e`: 21/21 passed, exit 0.
- Risk found: with ~128 classes (what `npm test` leaves in the local DB) the admin /calendar never renders its grid: `.ec-day-grid` stays hidden more than 5 minutes. Baseline renders in about 4s. That is about 128×12 iX fields plus pickers. Not investigated further. Run e2e on a freshly reset DB.

- 2026-09-28 (review loop 1): attempt 1 code reverted to baseline after the intent_gap; saved in the scratchpad `b7-attempt1/`.

2026-09-28 (dev, attempt 2):
- `ixValue(value, prop)` now covers `value` and `checked`, keeps the last incoming value per host and skips unchanged ones (triage #2). It writes right away (attribute before iX is defined, property after) and again after `componentOnReady`. The right-away write is needed: `ix-select` sets its form value only on load and on user picks, not when `value` changes later; writing only after load posted no `intervalWeeks` (server default 1).
- `ixFieldError`: ARIA on the host only for `ix-checkbox`; other fields get `aria-invalid` + `ariaDescribedByElements` on the native control; cleanup undoes only what it set (#11, #13). `durationValue` extracted and unit-tested (#9).
- /calendar: schedule rows are disclosure buttons (`h3 > button[aria-expanded]`, summary from `cls.*`, new messages `calendar_schedule_duration_short`, `calendar_schedule_no_weekdays` in en/de/bo); form rendered only while expanded; a save with errors keeps its row open.
- e2e: class D now every 2 weeks from the Monday of the first fixture day's week, moved to a weekday in that same week; new tests for two expanded rows, blank time/duration, ~130 classes; forms.e2e uses `page.route` for `?/enroll`, a second enrollable student, and checks `school_year`.
- Verified: `supabase:reset`, `npm test` (650 passed), `npm run check` (0 errors), `npm run build` (exit 0), then reset + `test:e2e` 24/24 passed. `npm run lint` fails on Prettier across 183 files, also on baseline; changed files pass Prettier and ESLint.
- Review fixes: SyllabusList year select and ScheduleFields interval select remount (`{#key}`) when their incoming value changes (ix-select takes its form value only on load); opened schedule rows stay mounted and are `hidden` when collapsed; `aria-controls` only once the panel exists; dead re-open `$effect` removed; EnrollmentPanel error is a light-DOM `.field-error` linked via `ixFieldError`, and focus returns to the remounted select; e2e adds summary, collapse/re-expand, first-addable-year and focus checks, deterministic class codes.
- Seen: the existing "today is highlighted" e2e fails when `npm test` has left a class day on today's date (the day becomes a button without the visible "Today" text). Data-dependent, not from this change.

## Spec Change Log

- Loop 1 (2026-09-28). Trigger: review triage #1 (intent_gap). The admin /calendar grid never rendered with ~128 classes because every class's ScheduleFields (~12 iX components) rendered expanded. The user chose option A, collapsible rows. Amended: Decisions, Never, the matrix (2 rows), Code Map, and Tasks (which now also carry patch findings #2–#13). Known-bad state avoided: a frozen calendar page, and one class's save overwriting unsaved edits in other class forms. KEEP from attempt 1 (in the scratchpad path in Code Map):
  - `ix-fields.ts` attachment approach: invalid and aria state set outside template attributes.
  - `ixValue` writing `null` after `componentOnReady`.
  - `ix-checkbox` weekdays with `label` and `aria-label`.
  - `ix-date-input format="yyyy-MM-dd"`.
  - EnrollmentPanel's `SubmitFunction` guard and its `{#key enrollKey}` remount.
  - SyllabusList's `initialYear` preselect.
  - LinkRows `value` + `onvalueChange`.
  - e2e: `toHaveJSProperty('value')`, typing into the inner `input`, and `click()` + `expect` for ix-checkbox.
  - `forms.e2e.ts` structure.

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | V-other: admin /calendar grid never renders with ~128 classes | high | Implementer observed grid hidden >5 min vs ~4s on baseline with same data; `calendar/+page.svelte:480-520` renders every class's ScheduleFields (~12 iX components each) expanded under the grid | intent_gap |
| 2 | E1 + B4 + B5: saving one class on /calendar re-sets `value` on every other class's iX date/interval/time/duration fields, wiping unsaved edits | medium | `reset:false` + reload rebuilds `cls` objects; custom-element props are re-assigned on each effect run (template `value=` and `ixValue` attachment both depend on the `cls` getter) | patch (moot until #1) |
| 3 | B6: blank time/duration never checked as posted/stored | medium | create test only checks host `value` before filling | patch |
| 4 | V1: saved duration surviving a weekday-only save untested | medium | schedule-edit test never reads duration back | patch |
| 5 | V2: interval preselect/post untested | medium | no `interval` in e2e; all fixtures use 1 | patch |
| 6 | V4: server errors on shadow-DOM fields untested | medium | only weekday error path exercised | patch |
| 7 | V3: enrol select cleared after success untested | low | test ends at toast/DB check | patch |
| 8 | V5: syllabus school_year untested | low | DB select omits school_year | patch |
| 9 | B12 + E6 + E3: duration mapping has no unit test; whitespace string maps to 0 | low | `Number(' ') === 0`; mapping inline in component | patch (extract + unit test) |
| 10 | B10: pending.svelte.ts comment credits ScheduleFields with `{#key}` | low | `{#key form}` is in `admin/classes/+page.svelte:97` | patch |
| 11 | B1: `ixFieldError` sets `ariaDescribedByElements = null` even when it never set it | low | direct fix: only clear what it set | patch |
| 12 | B11: enrol "no POST" check uses waitForTimeout(500) | low | direct fix: fail on any `?/enroll` route | patch |
| 13 | B2: aria-invalid/describedby on role-less iX hosts | low | harmless but invalid ARIA; direct deletion for non-checkbox hosts | patch |
| 14 | B7 + E5: LinkRows lost `inputmode="url"` | low | ix-input exposes no inputmode; fix needs shadow-DOM workaround | rejected (low, non-trivial fix) |
| 15 | B3: weekday error announced per checkbox and on fieldset | false | baseline did the same (fieldset + `weekdayErrorState` on every input) | rejected |
| 16 | B8: LinkRows on homework pages untested, mixed styling | low | mixed styling is the agreed B8 split; LinkRows covered by forms.e2e | rejected |
| 17 | B9: SyllabusList posts currentYear when addableYears empty | maybe-false | add form likely hidden when no addable years; check `SyllabusList.svelte` guard | rejected (would be low) |
| 18 | B13: other iX forms relying on default reset | low | SyllabusList add navigates to edit on success | rejected |
| 19 | E2 + E7: out-of-range intervalWeeks echoed | false | only reachable by a tampered post; server rejects out-of-range values | rejected |
| 20 | E4: late `ixValue` write overwrites typing before iX loads | low | needs typing before iX hydrates; unlikely | rejected |

Pass 2, loop 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 21 | B1 + E5 + V1: SyllabusList `<ix-select value=…>` keeps posting the old year when `addableYears` changes after a create; fallback year untested | medium | the add form stays mounted (`SyllabusList.svelte:97-115`, no `{#key}`); `ix-select` only takes its form value on load | patch |
| 22 | B3 + E1: collapsing an edited schedule row unmounts the form and drops unsaved edits | medium | `{#if open}` in `calendar/+page.svelte`; nothing keeps the edits | patch |
| 23 | B4: focus falls to `<body>` after enrol remounts the form | medium | `{#key enrollKey}` removes the focused button | patch |
| 24 | B5: enrol "choose a student" error is visual only | low | `studentError` sets no aria and no live region; direct fix is to reuse `ixFieldError` | patch |
| 25 | E6: loaded interval `ix-select` shows a newer server value but posts the old form value | low | same load-only form value as #21; needs another admin's edit to reach | patch |
| 26 | V-other: `$effect` that re-opens rows with errors is dead code | low | the form exists only while its row is open, so an error always comes from an open row; direct deletion | patch |
| 27 | E4: `aria-controls` points at a panel that is not rendered | low | direct fix: set only when the panel exists | patch |
| 28 | B8: `ixValue` doc says it writes attributes on the server-rendered page | low | attachments run at hydration, not SSR; comment correction | patch |
| 29 | V2: summary branches (weekly, no time) unasserted | low | only the every-2-weeks case is asserted; two `toContainText` checks | patch |
| 30 | E7: 130 random 5-hex class codes collide in ~1% of runs | low | birthday bound ≈ 130²/2/16⁵ ≈ 0.8%; direct fix: deterministic unique codes | patch |
| 31 | E8: `deleteUser` error ignored in forms.e2e cleanup | low | direct fix: throw on error | patch |
| 32 | E9: `posts[0]` read without asserting a POST happened | low | direct fix: assert length 1 first | patch |
| 33 | B2: SyllabusForm textarea `value=` re-applied on reload | false | baseline native `<textarea value=…>` behaved the same; no other form on that page reloads it mid-edit | rejected |
| 34 | B6: server-side empty `studentId` untested | low | pre-existing server behaviour, not changed here | rejected |
| 35 | B7: weekday checkboxes described per box and on fieldset | false | carried #15: baseline did the same | rejected |
| 36 | B9 + E10: LinkRows lost `inputmode="url"` | low | carried #14 | rejected |
| 37 | B10: homework link rows untested | low | carried #16; homework create redirects, so there is no reset issue | rejected |
| 38 | B11: `ixValue`/`ixFieldError` lack unit tests | low | Vitest runs in node without custom elements; behaviour covered by e2e (two-rows, error-state tests) | rejected |
| 39 | B12: e2e hard-codes fixture day-of-month | low | passed 10 repeats; would only break if the fixture changes | rejected |
| 40 | B13: weekday/interval labels defined twice | false | both use the same `m.*` messages, so the text cannot drift | rejected |
| 41 | B14 + B15: summary lacks dates; no filter/search | false | the intent Decision fixes the summary fields; search is not in the intent | rejected |
| 42 | B16: heading's name includes the summary | low | standard disclosure-in-heading pattern; cosmetic | rejected |
| 43 | V-other + E3: schedule forms need JS | false | iX fields need JS anyway (web components); no no-JS path existed for them | rejected |
| 44 | E2: errors shown again after collapse/re-expand | low | resolved by #22's fix (the form stays mounted with its state) | rejected |

## Design Notes

Value binding (iX fields don't support `bind:value`):

```svelte
<ix-input name="linkUrl" label={m.link_url()} value={row.url}
  onvalueChange={(e) => (row.url = e.detail)} max-length="2000"></ix-input>
```

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run test:e2e` -- expected: calendar schedule journey passes

**Manual checks:**
- Save a schedule on admin classes and on the calendar page (incl. a validation error), add/edit syllabus with links, enroll and unenroll a student.
