---
id: TOKENS-class-tracker
tool: ui-ux-pro-max
generated: 2026-09-13
companions: [brand-guide.md, component-specs.md]
---

# Design Tokens — Sherab

Implementation-ready CSS custom properties for the SvelteKit app (per ARCHITECTURE-SPINE.md). One token set, two dials — `--celebration-intensity` (full on gamification surfaces, low on utility surfaces) and `--density` (spacious for kid-facing screens, tighter for roster/admin tables) — rather than two separate systems. See [[brand-guide]] for the "why."

## Color

```css
:root {
  /* Core palette — DB match: styles.csv Claymorphism ("Learning blue + play yellow + fun pink") */
  --color-primary: #2563EB;
  --color-on-primary: #FFFFFF;
  --color-secondary: #F59E0B;
  --color-on-secondary: #0F172A;
  --color-accent: #EC4899;      /* celebration only — see brand-guide "What NOT to do" */
  --color-on-accent: #0F172A;   /* #000 flagged too low-contrast on #EC4899 at small text; use dark navy + bold weight, verify 4.5:1 at ship size */

  --color-background: #EFF6FF;
  --color-foreground: #0F172A;
  --color-card: #FFFFFF;
  --color-card-foreground: #0F172A;
  --color-muted: #F1F5FD;
  --color-muted-foreground: #475569;
  --color-border: #E4ECFC;

  --color-destructive: #DC2626;
  --color-on-destructive: #FFFFFF;
  --color-ring: #2563EB;

  /* Status chips — CAP-2 skill-status, CAP-3 homework state (icon/label always pairs with color, never color-only) */
  --color-status-not-started: var(--color-muted-foreground);
  --color-status-learning: var(--color-secondary);
  --color-status-confident: #16A34A;
  --color-status-overdue: var(--color-destructive);
  --color-status-done: #16A34A;
  --color-status-reviewed: var(--color-primary);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-background: #0F172A;
    --color-foreground: #F1F5FD;
    --color-card: #1B2336;
    --color-card-foreground: #F1F5FD;
    --color-muted: #1E293B;
    --color-muted-foreground: #94A3B8;
    --color-border: #334155;
    /* primary/secondary/accent unchanged — Claymorphism DB match: "Dark conditional", keep hue, only swap neutrals */
  }
}
:root[data-theme="dark"] {
  --color-background: #0F172A;
  --color-foreground: #F1F5FD;
  --color-card: #1B2336;
  --color-card-foreground: #F1F5FD;
  --color-muted: #1E293B;
  --color-muted-foreground: #94A3B8;
  --color-border: #334155;
}
```

## Typography

```css
:root {
  --font-display: 'Baloo 2', sans-serif;       /* headings, streak numbers, badge names, nav — everywhere */
  --font-playful: 'Comic Neue', sans-serif;    /* short kid-facing strings only: empty states, toasts */
  --font-body: 'Source Sans 3', sans-serif;    /* dense body copy, tables, forms — admin + teacher */
  --font-tibetan: 'Noto Serif Tibetan', serif; /* lang="bo" content — flagged in brand-guide, no sans alt found */

  --text-xs: 0.75rem;   /* 12px — avoid for body per checklist; labels/meta only */
  --text-sm: 0.875rem;  /* 14px */
  --text-base: 1rem;    /* 16px — body minimum */
  --text-lg: 1.125rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.75rem;  /* streak counters, badge names */
  --text-3xl: 2.25rem;  /* hero streak/badge moments */
  --line-height-body: 1.5;
  --line-height-heading: 1.2;
}
```

## Shape, shadow & motion (Claymorphism core)

```css
:root {
  /* Full celebration intensity — badges, streak card, leaderboard */
  --radius-clay: 20px;
  --border-clay: 3px solid var(--color-border);
  --shadow-clay:
    0 8px 16px rgba(37, 99, 235, 0.12),
    inset 0 1px 2px rgba(255, 255, 255, 0.6);
  --press-duration: 200ms;
  --press-easing: ease-out;

  /* Reduced intensity — roster/forms/admin lists (same language, quieter) */
  --radius-clay-quiet: 12px;
  --border-clay-quiet: 1.5px solid var(--color-border);
  --shadow-clay-quiet: 0 2px 4px rgba(37, 99, 235, 0.08);

  --transition-standard: 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --press-duration: 0ms;
    --transition-standard: 0ms;
  }
}
```

## Spacing & density

```css
:root {
  /* Standard scale (16-64px) — DB default for --density mid; kid-facing screens use this */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* Admin/roster density override — tighter, for data-dense tables only */
  --space-dense-1: 0.25rem;
  --space-dense-2: 0.375rem;
  --space-dense-3: 0.5rem;
  --space-dense-4: 0.75rem;
}
```

## Touch, targets & breakpoints

Source: DB match, `ux-guidelines.csv` (Touch Target Size, Touch Spacing, Touch Friendly, Tap Delay, Back Button, Sticky Navigation, Compact Control Semantics, Mobile Keyboards).

```css
:root {
  --touch-target-min: 48px;   /* Android 48dp baseline; iOS 44pt ≈ 44px — use the larger to cover both, per DB guidance to not treat one platform's unit as universal */
  --touch-gap-min: 8px;
}
```

- `touch-action: manipulation;` on all interactive elements (removes the 300ms tap delay).
- Every skill-status chip (Not started/Learning/Confident) and Done/Reviewed toggle is a `<button aria-pressed="...">`, never a `<div onclick>` — DB-matched "Compact Control Semantics" guidance, severity Critical.
- Numeric inputs (streak grace period, badge milestone step, homework look-ahead window — admin settings from SPEC.md Constraints) use `inputmode="numeric"`.
- Sticky nav gets `padding-top` on the body equal to nav height — never let it overlap content.
- Use `history.pushState()` for in-app navigation so the hardware/browser back button behaves predictably (relevant since this is an installable PWA).

Breakpoints (checklist default): `375px`, `768px`, `1024px`, `1440px`. Mobile-first: teachers and students are phone/tablet-first per SPEC.md constraint ("must run... on existing family phones/tablets").

## Not found in the design database (flag, don't fabricate)

- **Icon set** (`icons.csv` query "badge achievement streak icon" → 0 results): no curated icon recommendations exist for this domain. Fallback: use a general SVG icon library (Lucide or Heroicons) per the standard checklist ("no emoji as icons") — this is a general default, not a database-sourced recommendation.
- **Svelte stack guidance** (`stacks/svelte.csv` → 0 results for forms/accessibility/PWA/offline): no stack-specific rows exist yet for Svelte in this tool's database. The touch/forms/nav guidance above is the general `ux` domain guidance applied to SvelteKit by hand, not Svelte-specific DB output.
