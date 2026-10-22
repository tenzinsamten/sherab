---
title: 'Remove iX and final regression'
type: 'chore'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
baseline_commit: '341149651e7fe5d61a13d4970089f8e813407960'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every page is on the new UI (stories 1–9b), but iX is still installed and loaded on every page. It still provides the toasts behind `showToast`, the root layout's `setupIx`/`routeIxLinks`, the iX global CSS and the `data-ix-*` theme attributes. The iX theme variables in `src/app.css` and in the page-tour popover styles also remain (SPEC CAP-7).

**Approach:**
- Swap the toast for shadcn-svelte's Sonner, behind the same `showToast(type, message)`.
- Remove `@siemens/ix` and `@siemens/ix-icons` and every iX helper and iX CSS rule.
- Point the tour popover at the new theme tokens.
- Update the e2e locators and waits that depend on iX.
- Measure the bundle before and after, then run the full regression.

## Boundaries & Constraints

**Always:**
- `showToast(type, message)` keeps its signature and its four types (`success`, `error`, `info`, `warning`). Every call site and every message stays the same; only the import path changes.
- Toasts appear top-right (as iX did), stay 5 s, can be dismissed, and are announced to screen readers. They are styled with the theme tokens.
- The layout's app-wide error toast (`page.form.error`) and the load-error toast keep working.
- Page tours keep their look (border, radius, colours and fonts from the theme tokens). They still never start over Help, an open dialog or an open shell popup.
- Brand, fonts (including Atisha and the Tibetan line-height rules) and native controls pinned to light mode stay as they are.

**Never:**
- No server, load, action, route, permission, message-key or tour-registry changes, and no page layout changes.
- Do not unwind the `data-ui="new"` isolation (`reset.css`, scoped utilities) in this story.
- No `<ix-*`, `@siemens/ix*`, `$lib/ix` or `--theme-*` left in `src/`, `vite.config.ts` or `package.json`.
- Do not extract the five copies of the admin card/table constants and `cardLabel` into one module. Decision 2026-10-22: deferred to `deferred-work.md`, so this story stays an iX-only removal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Success toast | Any action success (e.g. Section saved) | Sonner toast top-right with the same text, gone after ~5 s | — |
| Error toast | `fail(…, { error })` on any route | Error-styled toast with the server message, once | Same form result twice → one toast |
| Phone toast | 375px | Toast full-width at the top, dismissible, gone after ~5 s | — |
| Tour | First visit to a toured page | Popover styled as before (theme tokens), steps on visible elements | Help/dialog open → no auto start |
| Bundle | `npm run build` before and after | Client JS/CSS total and the largest chunk reported in Implementation Notes | — |

</frozen-after-approval>

## Code Map

