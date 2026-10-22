---
title: 'Drop the iX-era content padding'
type: 'refactor'
created: '2026-10-22'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The signed-in `<main>` (`src/routes/+layout.svelte`) still carries iX's 2rem side padding (`max(2rem, safe-area inset)`), and every page root takes 1rem of it back on a phone with `-mx-4` in `ui.page` (`src/lib/ui/classes.ts`). This existed only to keep migrated pages identical to iX's content area. Story 10 forbade layout changes, so the item was deferred. The two values cancel each other out, and on a landscape iPhone the `-mx-4` pulls content about 16px into the notch's safe area.

**Approach:** Give `<main>` the real gutter directly: 1rem below 48em and 2rem from 48em, each never less than the safe-area inset. Remove `-mx-4` from `ui.page`. Pages keep their current gutters (16px at 375px, 32px at 820px and up), except that content now clears the safe area in landscape. Lock the gutters in with an e2e check.

</frozen-after-approval>

## Implementation Notes

- `src/routes/+layout.svelte`: the signed-in `<main>` pads `max(1rem, safe-area inset)` below 48em and `max(2rem, safe-area inset)` from 48em (was `max(2rem, …)` at every width). The comment says the gutter lives only here.
- `src/lib/ui/classes.ts`: `ui.page` loses `-mx-4`, and its comment is updated.
- `src/routes/help/+page.svelte`: the stale "no padding to take back" comment is reworded; the signed-out frame is unchanged.
- `e2e/shell.e2e.ts`: new "content gutter" test (teacher home, 16px at 375px, 32px at 820px, measured against the layout width). It passes on the baseline layout and on the new one, so the gutters are unchanged.
- Correction to the frozen Intent: the landscape-notch claim is wrong. Below 48em `-mx-4` applied, but every notched iPhone in landscape is ≥812px wide (the `md` range), where `md:mx-auto` replaced it and `<main>` already used `max(2rem, inset)`. The change has no visible effect on any device; it is a cleanup. "32px at 820px and up" holds until the `md:max-w-5xl` cap centres the page (wider gutters past that). Known exception: the dev-only `/dev/ui` page (own `p-4`, no `ui.page`) goes from 48px to 32px phone gutter.
- Verification (2026-10-22), after `npm run supabase:reset`: `npm test` exit 0 (1612/1612); `npm run check` 0/0; `npm run build` exit 0; whole e2e suite (Reset PIN #88 excluded; it fails on the baseline too) 372 passed, 4 skipped. After the review patches: `check` 0/0; `shell` + `shared-mobile` 43/43. An intermediate run of those two files showed 2 failures (33 tests in 9.9 min, test names not captured) that did not reproduce on the next run.

## Review Triage Log

- Spec overstates the landscape-notch fix: medium (spec accuracy). The finding is correct, and the fix would edit the frozen intent, so it is rejected and the correction is recorded above and reported to the user.
- "32px at 820px and up" is imprecise past the 5xl cap: low. Recorded above; rejected (spec edit).
- Spec lacks baseline, boundaries and matrix: false. The oneshot template omits them.
- `deferred-work.md` entry and story 3's note still describe `-mx-4`: low. `deferred-work.md` is append-only, and story 3 is a finished spec (history). Rejected.
- `/help` comment stale: low, a direct fix. Patched.
- Signed-out `/help` could share `ui.page` and get a 32px tablet gutter: low. That is a visible change outside this cleanup. Rejected.
- e2e right gutter measured against the viewport, not the layout width: low, a direct fix. Patched (`clientWidth`).
- e2e exact float equality: low, a direct fix. Patched (`toBeCloseTo`).
- e2e gaps (other pages, 1440px, 767/768 boundary, safe-area): low. Each breakpoint's CSS is unchanged, and the whole suite ran. Rejected.
- Dev-only `/dev/ui` phone gutter 48px to 32px: low, dev page only. Recorded as a known exception; rejected.
- Layout comment should say where centring and the cap live: low, a direct fix. Patched.

