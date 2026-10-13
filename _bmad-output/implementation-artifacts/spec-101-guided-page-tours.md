---
title: '#101 Guided page tours for parents and teachers'
type: 'feature'
created: '2026-10-13'
status: 'done'
route: 'dispatch'
baseline_commit: '925cc95fa3f206ae3e4b53ba2d567e39e8a4e45b'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parents and teachers struggle to use the app. The written guides in Help (#87) describe the pages but do not show, on the page itself, where to tap. Reported by the user: "we need guided tutorial for the user when they login and option to use it when they are not sure from help section". The worst spots: a parent saying a child can't come (Sessions: Coming / On leave / Sick, leave period); a teacher marking attendance and skills; a teacher creating and reviewing homework and approving under Requests.

**Approach:** A short spotlight tour (2-5 steps) starts by itself the first time a parent or teacher opens each key page, pointing at the real controls. The account remembers which tours it has seen. Help gets "Show me around this page", which runs the current page's tour again.

## Boundaries & Constraints

**Always:**
- Eight tours: parent home (child card, username and PIN); child page Overview (the tabs, naming Sessions); child page Sessions (the session list, the answer buttons, planned vs short-notice, "Plan a leave period"); teacher home (class card, class code, Open); teacher class page (session picker, ticking attendance and Save, skill level, the note parents see, the way to Homework); class homework list (Create homework, filter, Reviewed and Archive); new homework form (content and its language, who gets it and how often, due date); Requests as teacher (registrations, Sick answers, class join requests).
- A tour belongs to a role and a page. It runs for that active role only; a login that is both teacher and parent gets each role's tours.
- Seen is stored per account in the database, so a tour starts by itself once per person, on any device. Existing accounts see each tour once too.
- A step whose control is not on the page is left out. A tour with no step left does not start and is not marked seen, so it starts on a later visit.
- Every tour can be left at any step (Skip, Esc, the close button) and never returns by itself afterwards.
- Usable at phone width (390px) and by keyboard; steps point only at page content, never at the collapsed side menu.
- All tour texts and buttons exist in en, de and bo.

**Never:**
- No tours for students or the admin, and none on signed-out pages. No single welcome tour at first sign-in.
- No tour that navigates between pages or fills in or submits anything.
- No change to the written guides, the FAQ or their screenshots.
- No push to the hosted database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit | Teacher opens a class page, tour not seen | Tour starts; marked seen as it starts | N/A |
| Later visit | Same page, same account, another device | No tour | N/A |
| Replay | Help, "Show me around this page" on a page with a tour | Help closes, the tour runs from step 1 | N/A |
| Page without a tour | Help opened on e.g. `/calendar` | No button; a line says where tours exist | N/A |
| Nothing to point at | Parent with no child yet opens `/parent` | No tour, not marked seen | N/A |
| Some controls missing | Requests with no Sick answers | Tour runs without that step | N/A |
| Both roles | Teacher + parent login, acting as parent on a child page | Parent tour; teacher tours untouched | N/A |
| Admin on `/requests` | Active role admin | No tour, no button | N/A |
| Saving fails | Marking seen returns an error | Tour still runs; it may start once more later | Logged, no message to the user |
| Left midway | User navigates away during a tour | Tour closes, stays seen | N/A |
| Unknown tour id | POST with an id that is no tour | 400, nothing stored | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte:190-195, 304-320` -- `helpRoles` and the `<ix-menu-about>` help overlay; `role` (line 73) is the active role. The replay button and the tour runner mount here. `ix-menu` has `toggleAbout(false)` to close the overlay.
- `src/routes/+layout.server.ts:37-41` -- selects `profiles.*`, so a new column arrives as `data.profile.tours_seen` with no change. The load does not re-run on navigation for a single-role login: keep the seen set in client state.
- `src/lib/help.ts`, `src/lib/components/HelpGuide.svelte` -- the pattern for a typed registry with message functions. Do not change the guides.
- `src/routes/api/push/subscription/+server.ts` -- pattern for a signed-in JSON endpoint calling an RPC for the caller's own row. `profiles` has no update-own policy.
- `supabase/migrations/0043_auto_team_assignment.sql` -- latest migration and header style; before-update triggers on `profiles` (0024 `guard_profile_link_columns`, 0043) must keep passing.
- `src/lib/supabase/database.types.ts` -- maintained by hand; never regenerate.
- Tour targets (add `data-tour` attributes only, no other change): `src/routes/parent/+page.svelte`; `src/routes/parent/children/[id]/+page.svelte:287` (tabs), `:456-545` (leave period), `:653-780` (sessions and answer buttons); `src/routes/teacher/+page.svelte:89-96`; `src/routes/teacher/classes/[id]/+page.svelte:256-305` (attendance), `:305+` (skills); `.../homework/+page.svelte:103-190`; `.../homework/new/+page.svelte:91-196`; `src/routes/requests/+page.svelte:228, 379, 499`.
- `playwright.config.ts`, `e2e/fixtures.ts` -- every e2e run signs in fresh users; a tour that auto-starts would cover their pages.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0044_tours_seen.sql` (next free number) -- `profiles.tours_seen text[] not null default '{}'`; `mark_tour_seen(p_tour text)`, security definer, appends to the caller's own row once, granted to `authenticated` -- the memory.
- [x] `src/lib/supabase/database.types.ts` -- add the column and the function by hand.
- [x] `src/lib/tours.ts`, `src/lib/tours.spec.ts` -- registry of the eight tours (id, role, route id, optional tab, steps of `data-tour` target + title + body) and `tourFor(role, routeId, tab)`; unit-test the matrix's matching rows.
- [x] `src/routes/api/tours/seen/+server.ts` + spec -- POST `{ tour }`: 401 signed out, 400 unknown id, else the RPC.
- [x] `package.json`, `src/lib/components/PageTour.svelte` -- add `driver.js`, imported only when a tour runs; start after navigation once targets exist, drop missing steps, mark seen at start, close on navigation; iX theme colours, no animation under reduced motion; no auto-start when `navigator.webdriver` is true.
- [x] `src/routes/+layout.svelte` -- mount `PageTour`; in the help overlay, above the tabs' content, the replay button or the "where tours exist" line.
- [x] The eight pages above -- `data-tour` attributes.
- [x] `messages/en.json`, `de.json`, `bo.json` -- `tour_*` texts and Next / Back / Done / Skip / "{current} of {total}".
- [x] `e2e/tours.e2e.ts` -- with `navigator.webdriver` overridden: first visit starts, second does not, replay from Help, phone width.
- [x] `_bmad-output/specs/spec-class-tracker/SPEC.md`, `roles-and-permissions.md` -- record the capability; replace the "possible future onboarding flow" line.

**Acceptance Criteria:**
- Given a teacher who has seen no tour, when they open a class page, then the tour highlights the session picker first and Next reaches the last step, which ends with Done.
- Given that teacher signs in on another browser, when they open the same page, then no tour starts.
- Given a parent on a child's Sessions tab at 390px width, when the tour runs, then each highlighted control and its text are fully on screen.
- Given any page with a tour, when Help's "Show me around this page" is pressed, then Help closes and the tour starts, whether or not it was seen.
- Given the existing e2e suite, when it runs, then no tour appears and it passes unchanged.

## Implementation Notes

- Tour ids and their `data-tour` targets are in `src/lib/tours.ts`. A step points at the first element with its target that is shown, so a list contributes its first row, never the whole list (a whole list does not fit a phone screen).
- Targets that differ from a literal reading of the tour list, because the control is not on that page:
  - Parent home, "username and PIN": the page shows neither (#100 shows them at registration only). The step points at an approved child's name and says the child signs in with their own username and PIN, and that the teacher gives a new PIN.
  - Homework list, "Reviewed and Archive": both buttons are on the homework's own page. The step points at the first homework in the list and names them.
  - Class page, "skill level" and "the note parents see": both fields are inside a student's collapsed row. One step points at the "Skill status" heading, the next at the first student's row and names level, Save and the note.
  - Child Sessions, "planned vs short-notice": the page says which one only after "On leave" is pressed. The step points at the session's current answer.
  - Teacher home, "Open": the button is labelled "View roster"; the text uses that label.
  - Requests: each step points at the first waiting row of its kind; with nothing waiting there is no step.
  - Child Sessions: the row, answer and buttons steps all point at the first session that can still be answered.
  - Class page: the session picker and Save steps exist only when there is a session to mark.
  - New homework: the steps follow the form (schedule, due date, "Assign to").
- `data-tour="homework-language"` sits in `ContentLanguageSelect.svelte` (the field has no element of its own on the form page).
- While a tour is open the highlighted control cannot be used, by pointer (driver.js `disableActiveInteraction`) or by keyboard (every key but Tab and Esc is stopped on it in `PageTour.svelte`). A tap outside the popover does nothing; a tour ends only by Done, Skip, Esc, the close button or leaving the page.
- Added beyond the task list: `mark_tour_seen` accepts only a short lower-case id and stores at most 64 (the function is callable by any signed-in account); tests for it in `rls.spec.ts`; a toast "There is nothing to show on this page yet." when Help's button is pressed on a page whose tour has no control to point at.
- The Tibetan texts were written without a native reader's check.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-13), three layers: blind (B), edge-case (E), verification-gap (V). Route in brackets.

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| B1, E5 | A partial tour uses up the once-only auto-start | medium [patch] | `parent-child-name` is also on the pending card and `requests-registrations` on "Nothing waiting", so sparse first visits give a one-step tour that is marked seen. A class with no markable session points at the no-sessions text and a disabled button. Partial tours as such are the frozen rule; these targets are not controls. An empty homework list losing its third step is that rule working. |
| B2 | Steps of one tour point at different children or rows | low [patch] | Each step takes the first shown element on its own: pending child first on `/parent`; first session row vs first row with controls. Fixed by where the attributes sit. |
| B3, E2, E13 | The seen POST can be lost on reload or tab close | low [patch] | `markSeen()` is a plain `fetch`; `keepalive: true` is a direct correction. |
| B4, E1 | "Fills in nothing" holds only for Enter and Space | medium [patch] | `guard()` returns for every other key; driver.js's focus trap includes focusables inside the highlighted element. |
| B5 | The open-dialog check never matches iX modals | low [patch] | `parent/children/[id]/+page.svelte:207`: the `<dialog>` is in `ix-modal`'s shadow DOM, which `querySelector('dialog[open]')` cannot see. |
| E10 | Help or a dialog opened during the driver.js import | low [rejected] | A window of one cached dynamic import; needs a second check for a state nobody showed. |
| B6, E6, E9 | Late-rendering steps are dropped or the tour misses its first visit | low [rejected] | The pages are server-rendered: every target is in the first HTML. No page was shown to add targets later. |
| B7 | "You got both when you registered your child" is false for existing families | medium [patch] | True only since #100; existing accounts get every tour. The step exists because the frozen list names "username and PIN" on a page that shows neither; told to the user. |
| B8 | SPEC.md and roles-and-permissions.md describe the planned steps | medium [patch] | CAP-16 lists the frozen wording, not the six built targets. |
| B9, V2 | Three tours and thirteen targets never run in a test | medium [patch, tests] | As filed: `e2e/tours.e2e.ts` highlights targets of five tours only; `tours.spec.ts` checks the shape of a target, not that an element carries it. |
| B10 | e2e timing rests on fixed waits | low [rejected] | A "decision made" signal is new surface in the component for the tests' sake. |
| B11 | The tab list is duplicated in `ROUTE_TABS` | low [rejected] | A renamed tab would also break the page's own links and tests first; sharing the list is a refactor of the child page. |
| B12, E11 | `mark_tour_seen` is silent at the 64-id cap and open to every role | low [rejected] | The endpoint stores only real tour ids (eight). The cap is reached only by an account calling the RPC by hand on its own row, and the cost is its own tours repeating. |
| E3 | A rejected driver.js import is an unhandled rejection | low [patch] | `run()` awaits the import bare; a try/catch is a direct correction. |
| E4 | `replayTour()` can reject | low [rejected] | With E3 fixed `start()` does not reject; `toggleAbout`/`toggleMenu` are iX methods never seen to reject. |
| E7 | A step's captured element is detached after an invalidation | low [rejected] | The highlighted control cannot be used during a tour, so the page's own forms do not invalidate it. |
| E8 | A second device that is already signed in shows the tour once more | low [rejected] | Needs that device's layout data to predate the first showing; closing it needs a new GET endpoint. The tour is harmless shown twice. |
| E12 | Help offers the button on a page whose tour has nothing to point at | false | Intended: the toast says so, and the frozen rule leaves such a tour unstarted. |
| V1 | The in-session seen memory is not observed by any assertion | medium [patch, test] | As filed. |
| V3 | "Nothing to point at" is untested | medium [patch, test] | As filed; a matrix row. |
| V4 | "Fills in and submits nothing" is asserted without trying | medium [patch, test] | As filed; goes with B4. |
| V5 | Both roles: only `tourFor` is tested, not the layout's `{role}` | low [deferred] | As filed: needs a dual-role e2e fixture. The matrix row's rule is unit-tested. |
| V6 | "Saving fails" is untested in the browser | low [patch, test] | As filed; a matrix row and one `page.route`. |
| V7 | Replay at phone width: closing the menu overlay is not asserted | low [deferred] | As filed; checked by hand at 390px by the implementer. |
| V-other 1 | Browser and database tests are skipped silently when local Supabase is down | low [rejected] | The repository's existing rule; both ran. |
| V-other 2 | New-homework tour steps are not in the form's order | low [patch] | `tours.ts` goes schedule, who, due; the form shows due before "Assign to". |
| - | Three e2e tests fail (`calendar:130`, `parent-access:128`, `teacher:258`) | [deferred] | Not this change: the same three fail on the baseline run (`base.log`) with the tour changes stashed. |

## Design Notes

- `driver.js` (MIT, no dependencies, about 5 kB gzipped) does the overlay, positioning, scrolling and keyboard handling; writing that by hand against iX's top-layer components is the riskier path. Targets are light-DOM elements in page content, so shadow DOM is not involved.
- Seen is marked at the start, not at the end: a closed tab or a navigation then never brings the tour back.
- `navigator.webdriver` is the one switch that keeps tours out of all existing e2e tests and `npm run help:screenshots` without touching each fixture.
- The tab is part of the match because the child page is one route with `?tab=`.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: all migrations apply.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npm run test:e2e` -- expected: exit 0, including `tours.e2e.ts`.

**Manual checks (if no CLI):**
- In bo and de at phone width, each tour's text fits its popover and names the control as the page labels it.
