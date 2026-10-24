---
title: 'Destructive buttons reach 4.5:1 contrast (#119)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The destructive button variant (every Delete, Reject and Cancel-style red button) draws `text-destructive` (#d72332) on its `destructive/10` tint: 4.30:1, and 3.65:1 on the `destructive/20` hover, below WCAG AA 4.5:1 for its 14px text.

**Approach:** A darker red only for the destructive button's text and icon: a new theme token `--destructive-strong: #b91c1c` (`text-destructive-strong`) in `src/lib/ui/tailwind.css`, used by the `destructive` variant in `src/lib/components/ui/button/button.svelte` instead of `text-destructive`: 5.53:1 on the tint, 4.70:1 on hover. The tint, borders, rings and every other use of `--destructive` (error text, badges) stay #d72332. A unit test computes these ratios from the tokens so they cannot fall below 4.5:1 unnoticed.

**Decisions (2026-10-24):** The user chose the darker button text over a darker red everywhere or solid red buttons. Reject buttons turning neutral (#124) is separate.

</frozen-after-approval>

## Implementation Notes

- `src/lib/ui/tailwind.css`: `--destructive-strong: #b91c1c` and `--color-destructive-strong`; `button.svelte` destructive variant `text-destructive` → `text-destructive-strong`. Compiled CSS has `.text-destructive-strong{color:var(--destructive-strong)}`.
- `src/lib/ui/contrast.spec.ts`: reads both tokens and the variant; strong red ≥ 4.5:1 on the 10% and 20% tints over white (5.53, 4.70), the plain red is not (4.30), the variant uses the strong class.
- Found, out of scope (the decision covers the button variant only): the same #d72332-on-tint combination at 4.30:1 in the file-delete buttons on hover (`SyllabusFiles.svelte:242`, `HomeworkFiles.svelte:239`), the destructive badge (`ui/badge/badge.svelte:11`), the `admin/parents` alert (`+page.svelte:68`) and the dropdown destructive item on focus (`dropdown-menu-item.svelte:23`). Deferred for the user.

## Review Triage Log

- Other red-on-tint spots (badge, parents alert, file-delete hover, dropdown focus) — medium, real, outside the user's decision (button only); deferred (entry in `deferred-work.md`).
- Contrast test assumes a white backdrop — low; rejected (destructive buttons sit on white cards and pages today; a muted surface would be a new design).
- Hover margin (4.70:1) not stated — low, direct. Patched in the token comment.
- "The plain red would not" test fails when the red is improved — low, direct. Patched: removed, kept as a comment.
- Page render specs match `text-destructive` loosely — false; they check that a red Delete exists, not its contrast, which `contrast.spec.ts` now guards.
- Negative class check misses prefixed classes — low, direct. Patched: no `(^|:)text-destructive` class in any state.
- `dark:` classes on the variant — false; dark mode is opt-in through `.dark`, which the app never sets, and has no dark tokens (pre-existing).
- Token value unexplained — low, direct. Patched: Tailwind red-700, the nearest common darker red, hover is the binding case.
