---
title: 'Navigation loading bar and busy screen'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
baseline_commit: '37f10d4282d63e94c97ef8d244a542caf4a25441'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A tap on a tab, link or page action shows no sign of loading, so a slow server load feels stuck. While it is in progress the user can also tap other buttons or start another action.

**Approach:** The app shell shows a progress bar at the top of the screen while SvelteKit navigates, and while a page action is running and reloading data. During a navigation it also blocks and fades the page content. This is new behaviour beyond the SPEC's presentation-only scope. It was requested by the user on 2026-10-20.

## Boundaries & Constraints

**Always:**
- Drive it from the shell: `+layout.svelte` with `navigating` from `$app/state`, and an app-wide count of running actions fed by `createPending`. No per-page code.
- Show the bar only once a short delay has passed (150 ms), so fast navigations don't flash. Blocking starts immediately, so a fast double tap is caught too.
- User decision (2026-10-22): page actions show the bar only. They never block or fade the page; each page's `createPending` already disables its own action buttons. Only navigations block `<main>`.
- User decision (2026-10-22): during a navigation, `<main>` is blocked from the start and fades to about 60% opacity once the same 150 ms delay has passed (no fade under `prefers-reduced-motion` transition; the opacity change itself stays).
- User decision (2026-10-20): the bottom nav, the side nav, the header and the browser/OS back button stay usable during loading, so a slow navigation can be cancelled. Only `<main>` is blocked.
- The busy state clears when the navigation ends, errors or is aborted, and when an action's `update()` settles or throws. It never sticks.
- `<main>` gets `aria-busy="true"` while busy, and a polite live region says "Loading…" (new key `common_loading` in en/de/bo; bo is an English placeholder, as for previous keys).
- Under `prefers-reduced-motion` the bar does not animate (static fill).
- The bar works in both the signed-in shell and the signed-out public shell. Toasts, tours, the bottom nav's active state and focus return after dialogs keep working.

