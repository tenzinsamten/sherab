---
title: 'Student pages'
type: 'feature'
created: '2026-10-19'
status: 'done'
route: 'dispatch'
baseline_commit: '797336b41441221771b99c56947f8228ddf65fd4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stories/3-parent-pages-pilot.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students use Sherab on phones, but their pages are still iX: card tiles, an iX join-code input, iX filter buttons, iX pills, an iX confirm for Mark done and an iX modal for the "New badge!" celebration (SPEC CAP-2–CAP-5).

**Approach:** Rebuild `/student`, `/student/classes`, `/student/classes/[classId]`, `/student/homework`, `/student/homework/[instanceId]`, `/student/badges` and `/student/pending` phone-first on the new system with a tablet grid, following story 3's patterns, and keep every behaviour and message. The shared components they use move now and serve every role.

## Boundaries & Constraints

**Always:** Same data, form actions, field names, messages and progressive enhancement (forms work without JS). Each page wraps its content in its own `data-ui="new"` root, and migrated shared components carry their own root. Mark done asks first through a new alert dialog (replaces `confirmWith`); without JS the button posts directly. The New badge dialog keeps its behaviour: opens by itself, marks seen on close/Escape/link, focus goes to Close and returns afterwards, `data-testid`s kept. Celebration surfaces (progress tiles, badges, New badge dialog) keep the full clay treatment from component-specs.md. The New badge dialog gains a one-time flourish when it opens: badge icons pop in with a light accent (pink) burst, and under `prefers-reduced-motion: reduce` it shows them still, with no motion (user decision). Join code: native input, upper-cased as typed, error under the field with `aria-invalid`. Filters (To do / Done) are ≥44px links with `aria-current`. Toasts stay iX (`showToast`). Tablet (48–80em): dashboard tiles and class cards in a grid.

**Never:** No server, load or action changes. No iX element, `$lib/ix-fields` attachment or `confirmWith` left in the seven pages or in the migrated shared components. No page-scoped `<style>` in migrated files. No Help screenshot regeneration (story 10).

## I/O & Edge-Case Matrix

| Scenario           | Input / State                                        | Expected Output / Behavior                                                      | Error Handling                                                                      |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dashboard          | Student with homework, a team and two classes, 375px | Tiles in a 2-column grid, progress, next due, classes, join; no sideways scroll | Load error: tiles show "—"                                                          |
| Join a class       | Type a code, send                                    | Upper-cased; sent → toast, field cleared, request listed                        | Refused code: error under the field, focus on it; rejected request can be dismissed |
| Mark done          | Tap Mark done on a row or the detail page            | Alert dialog; Confirm saves, toast, row shows Done; Cancel does nothing         | Action error → iX toast                                                             |
| Mark done, no JS   | JS disabled                                          | Posts directly and the page shows Done                                          | —                                                                                   |
| Homework list      | To do / Done filter, Done with two pages             | Grouped by class, stacked rows, pager works                                     | Empty / load error → empty state                                                    |
| Class detail       | Syllabus with files, homework, classmates            | Sections, file links, copy code (≥44px), filters, pager                         | —                                                                                   |
| New badge          | Student signs in with an unseen badge                | Dialog opens with the flourish, Close focused; Close/Escape/link marks seen     | Mark-seen failure only logs                                                         |
| Reduced motion     | Same, with `prefers-reduced-motion: reduce`          | Dialog opens with no animation                                                  | —                                                                                   |
| Pending / rejected | Unapproved or rejected student                       | Status card, Check again link, Sign out                                         | Load error: no status claimed                                                       |

</frozen-after-approval>

## Code Map

