---
title: 'Visible field borders, focus outlines and a skip link (#122)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Field borders (`--input` rgba(0,20,40,.3), 2.00:1 on white) fall below the 3:1 for non-text contrast; the focus ring (`ring-3 ring-ring/50`, about 2.14:1) is a faint halo; in the side nav the current item and its focus outline are the same blue, so focus on it is invisible; there is no "Skip to content" link, so keyboard users tab through the header and nav on every page.

**Approach:** `--input` to rgba(0,20,40,.5) (3.51:1). In Button, Input, NativeSelect, Badge and the rich-text editor, the faint ring becomes a solid 2px outline in `--ring` (#2563eb, 5.17:1 on white) with a 2px offset (`focus-visible:outline-2 outline-offset-2 outline-ring`; the editor on `focus-within`). Side-nav items focus with a white outline offset 2px (on the navy frame 17.85:1, clear of the blue current item). A visually hidden "Skip to content" link first in both shells (signed in and out), shown on focus, to `<main id="main" tabindex="-1">`. New text `skip_to_content` in en, de, bo (Tibetan: the assistant's draft). Invalid fields keep their red ring.

**Decisions (2026-10-24):** Done on the current branch (`fix/121-unsaved-changes-guard`) at the user's request; values as in the review entry's likely fix.

</frozen-after-approval>

## Implementation Notes

- `tailwind.css`: `--input` rgba(0,20,40,.5). Button, Input (both), NativeSelect, Badge: `focus-visible:ring-3 ring-ring/50` → `focus-visible:outline-2 outline-solid outline-offset-2 outline-ring`; RichTextEditor the same on `focus-within`. `outline-solid` is needed: these bases carry `outline-none`, which sets `--tw-outline-style: none`, and `outline-2` reuses that variable (the keyboard e2e caught it). SideNav focus: `outline-offset-2 outline-sidebar-foreground`.
- Skip link in `+layout.svelte` once, before both shells: fixed, translated above the viewport, `focus:translate-y-0`; not `sr-only` + `focus:not-sr-only` (Tailwind v4's `not-sr-only` forces `position: static` and `padding: 0`, and the app's `.sr-only` clips with `clip`). Both `<main>` are `id="main" tabindex="-1"` with `outline-none`. `skip_to_content`: en "Skip to content", de "Zum Inhalt springen", bo draft "ནང་དོན་ལ་ཐད་ཀར་འགྲོ།".
- Tests: `contrast.spec.ts` (`--input` ≥ 3:1; no `ring-ring/50`, an `outline-solid` in each control); e2e `auth-mobile.e2e.ts` "skip link (…)" and the keyboard order with the skip link first.
- Review fixes: `<main>` is no longer `tabindex="-1"` all the time; the skip link's `onclick` (Enter too) makes it focusable only for the jump (removed on blur) and focuses it without a hash or history entry; `href="#main"` still works without JS. Shadow only on focus. `--sidebar-ring` is now white and the side nav uses it again.

## Review Triage Log

- Skip link untested signed in — low, direct. Patched: e2e in `shared-mobile.e2e.ts` at 1440px (past header and side nav, no `#main` in the URL, no lasting `tabindex`).
- Skip link during a navigation (`<main inert>`) — low; rejected (a jump while a page loads is rare; the next one works).
- `#main` hash adds history, could meet the #121 guard — low, direct. Patched: JS focus without a hash (the #121 guard also skips same-page hash links).
- Permanent `tabindex="-1"` makes clicks on text focus `<main>` — medium (changes `activeElement` app-wide, e.g. #109 focus restore). Patched as above.
- Focused invalid field shows red ring and blue outline — low; rejected (two valid indicators; no overlap of meaning).
- Darker `--input` also darkens checkbox/radio borders, disabled fields, calendar chips — low; rejected (the darker borders also help those controls reach 3:1; calendar e2e run in the gate).
- `--sidebar-ring` left blue and unused — low, direct. Patched (white, used by the side nav).
- Focus check in `contrast.spec.ts` too weak — low, direct. Patched (no `ring-3`, `ring-[3px]` or `ring-ring/50` focus rings).
- Border checked on white only — low, direct. Patched (also on `--muted`).
- Tibetan text unflagged — false: it is listed as a draft in the spec and the issue log entry.
- Editor wrapper and toolbar button outlines together — low; rejected (inner outline marks the focused button, outer the editor).
- Hidden link's shadow may peek — low, direct. Patched (`focus:shadow-md`).