**Never:**
- No server, load, action, route or permission changes. No change to how any page's buttons show their own pending state.
- No focus trap and no `<dialog>` for the busy screen.
- No progress percentage: SvelteKit gives none, so the bar is indeterminate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fast navigation | Tab tap, load < 150 ms | No bar visible; page swaps | — |
| Slow navigation | Tab tap, load 2 s | Bar and `<main>` faded after 150 ms; taps in `<main>` do nothing; bar, fade and block gone on arrival | — |
| Cancel | Slow navigation, tap another tab or Back | The new navigation replaces the old one; busy state follows the new one | Aborted navigation clears busy |
| Load error | Navigation to a page whose load throws | Error page shows, busy cleared | — |
| Page action | Submit via `pending.submit`, server 2 s | Bar after 150 ms until `update()` finishes; `<main>` not faded, not blocked (never `inert`), so the busy state never moves focus. User decision (2026-10-22): the existing blur from `disabled={pending.busy}` is out of scope, logged as #109 | `update()` throws → bar cleared (finally) |
| Two actions | Second component's action while one runs | Counter stays > 0 until both finish | — |
| Reduced motion | OS setting on | Static bar, same timing | — |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte`:
  - Mount `<NavProgress {busy} />` in both shell branches.
  - `navBusy = navigating.to !== null`, `busy = navBusy || runningActions() > 0`.
  - On both `<main>` elements (lines 195, 235), apply `aria-busy={busy || undefined}`. While `navBusy`, also apply `inert`, plus the delayed fade class (`opacity-60 transition-opacity`, `motion-reduce:transition-none`). The header, `SideNav` and `BottomNav` sit outside `<main>`, so they stay usable for free.
- New `src/lib/busy.svelte.ts`: a module-level `$state` counter with `actionStarted()`, `actionEnded()` and `runningActions()`. It is client-only in practice, because submit functions only run in the browser.
- `src/lib/pending.svelte.ts:39-48`: increment after the `current` checks pass (not when cancelled or declined), and decrement in the existing `finally`. That covers about 60 of the 71 `use:enhance` uses, including the wrappers in requests, SyllabusFiles, EnrollmentPanel and MarkDoneForm.
- Not covered, by design:
  - `submitSkill` (`src/routes/teacher/classes/[id]/+page.svelte:186`) keeps its own set.
  - The 4 signed-out auth forms use a bare `use:enhance`.
  - Navigations from those forms still show the bar.
- New `src/lib/components/shell/NavProgress.svelte`:
  - A fixed bar at the top, `z-[45]` (above the header and bottom nav at 40, below dialogs at 50), 3 px, `bg-primary`, with top safe-area padding.
  - It shows after 150 ms and has an sr-only `aria-live="polite"` region.
- Blocking `<main>`: use `inert`, for navigations only. Focus resets on arrival anyway, and `inert` also stops keyboard and screen-reader activation. Actions must not use it, because `inert` moves focus from the pressed submit button to `<body>`.
- The 150 ms delay is shared by the bar and the fade. One `shown` flag is set by a timeout when busy starts and is cleared at once when busy ends, so a quick re-busy restarts the delay. It lives in `NavProgress`, exposed via a bindable prop, or in the layout; either is fine.
- `messages/en.json`, `de.json`, `bo.json`: add `common_loading` ("Loading…" / "Wird geladen…" / English placeholder).
- Leave alone: `PageTour.svelte` (it starts on `afterNavigate`, when `navigating` is already null), the Sonner `Toaster` (outside `<main>`), and `app.html` preload settings.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/busy.svelte.ts` + `src/lib/busy.spec.ts`: the counter, unit-tested (start/end, never below 0).
- [x] `src/lib/pending.svelte.ts`: count actions, with a test in the existing pending/confirm spec style covering cancel, decline and throw.
- [x] `src/lib/components/shell/NavProgress.svelte`: the delayed indeterminate bar and live region, with reduced motion.
- [x] `src/routes/+layout.svelte`: busy derivation, `NavProgress`, `aria-busy` on `<main>`, and the navigation-only `inert` plus delayed fade.
- [x] `messages/*.json`: `common_loading`.
- [x] New `e2e/nav-progress.e2e.ts`. Delay a page's data request with `page.route` on `__data.json`, then assert:
  - the bar appears and `<main>` is faded and inert;
  - a button in `<main>` cannot be clicked while waiting;
  - a slow form action shows the bar but leaves `<main>` neither inert nor faded;
  - a bottom-nav tab still navigates;
  - the bar is gone afterwards;
  - a fast navigation never shows it.

**Acceptance Criteria:**
- Given a slow navigation at 375 px, when the user taps the bottom nav, then the bar shows and a different tab can still be tapped.
- Given any busy state, when it ends for any reason, then `<main>` is interactive again and has no `aria-busy`.
- Given the existing e2e suite, when it runs, then it passes unchanged (tours, toasts, shell, calendar focus return).

## Implementation Notes