- `src/routes/student/+page.svelte` (291) -- ix-card tiles ×4 (`a.tile-link`, team tile → `/teams/[teamId]` or `/leaderboard`), class cards, `ix-input#joinCode` + `ixFieldError`, ix-pill (join status), ix-button ×2 (`requestJoin`, `dismissJoin`); `createPending`; `refused()` keeps a refused code; toasts at 28–50.
- `src/routes/student/homework/+page.svelte`, `classes/[classId]/+page.svelte` -- filter `nav` of `ix-button href` with `aria-current`; `Pager`; `StudentHomeworkRows`; class page uses `CopyField`, `RichText`, `TextWithLinks`, `SyllabusFiles` (read-only: no `pending` prop).
- `src/routes/student/homework/[instanceId]/+page.svelte` -- ix-pill ×5, Mark done with `confirmWith`; breadcrumb back to To do / Done (`?from=done`).
- `src/routes/student/classes/+page.svelte`, `pending/+page.svelte`, `badges/+page.svelte` -- ix-card/ix-empty-state/ix-pill; pending has `data-testid="student-status"` + `data-state` (used by `credentials.e2e.ts`); badges page already uses migrated `BadgeCollection`/`PageBreadcrumb`.
- Shared, migrated here: `StudentHomeworkRows` (3 student pages; `confirmWith`, ix-pill ×4, ix-button), `NewBadgeDialog` (root `+layout.svelte`, student only; ix-modal), `CopyField` (also admin classes, admin students, requests; `ix-icon-button`; `:global(.credential-fields)` hook), `RichText` (also teacher homework detail), `TextWithLinks`, `RepeatIcon` (teacher homework too) -- restyle the last three; no iX.
- `SyllabusFiles` -- only its read-only branch (no `pending`) moves now; its edit controls stay iX for story 8 (SyllabusDetail).
- Reuse: `src/lib/ui/classes.ts` (`ui.*`), `ui/alert-dialog`, `ui/dialog`, `ui/badge`, `ui/input`, `ui/empty-state`, `ui/button`; story 3's deletion alert-dialog pattern (`parent/children/[id]`); `data-hydrated` on page roots.
- `src/lib/ui/tailwind.css` -- add `@source` for `routes/student/**` and each newly migrated component.
- No student tours exist (`src/lib/tours.ts`).
- e2e: `class-join.e2e.ts` (`#joinCode input`, `ix-invalid`), `badges.e2e.ts` (`ix-modal` waits, `new-badge-dialog ix-button`, Mark done), `team-students.e2e.ts` (`a.tile-link` My team), `teacher.e2e.ts:1193` (`.homework-row-title span[lang]`), `credentials.e2e.ts` (student-status), `forms.e2e.ts`, `syllabus-files.e2e.ts` (student file links).

## Tasks & Acceptance

**Execution:**

- [x] Shared components above -- rebuild with own `data-ui="new"` root, same props/API; Mark done confirm via alert dialog.
- [x] The seven student pages -- rebuild per Always/Never.
- [x] `src/lib/ui/tailwind.css` -- `@source` lines for the migrated files.
- [x] e2e: rework the selectors listed in the Code Map to roles / labels / `data-testid`; new `student-mobile.e2e.ts` covering each matrix row at 375 and 820px (No-JS row with `javaScriptEnabled: false`), plus the fit check in en/de/bo.

**Acceptance Criteria:**

- Given any student page at 375px in en, de and bo, when loaded, then `scrollWidth` ≤ viewport and every button is ≥44×44px.
- Given an admin or requests page using `CopyField`, or the teacher homework page using `RichText`, when loaded, then they work as before inside the iX page.
- Given the full e2e suite after `supabase:reset`, when it runs, then all tests pass except the known Reset PIN failure; remaining `ix-visual` shots match or a change is explained and re-baselined.

## Implementation Notes

