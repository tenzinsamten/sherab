---
title: 'Bottom nav labels and counts at a readable size (#123)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The bottom nav's labels are 11px (`text-[0.6875rem]`, `BottomNav.svelte:45`) and its count pill 10px (`text-[0.625rem]`, `:63`); at 10px the Tibetan digit "༡" reads as a comma. The collapsed side nav's count pill is 10px too (`SideNav.svelte:68`).

**Approach:** Tab labels `text-xs` (12px). The count pills in the bottom nav and the collapsed side nav drop their size overrides and take `CountPill`'s own 12px (`text-xs`, `min-w-5 px-1.5`), keeping only their position (nudged for the larger pill). Tibetan digits stay (#80). The labels still fit five tabs at 375px in en, de and bo without sideways scroll, and the 44px targets stay.

**Decisions (2026-10-24):** The user kept Tibetan digits in the count, at 12px. On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `BottomNav.svelte`: tab labels `text-xs`; the pill keeps only `absolute -top-2 left-3.5` (CountPill's own `text-xs min-w-5 px-1.5`). `SideNav.svelte`: the collapsed pill keeps `absolute -top-2.5 -right-3.5 bg-sidebar-foreground text-sidebar`.
- e2e `shell.e2e.ts`: the long-labels test (en, de, bo at 375px: in full, at most two lines) now also requires ≥ 12px; the admin phone test checks the Requests pill at ≥ 12px.
- Review additions: `CountPill` has `data-count-pill`; the admin phone test also checks the pill under Tibetan (≥ 12px, line ≥ 2× the size, glyph not cut); the desktop test checks the collapsed side-nav pill (12px, inside the rail, no sideways scroll in the list).

## Review Triage Log

- `text-xs` gives Tibetan the Latin 16px line — false: #114 sets `--text-xs--line-height: 2` under `:lang(bo)` (`tailwind.css:294-330`); now pinned by the Tibetan pill check.
- Pill size checked only in English — low, direct. Patched (Tibetan check).
- Collapsed side-nav pill untested; may overflow the rail — low, direct. Patched (size, inside the rail, no sideways scroll).
- Bottom pill may overlap neighbours with many digits — low; rejected (the pill sits over the 24px icon inside a 75px tab; counts here are small).
- Locator tied to styling classes — low, direct. Patched (`data-count-pill`).
- Assertion comment gives no reason — low, direct. Patched.
