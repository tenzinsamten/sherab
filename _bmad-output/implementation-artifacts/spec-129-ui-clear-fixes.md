---
title: 'Seven clear UI fixes from the review (#129 A)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
baseline_commit: 'ec282868bcf28a198f87214e5c907c66eda7064c'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Seven small UI defects from the review: primary-blue text below 4.5:1 on light-blue surfaces and white below 4.5:1 on the primary hover; the forgot-password success only as a toast; homework and syllabus text with no reading width (~115 characters per line on desktop); three components missing from Tailwind's `@source` list; breadcrumb `truncate` clipping Tibetan vowels; editor buttons whose names do not start with their visible "H1"/"H2"; a password toggle that changes both its name and `aria-pressed`.

**Approach:**
1. Token `--primary-strong: #1d4ed8` (`text-primary-strong`, `bg-primary-strong`), as #119 did for red. Use it for: the More sheet's current item text (on `bg-accent`, 5.66:1), pressed editor toolbar buttons' text, the `info` badge text (on `primary/10`, 5.82:1), and the default Button's hover background instead of `primary/80` (white 6.70:1). Extend `src/lib/ui/contrast.spec.ts`.
2. Forgot password: on success a lasting `<p role="status">` like resend-confirmation's (same classes), instead of the success toast (one announcement). The "expired link" toast stays.
3. `RichText.svelte`: `max-w-prose` on its root.
4. `@source` in `src/lib/ui/tailwind.css`: add `HomeworkFiles.svelte`, `JoinClassCard.svelte`, `PageTour.svelte` (and any other `src/lib/components` file using Tailwind classes but not covered).
5. `PageBreadcrumb.svelte`: the `truncate` crumbs keep Tibetan vowels visible (no vertical clipping: e.g. enough line height/padding, or `text-ellipsis` without cutting the line box).
6. Editor heading buttons: accessible names start with the visible text, e.g. `H1, {m.rte_heading()}` and `H2, {m.rte_subheading()}` (WCAG 2.5.3); no new keys.
7. `PasswordInput.svelte`: a constant name ("Show password", `m.password_show()`, also as `title`) and `aria-pressed` for the state.

**Decisions (2026-10-24):** The user split #129: this part (A) now; the decision items (B) and the table-class refactor (C) are deferred. On the current branch, as the remaining items.

</frozen-after-approval>

## Code Map