- `NavProgress` is mounted once in `+layout.svelte`, just above the `{#if data.profile}` branches, rather than once inside each. It serves both shells the same way and does not restart its delay when sign-in or sign-out swaps the branch.
- The shared 150 ms `shown` flag lives in `NavProgress` and reaches the layout through `bind:shown`. `<main>` always has `transition-opacity motion-reduce:transition-none`, and gets `opacity-60` only while `navBusy && shown`.
- Under reduced motion the bar is a static full-width fill. When motion is allowed, `motion-safe:w-1/3 motion-safe:animate-nav-progress` sweeps a segment across, using the new `nav-progress` keyframes in `src/lib/ui/tailwind.css`.
- Focus on the pressed button during an action is not asserted in e2e. `pending.busy` disables the button, and Chromium blurs a focused button when it becomes disabled. That is existing behaviour, which this story must not change. The point that matters is checked instead: `<main>` is never `inert` during an action.
- The "button in `<main>` cannot be clicked" check uses My account's "Save name" button. The test clicks its on-screen position during a slow navigation and asserts that no POST is sent. A teacher without classes has no dashboard tile link.
- The verification command `npm run db:reset` does not exist in package.json. `npm run supabase:reset` was used instead.
- Step-03 audit (orchestrator): added the two matrix rows that had no test, `load error` (a 500 on `__data.json`: the error page shows and busy clears) and `reduced motion` (static full-width fill, no animation, `transition-property: none` on `<main>`). The reduced-motion test found a real bug: `mainBusyClass` was a template literal `motion-reduce:transition-none${...}`, which Tailwind's scanner read as one invalid token, so the class was never generated. Fixed by writing the transition classes out on both `<main>` elements and deriving only `mainFade` (`opacity-60`).
- Page-action matrix row narrowed by the user (2026-10-22). An e2e probe showed focus falls to `<body>` during a slow action because of the existing `disabled={pending.busy}`. That is logged as #109 in `manual-verification-issues.md`.
- Verification (2026-10-22): after `npm run supabase:reset`, `npm test` exit 0 (1590/1590); `npm run check` 0 errors and 0 warnings; `npm run build` exit 0; the spec's e2e set passed 35/35. `rls.spec.ts` "7-4 session leave … refused (42501)" failed once in three post-reset runs, a flaky pre-existing server test this story does not touch. The full e2e run by the implementer had one failure, `teacher.e2e.ts:1290` Reset PIN (#88), which fails identically on the baseline commit.

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | `bo.json` `common_loading` is English (blind) | false | Spec Always: bo is an English placeholder as for previous keys; already tracked in `deferred-work.md` (bo.json placeholders entry). | reject |
| 2 | Aborted submit leaves the counter above 0 forever (blind, edge, edge-claim) | false | SvelteKit `forms.js:203` skips the callback only on `AbortError`, which happens only via the submit's `controller`; `grep -rn ".abort()" src` finds none outside a fetch-timeout spec. A page unload discards the module state. | reject |
| 3 | Reduced-motion test `locator('div > div')` may hit the track, not the fill (blind, edge) | medium | Both the track (parent: the testid div) and the fill match `div > div`; if it resolves to the track, both checks hold trivially. | patch |
| 4 | Load-error test never shows the error page (blind, verification-gap) | medium | Every `__data.json` 500 includes `load_root_error_page`'s refetch, so `native_navigation` reloads `/calendar` (client.js 1452/1470); no `+error.svelte` content is asserted. | patch |
| 5 | Public shell and desktop side nav untested (blind, verification-gap) | medium | All tests sign in at 375px; removing the public `<main>` bindings fails nothing. | defer |
| 6 | Hung navigation has no timeout or fallback (blind) | low | Real if the server never answers, but the nav stays usable to cancel and Supabase calls are already time-limited (`fetch-timeout`); a timeout adds new state. | reject |
| 7 | Module state in `busy.svelte.ts` leaks between unit tests (blind) | false | Vitest isolates modules per test file, so `busy.spec.ts` starts at 0; `pending.spec.ts` measures from a baseline by design. | reject |
| 8 | "Loading…" announced for every action, nothing on completion (blind) | low | Spec Always mandates the polite "Loading…" region while busy; changing it edits this build's spec. | reject |
| 9 | Arriving page fades back in from 60% (blind) | low | `transition-opacity` is permanent on `<main>`, so removing `opacity-60` animates back on every slow navigation; the fix is a direct change of the class. | patch |
| 10 | Diff omits the story and the issues log (blind) | false | Deliberate: the spec is the claims file given to the edge-case layer; the issues log is not code. | reject |
| 11 | Navigation after a long action fades `<main>` immediately (edge) | low | Real only when a slow action redirects; the bar is already showing, so no flash from nothing; a separate nav timer adds state. | reject |
| 12 | Nothing asserts `inert` before the bar appears (verification-gap) | medium | Pre-verified: every inert assertion runs after the bar is visible, so the `(navBusy && busyShown)` mutation passes. | patch |

## Verification

**Commands:**
- `npm run db:reset && npm run test:unit -- --run && npm run check && npm run build`: all exit 0.
- `npx playwright test e2e/nav-progress.e2e.ts e2e/shell.e2e.ts e2e/tours.e2e.ts e2e/toast.e2e.ts`: pass.