- `package.json`: remove `@siemens/ix` and `@siemens/ix-icons`; add `svelte-sonner` with an exact pin, as other UI dependencies are.
- `src/lib/components/ui/sonner/`: generate with the shadcn-svelte CLI (Sonner). Pass `theme="light"`, because there is no mode-watcher and the app is light-only.
- New `src/lib/toast.ts`: `showToast(type: 'success'|'error'|'info'|'warning', message)` → `toast[type](message)`. The 20 importers of `showToast` from `$lib/ix` (listed by `grep -rn "lib/ix'" src`) switch to `$lib/toast`. `src/lib/clipboard.ts` is one of them.
- `src/routes/+layout.svelte:2,11,29,34`: drop the iX CSS import, `setupIx()` and `routeIxLinks`. Mount `<Toaster position="top-right" duration={5000} richColors closeButton />` inside a `data-ui="new"` root, so the reset and utilities apply.
- `src/app.html`: drop `data-ix-theme` and `data-ix-color-schema`.
- `src/app.css` (393 lines): delete the iX header comment, the iX-named font alias, `html[data-ix-*]` blocks, `ix-button`/`ix-card` rules, and every legacy class rule that no markup uses any more. Grep showed 0 users for `.page`, `.card`, `.field`, `.tile-*`, `.table-wrap` and `.grid-table-*`; `.page-counter` is now a Badge testid. Keep `color-scheme: light` on `html`, the Atisha `@font-face`, the `[lang='bo']` rules (minus `ix-button`), `.sr-only` (15 users), `.credential` if still used (1 user), the app-shell scroll rules and `--font-tibetan`. Any surviving `var(--theme-*)` becomes a theme token (`--primary`, `--border`, `--muted-foreground`, `--radius`, …) from `src/lib/ui/tailwind.css:123-182`.
- `src/lib/components/PageTour.svelte:193-208, 262-335`: drop `whenDefined('ix-button')` and the `ix-modal` open check. Detect open dialogs as the shell popups are detected (`[data-state="open"]` in the portal root, plus `dialog[open]`/`[role=dialog]`). Map its 21 `--theme-*` vars to theme tokens.
- Delete `src/lib/ix.ts` and `src/lib/ix-fields.ts` (no importers). Fix the iX wording in the comments of `src/lib/pending.svelte.ts` and `src/lib/confirm.svelte.ts`.
- `vite.config.ts:17-26`: remove the `<ix-` `warningFilter`, and fix any a11y warnings that appear.
- `src/lib/ui/tailwind.css:14` comment: there are no iX pages left.
- e2e:
  - Replace `ix-toast` (70 uses in 17 files) with `[data-sonner-toast]`.
  - `tours.e2e.ts:254-259,570-576`, `help-screenshots.e2e.ts:262` and `team-students.e2e.ts:159`: wait on `main > [data-ui="new"][data-hydrated]` and not on `customElements.get('ix-button')`. The tour start-delay shim needs a new hook (for example, delay the tour's hydration wait) or a different way to hold the start.
  - Drop the now-meaningless `ix-*` count-0 assertions in `auth-mobile`, `shell`, `auth-fields` and `breadcrumbs`.
  - Rename `ix-visual.e2e.ts` (only login shots left) to `login-visual.e2e.ts` with its snapshot folder, and update its header comment.
- Do not change: `+page.server.ts` files, `messages/*.json`, `src/lib/tours.ts` steps, `reset.css`.

## Tasks & Acceptance

**Execution:**
- [x] Baseline: `npm run build` on `baseline_commit` and record the client output size (`du -sk .svelte-kit/output/client` plus the largest `_app/immutable` chunk) in Implementation Notes. This gives the before figure.
- [x] `package.json`, `src/lib/components/ui/sonner/`, `src/lib/toast.ts`, the 20 importers -- Sonner behind `showToast` -- the toast keeps working without iX.
- [x] `src/routes/+layout.svelte`, `src/app.html` -- no iX setup, `<Toaster>` mounted -- CAP-7.
- [x] `src/app.css` -- iX rules, vars and dead legacy classes gone -- CAP-7.
- [x] `src/lib/components/PageTour.svelte` -- token styles, no iX waits -- tours keep working.
- [x] Delete `src/lib/ix.ts` and `src/lib/ix-fields.ts`; update `vite.config.ts`, the `pending`/`confirm` comments and the `tailwind.css` comment -- no iX.
- [x] `src/lib/toast.spec.ts` -- each type calls the matching `toast` method with the message -- unit coverage.
- [x] e2e files listed in the Code Map -- the Sonner locator, hydration waits, the visual-test rename -- suites green.
- [x] Rebuild and record the after figure and the difference.

**Acceptance Criteria:**
- Given `src/`, `vite.config.ts` and `package.json`, when grepped for `<ix-`, `@siemens/ix`, `lib/ix` and `--theme-`, then nothing is found, and `node_modules/@siemens` is absent after `npm install`.
- Given a teacher saving a syllabus section at 375px and 1440px, when the save succeeds, then a toast with the same text shows top-right (full width on phone) and closes by itself.
- Given a new teacher on the dashboard, when the page loads, then the tour starts with the same styling, and it does not start while Help is open.

## Implementation Notes

**Bundle** (`npm run build`, `.svelte-kit/output/client`):

| | Before (`3411496`) | After | Difference |
|---|---|---|---|
| `du -sk` client output | 12,448 KB | 8,672 KB | -3,776 KB (-30%) |
| Client JS total | 5,104,413 B | 1,890,693 B | -3,213,720 B (-63%) |
| Client CSS total | 320,403 B | 122,709 B | -197,694 B (-62%) |
| Largest `_app/immutable` chunk | 1,664,897 B (`chunks/B_00een2.js`, iX) | 324,523 B (`chunks/B8gi9hqH.js`, unchanged) | -1,340,374 B |
| PWA precache | 397 entries, 5,936 KiB | 236 entries, 2,614 KiB | -161 entries, -3,322 KiB |

**Toaster inside the `data-ui="new"` root.** The scoped reset (`reset.css`, id weight) beats Sonner's own CSS, so inside the root a toast lost its padding and border and the close button its round look. As `reset.css` stays untouched, `ui/sonner/sonner.svelte` restores them with `!important` utilities via `toastOptions.classes`: `p-4 border` on the toast, a per-type `border-(--<type>-border)` so `richColors` keeps its border colour, and `rounded-full border border-inherit bg-inherit` on the close button. The font and the title's line height inherit from the root, so Tibetan toasts get Atisha and the taller line. Normal colours and radius are the theme tokens (`--popover`, `--popover-foreground`, `--border`, `--radius`); the four rich type palettes are Sonner's light defaults. Close button label: `m.common_close()`. Screen readers: Sonner's `aria-live="polite"` section ("Notifications").

**Page tour.** The `whenDefined('ix-button')` wait is now `pageHydrated()`: it polls for `main > [data-ui="new"][data-hydrated]` (every toured page sets it), for up to 3 s. The open-dialog check is `[data-state="open"]` in the portal root, or any `dialog[open]`, `[role="dialog"]` or `[role="alertdialog"]`. The e2e start-delay shim in `tours.e2e.ts` makes `hasAttribute('data-hydrated')` on the page root read false for the first 2.5 s. The popover's 21 iX variables are now theme tokens; the next button's hover is `--primary` at 80%, as the Button component's `hover:bg-primary/80`.

**app.css.** 393 lines down to the Atisha face, `color-scheme: light`, a token-based `body` base (white background, `--foreground`, `--sherab-font-sans`, 1rem/1.5, which iX's CSS used to provide outside the roots), the `[lang='bo']` rules (a Tibetan `body` now takes `--sherab-font-bo`, because the iX `Siemens Sans` alias that carried Atisha is gone), `.sr-only`, `.credential` and the shell scroll padding. All legacy element and class rules are removed. Only content outside a `data-ui="new"` root saw them, and none is left there.

**Other.** The `<ix-` assertions in seven `page.render.spec.ts` files are removed, because the AC grep covers `src/`. `teacher-mobile.e2e.ts` keeps its `ixInMain()` count-0 helper: it is not in the Code Map list, and it still passes.

**Verification run (2026-10-22).** `npm run supabase:reset`, then `npm test` (100 files, 1583 tests), `npm run check` (0 errors, 0 warnings), `npx eslint .` (0 errors) and `npm run build` all exit 0. With the `<ix-` warningFilter gone, no a11y warnings appear. Prettier was run on the changed files. The AC grep prints nothing, and `node_modules/@siemens` is absent. Full e2e after a reset: 352 passed, 4 skipped, 1 failed. The failure was `teacher.e2e.ts` "Tibetan homework ... (#73, #74)", which asserted the `Siemens Sans` Atisha alias that this story deliberately removed; it now asserts only `Atisha 136%`. Rerun of `teacher.e2e.ts` after a reset: 17 passed, plus the known Reset PIN failure (now at `teacher.e2e.ts:1290`). Sonner was checked by screenshot at 375px (full width at the top, en and bo) and at 1440px (top right): the error type is red, there is a close button, and the toast is gone after 5 s.

**Open.** The manual final regression (iPhone, iPad, laptop in en, de and bo) has not been run; it is for the user.

**Matrix coverage.** New `e2e/toast.e2e.ts` adds three tests: "success toast at 1440px: the same text, top right, closes by itself after about 5 s"; "error toast at 1440px: one fail(…, { error }) result gives exactly one error toast, never twice"; and "phone toast at 375px: full width at the top, the close button dismisses it". `tours.e2e.ts` "teacher: a tour starts on the first visit…" now also checks that the popover's border colour, radius, background and text colour equal the resolved theme tokens. Two leftover "iX toast" test titles are renamed (`parent-mobile`, `student-mobile`). After a reset, the four touched files ran 60 tests and all passed.

**Review fixes.**
- The toast close button keeps its 20px look but takes taps on a centred 44×44px `after:` pseudo-element.
- The toast size is `text-[0.875rem]`: `text-sm` also set a 20px line height, which overrode Tibetan's 2× line.
- The Toaster has `expand`, so several toasts are listed rather than stacked.
- `toast.e2e.ts` gains "Tibetan interface at 375px: the toast is drawn in Atisha with the taller line", and the 375px test now checks the close button's hit area.
- `tours.e2e.ts`: the hold-back shim (`holdTourStart`) now arms per path. A new sibling test, "a menu open before an unseen tour starts…", opens the account menu instead of Help; it fails with the `popupOpen` check removed.
- Stale "still iX" comments in `src/` and iX wording in e2e are reworded, and `ixInMain` is removed.
- The empty `node_modules/@siemens` folder is removed.

**Verification after review fixes (2026-10-22).**
- After `npm run supabase:reset`:
  - `npm test`: 100 files, 1583 tests.
  - `npm run check` and `npm run build`: both exit 0.
  - `npx eslint .`: exits 0 with 0 errors. Its 2 warnings are unused eslint-disable directives in the generated `worker-configuration.d.ts`, which this story does not touch.
  - Prettier: clean on all changed files.
- Full e2e after a fresh reset: 358 passed, 4 skipped, 1 failed. The one failure is the known Reset PIN test (`teacher.e2e.ts:1290`).
- The acceptance grep prints nothing.

## Spec Change Log

## Review Triage Log

Iteration 0 (blind-hunter, edge-case-hunter, verification-gap):

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | No test opens a dialog or popup (other than Help) before the tour starts; `helpOpen` returns before the new `popupOpen` check runs | medium | patch | Pre-verified: the only "stays away" test opens Help (`tours.e2e.ts:579`). |
| 2 | verification-gap | Tibetan font and line height in a `bo` toast are only checked by screenshot | medium | patch | Pre-verified: `toast.e2e.ts` runs in en and reads no font. |
| 3 | edge-case | The tour hold-back shim's 2.5 s window starts at document creation, but `/login` → `/teacher` is a client-side navigation | medium | patch | The login form uses `enhance` and the server redirects, so there is no new document. The window opens at `/login` load and has likely expired before `/teacher`; the old `whenDefined` shim held from each call. The Help test may pass by timing alone. |
| 4 | blind-hunter | Sonner's close button is 20px, under CAP-3's 44px | medium | patch | It is a button on every page at 375px. A larger hit area through `toastOptions.classes.closeButton` is a class-only fix. |
| 5 | edge-case | Two toasts within 5 s collapse into a stack (`expand` is false by default) | low | patch | Sonner shows only the front toast fully until hover; iX listed them all. The fix is one prop. |
| 6 | blind-hunter | About 20 source comments still say a page or component "is still iX" | low | patch | Confirmed in `ChildPicker`, `Pager`, `ScheduleFields`, `SyllabusList`, `CopyField` and others. Rewording comments is a direct correction. `reset.css` stays as it is (Code Map). |
| 7 | blind-hunter, verification-gap | Leftover iX checks and wording in e2e: `ixInMain()` in `teacher-mobile`, plus titles and comments in `ui-foundation`, `forms:12`, `calendar:843`, `shell:504` and `badges:450` | low | patch | `ixInMain()` can only return 0 now. Deletion and rewording only. |
| 8 | edge-case | `node_modules/@siemens` still exists (empty), against the AC wording "absent" | low | patch | Confirmed: the folder exists with 0 entries. Remove the empty folder. |
| 9 | blind-hunter, verification-gap | Tibetan characters outside `lang="bo"` (en/de interface) no longer get Atisha, including in toasts | medium | defer | Pre-existing in the new UI: `--sherab-font-sans` never named `Siemens Sans` (`tailwind.css:117`, same at baseline), so new-UI pages already lost the #78 behaviour in stories 1–9. This story only extends it to toasts. Putting Atisha first in the sans stack changes rendering app-wide. |
| 10 | blind-hunter | `<main>` keeps iX's 2rem padding, and `ui.page` takes 1rem back with `-mx-4` | low | defer | Pre-existing layout. The spec forbids layout changes in this story. |
| 11 | blind-hunter | The rewritten Atisha check in `teacher.e2e.ts` can never fail | false | reject | It fails if the Atisha `@font-face` or its `size-adjust: 136%` goes, which is all its comment now claims. |
| 12 | blind-hunter | The spec gives the Reset PIN failure at line 1284 in one place and 1290 in another | low | reject | The fix is to edit this spec. |
| 13 | blind-hunter | Phone auto-close untested; the AC names syllabus save but the test uses `/account`; the timing window is wide | low | reject | Duration and position are one Toaster config, independent of page and width. The 3 s/7 s bounds still catch a wrong duration (iX 5 s vs Sonner's default 4 s would fail neither, but no config sets another value). |
| 14 | blind-hunter | `{...restProps}` after `toastOptions`/`style` lets callers replace the reset fixes | false | reject | The only caller (`+layout.svelte`) passes neither prop. No such state is shown. |
| 15 | blind-hunter, edge-case | The tour's open-dialog check matches hidden or closing `[role=dialog]` elements | low | reject | No always-mounted `role=dialog` in `src` (grep) and no `forceMount`. Only a dialog still animating closed at the instant of the check matches; rare, and the fix adds guards. |
| 16 | edge-case | A leftover driver.js popover (`role="dialog"`) blocks the next page's tour | false | reject | `afterNavigate` calls `stop()` → `active.destroy()` before `autoStart`, so no popover is left at the check. |
| 17 | blind-hunter | The tour shim patches `Element.prototype.hasAttribute` globally, which is fragile | low | reject | Test-only. A production hook would add surface. The timing defect is #3. |
| 18 | blind-hunter | Nothing makes toured pages set `data-hydrated`, so a tour could start early | false | reject | Without the mark, `pageHydrated()` waits the full 3 s, as the old `ix-button` wait did. It never starts early. |
| 19 | blind-hunter | The `[data-sonner-toast]` locator is repeated 70 times | low | reject | Churn only. A shared helper is a refactor beyond a direct correction. |
| 20 | blind-hunter | `richColors` means typed toasts use Sonner's palettes, not theme tokens; errors are polite and last 5 s | low | reject | The Design Notes chose `richColors`. Settling the wording is a spec edit. |
| 21 | blind-hunter | The toast region's label "Notifications alt+T" is English in de and bo | low | reject | Heard only when moving between landmarks; the toasts themselves are read in the interface language. A fix needs a new message key, which this story's Never rules out. Noted for the user. |
| 22 | edge-case | `pageHydrated()` times out silently | low | reject | Same behaviour as the old 3 s `ix-button` wait. A warning adds surface for no user harm. |
| 23 | edge-case | The tour Next button's hover is lighter (primary at 80%) where iX's was darker | low | reject | Cosmetic, and it matches the app's own `Button` hover (`hover:bg-primary/80`). |

## Design Notes

- Sonner is used because `stack.md` already chose it. `svelte-sonner` gets `richColors` for success/error/warning/info so the type stays readable, as with iX's coloured toasts.
- The isolation layer stays: it does no harm now that iX is gone, and removing it touches all 82 `data-ui="new"` roots. That is logged as deferred work, not done here.

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npx eslint .`, Prettier on changed files, `npm run build` -- expected: all exit 0.
- `npm run supabase:reset`, then `npm run test:e2e` -- expected: all pass except the known Reset PIN failure (`teacher.e2e.ts:1284`).
- `grep -rnE "<ix-|@siemens/ix|lib/ix|--theme-" src vite.config.ts package.json` -- expected: no output.

**Manual checks (final regression, SPEC Success signal):**
- On an iPhone, an iPad (portrait and landscape) and a laptop, in en, de and bo:
  - parent: request leave and check homework;
  - student: open and mark homework;
  - teacher: take attendance and review homework;
  - admin on the laptop: manage classes and teachers.
- Watch toasts, tours, the Help sheet, the role switcher, push opt-in and PWA install.
- Log anything found in `_bmad-output/manual-verification-issues.md` before fixing it.
