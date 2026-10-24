---
id: TOKENS-class-tracker
rewritten: 2026-10-24
source: src/lib/ui/tailwind.css, src/lib/ui/classes.ts, src/app.css, src/routes/+layout.svelte, src/lib/components/ui
tests: src/lib/ui/contrast.spec.ts, src/lib/ui/tailwind-sources.spec.ts, src/routes/requests/page.render.spec.ts
supersedes: the 2026-09-13 token set (Claymorphism, Baloo 2, 48px, dark theme)
---

# Design Tokens — Sherab (as built)

The app's look as the code defines it (#130). The code is the source of truth: the theme tokens
live in `src/lib/ui/tailwind.css` (`:root` and the `@theme` mapping), the shared class strings in
`src/lib/ui/classes.ts`, the Tibetan font in `src/app.css`. When a token changes there, change this
page. Contrast ratios are WCAG 2.x; those marked **(tested)** are computed in
`src/lib/ui/contrast.spec.ts`, the others were computed for this page.

The theme comes from Siemens iX's classic light theme, with Sherab's overrides: a primary blue, a
navy frame and a small radius. Components use these tokens. Exceptions with their own colours: the
calendar's class chips (below) and the toasts (Sonner's `richColors`).

## Colour

On white:

| Token | Value | Role | Contrast on white |
|---|---|---|---|
| `--background`, `--card`, `--popover` | `#ffffff` | Page, cards, popovers | — |
| `--foreground` (and `*-foreground` on light surfaces) | `rgba(0,10,20,.9)` | Body text | 16.09:1 |
| `--muted` / `--secondary` | `#eff0f1` | Quiet surfaces, the signed-out shell | — |
| `--muted-foreground` | `rgba(0,10,20,.6)` | Secondary text | 5.31:1 (5.09:1 on `--muted`) |
| `--primary` | `#2563eb` | Primary actions, links, current filter | 5.17:1; white on it 5.17:1 |
| `--primary-strong` | `#1d4ed8` | Blue text on light-blue surfaces; primary and badge-link hover (#129) | 5.66:1 on `--accent`, 5.82:1 on `primary/10`, white on it 6.70:1 **(tested)** |
| `--accent` | `rgba(37,99,235,.12)` | Current item, pressed tool | — |
| `--destructive` | `#d72332` | Errors, red tints, borders | 5.03:1 |
| `--destructive-strong` | `#b91c1c` | Text and icon of the destructive button on its tint (#119) | 5.53:1 on `destructive/10`, 4.70:1 on `/20` (hover, the binding case) **(tested)** |
| `--success` | `#2c8500` | Success states | 4.71:1 |
| `--warning` | `#ffbb00` | Warning tints and borders (never as text) | — |
| `--border` | `rgba(0,20,40,.2)` | Card and table lines (decorative) | — |
| `--input` | `rgba(0,20,40,.5)` | Field borders (#122) | 3.51:1, 3.42:1 on `--muted` (3:1 non-text) **(tested)** |
| `--ring` | `#2563eb` | Focus outline | 5.17:1 |

On `--muted` (the signed-out shell's background), plain red and green text fall below 4.5:1:
`--destructive` 4.41:1, `--success` 4.12:1 (`--primary` 4.53:1). Error and success text there sits
on a white card, or uses the strong tokens (5.67:1 and 5.87:1).

Rules held by tests:

- Red text on a red tint uses `--destructive-strong`; blue text on a light-blue surface uses
  `--primary-strong` (the plain tokens give 4.30:1 and 4.37:1) — `contrast.spec.ts`.
- Only actions that erase data are red; Reject is a neutral outline (#124) —
  `src/routes/requests/page.render.spec.ts`.

### The frame (header and navigation)

| Token | Value | Role |
|---|---|---|
| `--frame`, `--sidebar` | `#0f172a` | Navy header and side nav |
| `--frame-foreground`, `--sidebar-foreground` | `#ffffff` | Text on the frame (17.85:1) |
| `--sidebar-primary` | `#2563eb` | The current page's item (white text on it 5.17:1) |
| `--sidebar-accent`, `--sidebar-border` | `rgba(255,255,255,.12)` | Hover and lines on the frame |
| `--sidebar-ring` | `#ffffff` | Focus on the frame, clear of the blue current item (#122) |

### Celebration (kid-facing only)

Progress tiles, badges and the New badge dialog (`ui.clay`) keep a softer treatment from the
original brand: `--clay` `#e4ecfc` (border), `--play` `#f59e0b`, `--celebrate` `#ec4899`,
`--radius-clay` 20px and `--shadow-clay`. Nothing else uses them.

### Calendar chips

The calendar gives each class a colour from its own palette, `--chip-c0` … `--chip-c5`
(`-bg`/`-fg`/`-accent`, hex in `tailwind.css`), with text on its tint at least 7:1; a cancelled
session uses a grey chip.

## Typography

- `--sherab-font-sans`: `'Atisha'`, then the system stack (`system-ui`, `-apple-system`, `Segoe UI`,
  Roboto, …). `--sherab-font-bo` is the same stack inside the new UI (`[data-ui='new']`); outside
  it, `src/app.css` sets `--font-tibetan: 'Atisha', serif` on `[lang='bo']` and `h1`–`h3`.
- Atisha (`src/app.css` `@font-face`): one file, weight 400 (bold is synthesised),
  `unicode-range: U+0F00-0FFF` (so it draws only Tibetan, in any interface language, while Latin
  falls through to the system font), `font-display: swap`, and `size-adjust: 136%`, which makes
  Tibetan 1.36× the font size.
- Line height 1.5; under Tibetan (`:lang(bo)`) 2, including inside `text-xs` … `text-4xl` and
  `leading-tight`/`-snug`/`-relaxed` (#114). Not covered: `leading-none`/`-normal`/`-loose`,
  numeric or arbitrary leadings, and sizes from `text-5xl` up. The copied values are pinned to
  Tailwind 4.3.3 (update them when Tailwind is upgraded).
- Sizes are Tailwind's scale, with a few fixed sizes (`text-[0.8rem]` in Button `sm`,
  `text-[0.8125rem]` in BadgeCollection, `text-[0.875rem]` in toasts); nothing is below 12px (#123).
- Headings: `ui.heading` `text-2xl` bold; `ui.cardTitle` `text-lg` bold; small labels `text-xs`
  bold uppercase (`ui.kicker`, `ui.label`). Body copy is sentence case.
- Long text has a reading width: `max-w-prose` on rich text and subtitles (#129).

## Shape and spacing

- `--radius` 0.25rem (`rounded-md`/`lg`/`xl` all map to it; `rounded-sm` is 2px less).
- Cards: `ui.card` — border, `p-4` on a phone, `p-6` from `md` (48rem).
- Pages: `ui.page` — a column with `gap-4`/`gap-6`, centred and capped at `max-w-5xl` from `md`.
  The signed-in shell adds the side gutter (1rem, 2rem from `md`, at least the safe-area inset);
  the signed-out shell only the safe-area inset (its cards centre themselves).
- Navigation: a bottom tab bar below `xl` (80rem), a side nav from `xl`.
- Dialogs: a white surface with a `ring-1 ring-foreground/10` edge.

## Touch, focus and states

- Touch targets: `ui.touch` (`h-auto min-h-11 px-4 text-base whitespace-normal`) gives 44px of
  height; icon buttons use `size-11`, the calendar `min-width: 2.75rem`. 44px is the standard (user,
  2026-10-24). Input and NativeSelect are `h-11` by default. Smaller defaults to avoid: Button's
  own sizes (28–32px) and NativeSelect `size="sm"` (28px); callers add `ui.touch` (#129 B deferred).
- Focus: a solid 2px outline in `--ring` with a 2px offset (`focus-visible:outline-2 outline-solid
  outline-offset-2 outline-ring`, #122) on Button, Input, NativeSelect, Badge and the editor.
  Controls whose base sets `outline-none` need `outline-solid`. Variations: the calendar's buttons
  and events use a 1px offset; `ui.filter`, `ui.link` and `ui.tileLink` omit `outline-solid` (fine
  while they set no `outline-none`); the Help sheet's close button has no offset.
- A "Skip to content" link is the first Tab stop on every page (#122).
- Invalid fields: `aria-invalid` gives a red border and a `ring-3 ring-destructive/20`; disabled
  controls are `opacity-50` (inputs also `bg-input/50`).

## Motion

`@theme` animations: `--animate-badge-pop` and `--animate-badge-burst` (the New badge dialog,
`motion-safe:` only) and `--animate-nav-progress` (the loading bar). Under
`prefers-reduced-motion`, the new UI drops every animation and transition except `.animate-spin`.

## Theme

Light only. Dark mode is deferred (#13): the `dark:` variants in the shadcn components apply only
under a `.dark` class, which the app never sets, and there are no dark tokens.

## Tailwind

Tailwind runs without its global reset (scoped to `[data-ui='new']`), with `!important` utilities,
and with `source(none)`: only files listed by `@source` in `tailwind.css` get their classes
generated. `src/lib/ui/tailwind-sources.spec.ts` fails when a component in `src/lib/components`
that uses classes is not listed; route pages are not checked by it.
