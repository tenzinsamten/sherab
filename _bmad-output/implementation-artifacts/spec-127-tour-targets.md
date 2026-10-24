---
title: 'Page tour buttons are 44px targets (#127)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The page tour's Next, Back and Skip are 32px high and Close is 40px (`src/lib/components/PageTour.svelte`), below the app's 44px touch targets; the tour opens by itself on a first visit, on phones too.

**Approach:** Footer buttons `min-width`/`min-height: 2.75rem` with more padding; Close `2.75rem` square; the title's end padding widened to `2.75rem` so a long title stays clear of the larger Close. An e2e check in the teacher tour: every visible tour button at least 44×44px and the title text clear of Close.

**Decisions (2026-10-24):** On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `PageTour.svelte` (global `.sherab-tour` CSS): close 2.75rem; `.driver-popover-footer-btn` `min-width`/`min-height` 2.75rem, padding `0.5rem 1rem`; `.driver-popover-title` `padding-inline-end: 2.75rem`.
- `e2e/tours.e2e.ts` (teacher tour, first step): sizes of all visible buttons ≥ 43.5px (rounding), title text box left of or above Close.
- Review fixes: the close "×" centred (`display: grid; place-items: center`); title end padding `calc(2.75rem - 1rem)` (Close sits at the popover's edge, outside its 1rem padding); the size check is a shared `expectTourTargets` used on the teacher tour (desktop) and on every step of the parent tour at 390px: 3–4 controls (Skip is gone on the last step), each ≥ 43.5px (sub-pixel rounding of 2.75rem), footer inside the popover, title text left of Close, failing if an element is missing.

## Review Triage Log

- 44px not checked at phone width — medium (the reason for the change). Patched (parent tour at 390px, every step).
- Title/Close check vacuous and wrong geometry — low, direct. Patched.
- Unused `title` rect — low, direct. Patched.
- `>= 3` count weak — low, direct. Patched (3–4, with Close and Next/Done named).
- 43.5 unexplained — low, direct. Patched (comment).
- Close glyph not centred — low, direct. Patched.
- Title padding larger than needed — low, direct. Patched (`calc(2.75rem - 1rem)`, with why).
