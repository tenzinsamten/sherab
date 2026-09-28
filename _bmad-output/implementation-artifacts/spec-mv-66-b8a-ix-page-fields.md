---
title: 'B8a — iX form fields, part 2a: calendar dialogs, admin, requests (#66)'
type: 'refactor'
created: '2026-09-28'
status: 'done'
baseline_commit: '418ab2785da830bf76007d7e6c85db3e00388087'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The calendar dialogs, the admin classes/teams/teachers create forms and the requests approve form still use native fields, so they look inconsistent with the iX UI (#66).

**Approach:** Convert their visible fields to iX (`ix-input`, `ix-time-input`, `ix-number-input`, `ix-date-input`, `ix-select`). Keep field names, posted formats and server actions. Reuse `src/lib/ix-fields.ts` and the B7/B7b patterns.

**Decisions:** 2026-09-28 — B8 split: this build is B8a; the teacher class page and homework new/edit are B8b (their per-student skill fields become collapsible rows there). The requests page keeps one team select per pending row (lists are short in practice).

## Boundaries & Constraints

**Always:** Same `name`s and posted formats (times `HH:mm`, dates `YYYY-MM-DD`, empty time/duration post as empty, never iX defaults). Visible labels. Inline dialog errors (`#session-error`, `#extra-error`, `#add-days-error`) show with the field's iX invalid state and stay linked for screen readers (`ixFieldError`, forms `novalidate`). After a successful create, the admin name/email fields are empty again. A select whose options change after a save posts a value that is actually one of its options.

**Never:** No server, schema or migration changes. Don't touch B8b pages, credential fields or hidden inputs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Session override | set 11:00 / 60 in session dialog | posts `startTime=11:00`, `durationMinutes=60`; chip moves | N/A |
| Session reset to default | clear both fields | posts both empty; class default used | N/A |
| Session invalid | duration 5 | `#session-error` under the fields, invalid state, dialog stays open | server error |
| Add class days | start prefilled with clicked date, end before start | `#add-days-error`, invalid state | server error |
| Extra session | add one, reopen same day | the class just added is no longer offered; select posts a listed class | N/A |
| Admin create | create class / team / teacher | toast; name (and teacher email) fields empty | toast on error, values kept |
| Approve student | pick team, approve | student approved with that team; row gone | no team → nothing sent; select invalid with an inline, announced message (user decision 2026-09-28) |

</frozen-after-approval>

## Code Map

- `src/routes/calendar/+page.svelte` -- session modal form `?/updateSession` (~637, `novalidate`, reset true): `#session-start` time, `#session-duration` number (15–480 step 5), inline `#session-error` from `sessionError` (185-191), hint `#session-hint`. Day modal: `?/addExtraSession` (~806): `#extra-class` select from `extraClasses` (201, changes after success, no placeholder), `#extra-start`, `#extra-duration`, `#extra-error` + `#extra-intro`; `?/addClassDays` (~870): `#add-start` (required, `value={selectedDate}`), `#add-end`, `#add-days-error`. Modal content remounts per open.
- `src/routes/admin/classes/+page.svelte:88` -- `#name` outside the existing `{#key form}` (ScheduleFields); move it inside or clear it after success.
- `src/routes/admin/teams/+page.svelte:61` -- `#name`, form not `novalidate`, no `{#key}`: needs a remount after success.
- `src/routes/admin/teachers/+page.svelte:104,116` -- `#email` (a teacher being created, not a login credential), `#displayName`; already inside `{#key createKey}`.
- `src/routes/requests/+page.svelte:190` -- per-row `select#team-{student.id}` name teamId, required, disabled "" placeholder, `disabled` when no teams. `ix-select required` does not block submit: guard empty submit like `EnrollmentPanel` (`$lib/components/EnrollmentPanel.svelte`).
- `src/lib/ix-fields.ts` -- `ixValue(value)` (write-on-change; `null` = empty for time/number), `ixFieldError(errorId)` (needs `novalidate`), `durationValue`.
- `e2e/calendar.e2e.ts` -- selectors to update: 166-188 (`#session-start`/`#session-duration`; line 171 switches the input to `type=text` to type `25:00` — replace with an invalid value iX accepts, e.g. duration 5), 226-227, 350 (`#add-start`/`#add-end`), 599-601, 620-621 (`#extra-class` `selectOption` / `option` count → `ix-select-item`), 679, 730 (`#name`). Patterns: `toHaveJSProperty('value', …)`, type into `#id input`, read `ariaDescribedByElements` (not `toHaveAccessibleDescription`).

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/calendar/+page.svelte` -- convert the three dialog forms; values via `ixValue`, errors via `ixFieldError`; `#extra-class` remounts (`{#key}`) when `extraClasses` changes
- [x] `src/routes/admin/classes/+page.svelte`, `admin/teams/+page.svelte`, `admin/teachers/+page.svelte` -- convert; empty after a successful create (key remount), kept after an error
- [x] `src/routes/requests/+page.svelte` -- per-row `ix-select`; block an empty submit with the invalid state instead of posting
- [x] `e2e/calendar.e2e.ts` -- update selectors; cover session reset-to-default (both empty), the extra-class select after a success, and the session error's invalid state + linked description
- [x] `e2e/forms.e2e.ts` -- admin team create clears the name; requests approve with a team, and empty-team submit sends nothing
- [x] `_bmad-output/manual-verification-issues.md` -- #66 part 2a "fixed, to verify"

**Acceptance Criteria:**
- Given any B8a form, when submitted, then the server receives the same field names and value formats as before and existing `page.server.spec.ts` tests pass unchanged.
- Given the calendar session dialog, when opened for a session with no overrides, then both fields are empty (not 00:00, the current time or 0).

## Implementation Notes

- Requests: an empty approve shows an inline `#team-<id>-error` ("Choose a team before approving.") with the select's invalid state, like EnrollmentPanel, instead of a toast; the server's toast remains for a no-JS post.
- The session hint (`#session-hint`) and extra intro (`#extra-intro`) stay visible but are no longer linked as descriptions: `ixFieldError` links only the error.
- Admin classes: `#name` moved inside the existing `{#key form}`, so any action result (including a delete) remounts it with the server-returned value.
- A cleared `<ix-number-input>` reports `value` `undefined` (it loads with `null`); it posts empty either way.

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | B1 + B2: session and extra-session fields lost their standing hint description (`#session-hint`, `#extra-intro`) | medium | baseline linked them via `aria-describedby="session-hint …"` / `"extra-intro …"` (418ab27 calendar:653,668,835,849); `ixFieldError` links only the error | patch |
| 2 | E1 + E2 (and implementer risk 3): /admin/classes name now inside `{#key form}` and is wiped by any action result, e.g. deleting a class | medium | `{#key form}` changes on every action result; before B8a the name sat outside it | patch |
| 3 | B5 + V1: /admin/teachers iX email/display name untested | medium | no e2e or server spec visits /admin/teachers | patch |
| 4 | V2: class create keeping the name after a failure is untested | medium | e2e covers only successful creates | patch |
| 5 | E4: forms.e2e team fixture leaks if `createUser` fails before `try` | low | direct fix: move into `try`, guard cleanup | patch |
| 6 | B3: teams form `novalidate` lets an empty name reach the server; field not marked | maybe-false | whether `ix-input required` would block submit without `novalidate` is unverified; the server toast `teams_error_name_required` still answers; would be low | rejected |
| 7 | B4: duplicate-name test uses a loose `/already/i` regex | low | cosmetic test precision | rejected |
| 8 | B6: requests server team-required error not tied to the field | false | only reachable without JS; iX fields need JS | rejected |
| 9 | B7: `teamMissing` entries never cleared after approval | false | an entry exists only while the submit was blocked; picking a team (needed to approve) deletes it via `onvalueChange` | rejected |
| 10 | B8 + E3: guard shows "choose a team" when no teams exist | false | Approve is `disabled` when `data.teams.length === 0` (requests `+page.svelte`), so the guard can't run | rejected |
| 11 | B9: no fallback where `ariaDescribedByElements` is unsupported | low | supported in current Chromium, Safari and Firefox; the visible `role="alert"` message still shows | rejected |
| 12 | B10: teams test waits on `networkidle` | low | same pattern as existing passing tests | rejected |
| 13 | B11: extra-class select resets to the first class when the offered list changes | low | the list changes only after an add (which removes the picked class) or another admin's edit | rejected |
| 14 | B12: duplicated duration poll in the calendar test | low | test duplication only | rejected |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