- `src/lib/ui/tailwind.css` -- tokens at `:root` (~l.141 `--primary`, `--accent`), the `--color-*` mapping (~l.200), `@source` list (~l.30-45; utilities are `source(none)`, so unlisted files get no classes); #119's `--destructive-strong` is the pattern.
- `src/lib/components/shell/BottomNav.svelte:48` -- `sheetItemClass`: `aria-[current=page]:bg-accent … aria-[current=page]:text-primary`.
- `src/lib/components/RichTextEditor.svelte:52` -- toolbar button class (pressed state text); `:226-243` the H1/H2 buttons with `aria-label={m.rte_heading()}` / `m.rte_subheading()`.
- `src/lib/components/ui/badge/badge.svelte:19` -- `info: 'bg-primary/10 text-primary'`.
- `src/lib/components/ui/button/button.svelte:10` -- `default: 'bg-primary text-primary-foreground hover:bg-primary/80'`.
- `src/routes/(auth)/forgot-password/+page.svelte` -- an `$effect` toasts `m.forgot_success()` on `form?.success`; `resend-confirmation/+page.svelte:31-36` is the status line to copy.
- `src/lib/components/RichText.svelte:26` -- root `<div class="rich-text min-w-0 wrap-anywhere …">`; used by syllabus, student class, student homework and teacher homework pages.
- `src/lib/components/PageBreadcrumb.svelte:41` (`crumbText`), `:70` (`<span class="truncate">`).
- `src/lib/components/PasswordInput.svelte:30-40` -- `aria-label={toggleLabel}`, `title={toggleLabel}`, `aria-pressed={shown}`.
- Tests: `src/lib/ui/contrast.spec.ts` (#119/#122 contrast checks to extend), `e2e/auth-mobile.e2e.ts` (forgot test asserts the toast today), `e2e/auth-fields.e2e.ts:256` (password show/hide test), render specs where present.

## Tasks & Acceptance

**Execution:**
- [x] `tailwind.css`, `BottomNav.svelte`, `RichTextEditor.svelte`, `badge.svelte`, `button.svelte` -- item 1; `contrast.spec.ts` computes the four pairs ≥ 4.5:1 and that those places use the strong token.
- [x] `forgot-password/+page.svelte` -- item 2; update the forgot e2e to the status line.
- [x] `RichText.svelte` -- item 3.
- [x] `tailwind.css` `@source` -- item 4 (a unit test that every `src/lib/components/*.svelte` using Tailwind classes is covered is welcome).
- [x] `PageBreadcrumb.svelte` -- item 5; an e2e or render check under Tibetan that a crumb's box is tall enough for the glyphs.
- [x] `RichTextEditor.svelte` -- item 6; a render/e2e check of the names.
- [x] `PasswordInput.svelte` -- item 7; update `auth-fields.e2e.ts` (name constant, `aria-pressed` toggles).

**Acceptance Criteria:**
- Given the More sheet, a pressed editor button, a "Done" badge and a hovered primary button, then each text meets 4.5:1.
- Given a forgot-password request, when it succeeds, then a status line stays on the page and no success toast appears.
- Given a password field, when the toggle is pressed twice, then its name stays "Show password" and `aria-pressed` goes true then false.

## Implementation Notes

- Implementation (agent): token `--primary-strong` and its four uses; forgot-password status line (no success toast); `max-w-prose` on `RichText`; three components added to `@source` plus `src/lib/ui/tailwind-sources.spec.ts` (fails when a component with classes is not covered); breadcrumb labels `overflow-x-clip text-ellipsis whitespace-nowrap min-w-0` (cut sideways only) with `data-crumb-text`, and a Tibetan e2e at 360px; editor names "H1, …"/"H2, …" (`RichTextEditor.render.spec.ts`); password toggle with one name and `aria-pressed`. `password_hide` is now unused (left: no key changes in scope). The ellipsis with `overflow-x: clip` was checked in Chromium only (Safari supports `overflow: clip` from 16).

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind + edge | HelpSheet active tab `text-primary` on `bg-accent` | medium | Same 4.37:1 pair, missed by the sweep | patch |
| 2 | edge | Default badge link hover `bg-primary/80` with white | low | 3.63:1, as the Button had | patch |
| 3 | blind + edge | `role="status"` inserted with its text may not be announced | medium | The success toast is gone, so it is the only announcement; resend shares the pattern | patch (both) |
| 4 | verification-gap + blind + edge | "No toast" checks retry past the 5 s toast | medium | `toHaveCount(0)` polls 10 s | patch |
| 5 | verification-gap + blind | "…" menu crumbs' clipping fix unchecked | medium | Portaled menu never opened in a test | patch |
| 6 | blind | Toggle `title` says "Show password" while the password shows | low | Hover text contradicts the icon | patch (drop `title`) |
| 7 | blind + edge | `password_hide` unused | low | No reference left | patch (remove) |
| 8 | verification-gap | No rendered check that `--color-primary-strong` maps | maybe-false | Same gap as #119's `destructive-strong`; needs a computed-style e2e | defer |
| 9 | edge | Safari < 16 lacks `overflow: clip` | low | Small share; crumbs would overflow but not clip vertically | reject |
| 10 | edge | Toggle label not reactive to a locale change | false | A locale switch reloads the page | reject |
| 11 | blind + edge | `tailwind-sources.spec.ts` parses only the current `@source` form | low | Matches the file as written; a new form would fail loudly | reject |
| 12 | blind | `max-w-prose` untested; Tibetan width | low | Visual width, checked by hand | reject |
| 13 | blind | Editor spec English only; "H1" applies level 2 | low | Names start with the visible text, as WCAG 2.5.3 asks; levels unchanged | reject |
| 14 | blind | Dark-mode hover | false | `.dark` is never set | reject |
| 15 | edge | Second identical submit not announced again | low | Same message; the page also stays | reject |
| 16 | blind | Ellipsis checked via computed style, not drawn | low | Chromium draws it; visual check listed | reject |