- Mark done: new `MarkDoneForm.svelte` (form + Bits `AlertDialog`, story 3's deletion pattern), used by `StudentHomeworkRows` and the detail page. The button is the form's submit button (no JS: posts directly); with JS its click opens the alert dialog, Confirm (disabled while busy, guarded against a second tap) calls `requestSubmit`. After saving, focus goes to the row's link, or — under To do the row leaves the list, as before — to the page `h1`; on the detail page to the status (`#homework-status`). Cancel returns focus to the button.
- `NewBadgeDialog`: Bits `Dialog` (portalled to `#ui-portal`), same open/mark-seen/dismissed-in-session logic; every close (Close, Escape, outside tap, link) marks seen; Close gets focus on open and after a navigation; focus returns to the opener, else `main h1`. The header X is dropped (one Close button). Flourish: `animate-badge-pop` on the icon and two `animate-badge-burst` pink layers (`bg-celebrate/25`, `border-celebrate/50`), staggered, `motion-safe:` only; burst layers `motion-reduce:hidden`.
- Reduced motion: `tailwind.css` now stops every animation/transition inside `[data-ui='new']` under `prefers-reduced-motion: reduce` (in the utilities layer with an id's weight, so it beats the `!important` animation utilities); `animate-spin` is exempt. This also affects story 3's dialogs/sheets (intended a11y default).
- Clay: theme tokens `--clay`, `--play`, `--celebrate`, `rounded-clay` (20px), `shadow-clay` (design-tokens.md) and `ui.clay`. Applied to `StudentProgressTiles` (streak tile on `bg-play/20`), `BadgeCollection` sections and badge tiles (earned: clay border+shadow; locked: dashed), and the New badge dialog. Parent child page / badges pages get the same look (shared components). `StudentProgressTiles` lost its `mb-4` (pages space it with `gap`).
- `CopyField`: own root, Lucide copy in a 44px ghost button; `copy-field` / `credential` classes kept as test hooks (credentials, teacher PIN tests); the `.credential-fields` label alignment is `in-[.credential-fields]:min-w-36`. `RichText`: own root, `rich-text` class kept; utilities per element (the unit test helper now drops class/`data-ui` attributes). `TextWithLinks`: own root, 44px links with an external-link icon. `RepeatIcon`: Lucide `repeat` component, no root (bare inline icon inside iX pills too).
- `SyllabusFiles`: without `pending`, a new `data-ui` branch (file link `data-testid="file-name"`, size `file-size`, Download with icon, 44px links); with `pending` the iX markup and its `<style>` are unchanged (story 8).
- Pages: `data-hydrated` roots; filters are `ui.filter` links with `aria-current`; dashboard tiles 2 columns / 4 from 48em, class cards `sm:2 / lg:3`; class page homework + classmates side by side from 80em. Join field: native `Input`, upper-cased on input (and `uppercase` CSS), `aria-invalid` + `aria-describedby`, focus returns to it on a refused code.
- Build check: compared the built new-UI CSS against HEAD; the new utilities match no class used on a remaining iX page.
- Test hooks: `dashboard-tiles`, `class-cards`, `join-card`, `join-request`, `join-status`, `streak-tile`, `student-homework-list`, `homework-row` (+`data-instance`), `homework-status`, `homework-meta`, `homework-class`, `class-group`, `syllabus-section`, `classmates`, `mark-done-confirm`, `file-name`, `file-size`; `data-badge-icon` / `data-flourish` in the New badge dialog.
- e2e reworked: `class-join` (label, `aria-invalid`, focus, `join-status`), `badges` (hydrated-root waits, Close by role, Mark done via `alertdialog`), `team-students` (My team tile by role), `teacher` (student detail `homework-meta`), `breadcrumbs` (`homework-class`), `syllabus-files` / `syllabus-sections` (student testids, `main` h1). New `student-mobile.e2e.ts` (23 tests): every matrix row at 375/820 except the load-error cells (not simulated), plus action error toast, empty state, reduced motion, no-JS, fit check en/de/bo on all seven pages. Matrix note: after Mark done in To do the row leaves the list (unchanged behaviour); the test checks it under Done.
- Load-error rows: covered by vitest render tests (`svelte/server`), `src/routes/student/page.render.spec.ts` (every dashboard tile shows "—", no number) and `src/routes/student/pending/page.render.spec.ts` (`data-state="error"`, generic load-error text only, no pending/rejected heading or body).
- Review patches: New badge dialog ignores outside taps (`interactOutsideBehavior="ignore"`, as iX) and caps the pop-in delay at 5 steps; Mark done refocuses its button after a failed save; join field keeps the caret on upper-casing, label above an input+button row (no fixed offset), `autofocus` on a refused code (no JS); dashboard class cards switch at `md`; dead `pending` checks removed from SyllabusFiles' iX branch; render specs for the homework list load error, TextWithLinks and archived homework (no Mark done); dashboard render spec uses `m.*()`; e2e: outside tap, error-focus and Copy (clipboard) checks; help shot `student-5` targets the progress tiles.
- No-JS join test submits with Enter: at the page end Playwright cannot click the button under the sticky bottom bar without JS (the shell's measured `--bottom-nav-height` needs JS) — a shell (story 2) quirk, logged here, not fixed.

- Final verification (after review patches, `supabase:reset`): 1538 unit tests, check 0 errors, ESLint 0 errors (2 existing warnings), Prettier clean, build OK. Full e2e: 210 passed, 4 skipped (help screenshots), 1 failed — the known `teacher.e2e.ts:1235` Reset PIN.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter BH, edge-case-hunter EH, verification-gap VG):

| #         | Finding                                                             | Verdict               | Evidence                                                                                                                                                                       | Route  |
| --------- | ------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| EH8/BH11a | New badge dialog closes on an outside tap                           | medium                | iX `ix-modal` `closeOnBackdropClick` defaults to false; Bits closes on outside tap, so a stray tap dismisses the one-time celebration and marks it seen — behaviour change     | patch  |
| BH4       | Focus jumps away after a failed Mark done                           | medium                | Confirm suppresses the dialog's focus return; on an action error the form stays, focus is on body, and `focusAfter()` moves it to the row link / heading instead of the button | patch  |
| BH10      | Homework list load error untested                                   | medium                | Matrix row "Empty / load error → empty state"; only dashboard and pending have load-error render specs                                                                         | patch  |
| VG-o      | Help screenshot selector `.tile-grid ~ .tile-grid` gone             | medium                | `help-screenshots.e2e.ts:347` targets a class story 4 removed; `npm run help:screenshots` fails at student-5                                                                   | patch  |
| VG1       | CopyField copy click never tested                                   | medium (pre-verified) | No test clicks a copy button; rewritten `onclick` unverified across 5 consumers                                                                                                | patch  |
| VG2       | TextWithLinks empty text untested                                   | medium (pre-verified) | Branch rewritten; no fixture without content and links                                                                                                                         | patch  |
| VG3       | Mark done hidden on archived homework untested                      | medium (pre-verified) | Condition rewritten; no test renders `archived: true`                                                                                                                          | patch  |
| BH2/EH4   | Join code caret jumps to the end                                    | low                   | `field.value = joinCode` on a mid-string edit resets the caret                                                                                                                 | patch  |
| BH3       | Join button `md:mt-[1.625rem]` assumes the English label height     | low                   | Taller Tibetan/wrapped German label misaligns the button at tablet width                                                                                                       | patch  |
| BH6       | Dead `{#if pending}` inside SyllabusFiles' edit branch              | low                   | Branch is only rendered with `pending`; read-only leftovers can never show                                                                                                     | patch  |
| BH8       | No-JS refused code: field not focused                               | low                   | Focus only set via `tick()` in JS; `autofocus` when rendered with an error fixes it                                                                                            | patch  |
| BH15      | Class cards: `sm` on dashboard, `md` on My classes                  | low                   | Same list switches layout at different widths; spec tablet range starts at 48em                                                                                                | patch  |
| BH16      | Dashboard render spec hard-codes English                            | low                   | Uses literal strings where the pending spec uses `m.*()`                                                                                                                       | patch  |
| EH2       | Badge pop delay unbounded                                           | low                   | `120 + i*140ms` with fill `both` keeps later badges invisible for seconds                                                                                                      | patch  |
| EH7       | MarkDoneForm comment claims "one press at a time across the page"   | low                   | Each `StudentHomeworkRows` has its own `createPending` (as before); comment is wrong                                                                                           | patch  |
| EH5       | Detail page ignores `loadError` (status unknown, Mark done offered) | medium                | Pre-existing: the old page never read `loadError` either                                                                                                                       | defer  |
| BH7       | No-JS: bottom bar covers the last control                           | low                   | Story 2 shell: `--bottom-nav-height` is measured with JS                                                                                                                       | defer  |
| VG4       | New badge focus return to a mid-session opener untested             | low (pre-verified)    | Needs a fixture that earns a badge mid-session                                                                                                                                 | defer  |
| BH1       | Streak tile `bg-card` vs `bg-play/20` order-dependent               | false                 | Built CSS emits `.bg-play/20` after `.bg-card` (same specificity), so play wins deterministically                                                                              | reject |
| BH5       | Rows component queries `main h1` / sets tabindex                    | low                   | Same as the previous NewBadgeDialog `focusPage`; no named harm                                                                                                                 | reject |
| BH9       | `expectFits` skips portalled dialogs and touch links                | low                   | Test breadth only; dialog actions use `ui.touch`                                                                                                                               | reject |
| BH11b     | See-all link exit untested                                          | false                 | Covered by `badges.e2e.ts:310-333`                                                                                                                                             | reject |
| BH12      | rich-text spec strips class attributes                              | low                   | e2e `.rich-text` locators fail if the class is dropped                                                                                                                         | reject |
| BH13      | CopyField makes iX table rows taller                                | maybe-false           | `ix-visual` admin classes shot unchanged; would need a screenshot of a credentials table to settle; low at most                                                                | reject |
| BH14      | `hydrated` flag copied per page                                     | low                   | Story 3's established pattern; no named harm                                                                                                                                   | reject |
| BH17      | My classes count has no accessible context                          | low                   | Pre-existing (the iX `page-counter` was bare too)                                                                                                                              | reject |
| EH1       | Modifier-click on see-all loses focus                               | low                   | Unlikely on phones; fix adds guard branches                                                                                                                                    | reject |
| EH3       | New ids arriving while open not celebrated after close              | low                   | Pre-existing logic, unchanged by this story                                                                                                                                    | reject |
| EH6       | My classes counter shows 0 on load error                            | low                   | Pre-existing (the iX counter did the same)                                                                                                                                     | reject |

## Verification

**Commands:**

- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all clean.
- `npm run test:e2e` -- expected: all pass except the known Reset PIN test.

**Manual checks:**

- On an iPhone: join a class, mark a homework done, open the New badge dialog.
