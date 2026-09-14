---
name: Sherab
description: Bold, high-contrast, editorial/brutalist visual system for the Munich Tibetan Sunday School class tracker — a free volunteer-run PWA, not a polished consumer product.
status: final
sources:
  - '{planning_artifacts}/../specs/spec-class-tracker/SPEC.md'
  - '{planning_artifacts}/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
  - imports/story-1-1-prototype (Claude Design prototype, https://claude.ai/design/p/5cdf70fd-e423-42c0-a485-8f80c0e7c2ab, republished as https://claude.ai/code/artifact/55945e66-4957-4bf7-a10b-8689518d4568)
updated: 2026-09-14
colors:
  # [ASSUMPTION] Hex values approximated from rendered screenshots (imports/*.png) —
  # the design tool's canvas/iframe could not be inspected for computed CSS
  # (cross-origin + Cloudflare-gated). Confirm/replace with exact values before
  # pixel-level implementation; approximation is good enough for build-out now.
  surface-base: '#FFFFFF'
  surface-inverse: '#0B1330'
  primary: '#2F5FE0'
  primary-foreground: '#FFFFFF'
  attention: '#F2A71B'
  attention-foreground: '#1A1208'
  error: '#D92D20'
  error-foreground: '#FFFFFF'
  ink-primary: '#0B1330'
  ink-inverse: '#FFFFFF'
  ink-muted: '#6B7280'
  border-hairline: '#D8DEE9'
  border-hairline-inverse: 'rgba(255,255,255,0.25)'
typography:
  display:
    note: '[ASSUMPTION] Heavy, tight-tracked, all-caps grotesk/sans — visually close to Archivo Black or an Inter/Geist 900 cut. Exact family not extractable from screenshots; confirm with the design tool export or pick a free/self-hostable heavy sans given AD-6''s free-tier cost discipline.'
    fontWeight: '800-900'
    letterSpacing: '-0.01em'
    textTransform: uppercase
  section-label:
    note: 'Small uppercase caption with wide tracking, e.g. "01 / ACCESS", "MUNICH TIBETAN SUNDAY SCHOOL".'
    fontSize: 12px
    letterSpacing: '0.08em'
    fontWeight: '600'
    textTransform: uppercase
  body:
    fontWeight: '400'
    fontSize: 16px
    lineHeight: '1.5'
  form-label:
    note: 'Small uppercase caption above inputs, e.g. "EMAIL", "PASSWORD".'
    fontSize: 11px
    letterSpacing: '0.06em'
    fontWeight: '600'
    textTransform: uppercase
  button-label:
    fontWeight: '700'
    letterSpacing: '0.04em'
    textTransform: uppercase
  code:
    note: 'Class/teacher invite codes (e.g. "4KTM7X") — tracked, bold, rendered in {colors.primary} as if interactive/copyable.'
    letterSpacing: '0.08em'
    fontWeight: '700'
rounded:
  DEFAULT: 0px
spacing:
  # [ASSUMPTION] Approximate rhythm read from screenshots, not measured pixels.
  '1': 4px
  '2': 8px
  '3': 16px
  '4': 24px
  '5': 32px
  '6': 48px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.DEFAULT}'
  button-secondary-outline:
    background: transparent
    border: '2px solid {colors.ink-primary}'
    foreground: '{colors.ink-primary}'
    radius: '{rounded.DEFAULT}'
  nav-tab-active:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
  stat-tile:
    border: '1px solid {colors.border-hairline}'
    number: '{typography.display}'
    label: '{typography.section-label}'
  data-table-header:
    background: '{colors.surface-inverse}'
    foreground: '{colors.ink-inverse}'
  attention-banner:
    background: '{colors.attention}'
    foreground: '{colors.attention-foreground}'
  stat-tile-attention-number:
    color: '{colors.attention}'
  form-error:
    border: '{colors.error}'
    text: '{colors.error}'
  status-chip-approved:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
  status-chip-rejected:
    background: '{colors.border-hairline}'
    foreground: '{colors.ink-muted}'
---

## Brand & Style

Sherab (working title "Class Tracker") is a free, volunteer-run tool for a Sunday Tibetan-language school — not a venture-backed consumer app. The visual language says so on purpose: bold, unpolished-on-purpose, high-contrast, almost poster-like. Huge all-caps display type, numbered section labels ("01 / ACCESS", "02 / CLASSES") that read like a printed workbook or a zine rather than a SaaS dashboard, sharp rectangular edges everywhere, and exactly one accent color doing all the pointing. Nothing here is decorative — the boldness exists to stay legible and confident for non-technical volunteer teachers and parents on a phone, not to look "designed."

This system is from-scratch (no inherited component library — the architecture spine names no UI framework), so DESIGN.md carries the full visual contract rather than a brand-layer delta.

## Colors

The palette is deliberately small: one dark neutral, one accent, one warning, everything else is white/gray.

- **Ink Navy (`{colors.ink-primary}` / `{colors.surface-inverse}`)** does double duty as the primary text color on white surfaces and as a near-black background for chrome (top nav, hero sections, table headers). It reads as "structure" — navigation, headers, dividers between one part of the app and another.
- **Signal Blue (`{colors.primary}`)** is the single accent. It marks the one primary action per screen (SIGN IN, CREATE CLASS, CREATE TEACHER), the active nav tab, the large numbers in stat tiles, and class/teacher invite codes. If it's blue, it's either the thing to click or the number that matters.
- **Attention Amber (`{colors.attention}`)** means "needs a human's attention" — broader than first observed. It marks the one-time/irreversible-operation notice (admin-bootstrap explainer) *and* the "PENDING" stat-tile number on the admin dashboard (an outstanding-approvals count). Both readings share one idea: something is waiting on a person to act. Not used for destructive-action confirmations (that's `{colors.error}`) or ordinary decoration.
- **Error Red (`{colors.error}`)** marks field-level validation failure only (observed: an invalid class code renders a red input underline plus red inline text below the field). Not used anywhere else yet — no destructive-button or toast use observed.
- **Hairline (`{colors.border-hairline}` / `{colors.border-hairline-inverse}`)** separates rows and sections at the lowest contrast that still reads — table rows, stat-tile grid lines, the rule under a hero headline. The same neutral, at slightly higher fill, backs the muted "REJECTED" status chip.

Avoid: gradients, more than the four functional colors (ink navy, signal blue, attention amber, error red), tinted surfaces for hierarchy (hierarchy comes from type size/weight and the navy/white split, not color washes).

## Typography

Two registers only: a huge bold all-caps **display** register for headlines and stat numbers, and a plain regular-weight **body** register for sentences. Everything else (section labels, form labels, button labels, invite codes) is a small tracked-out uppercase caption variant of one or the other — there is no third "regular UI" register in between.

`{typography.display}` is reserved for section headlines ("CLASS TRACKER", "SIGN IN", "CLASSES", "TEACHERS") and the large numerals in stat tiles — never for body copy or button labels, which stay smaller and less extreme even when bold.

[OPEN QUESTION] The observed design is 100% Latin uppercase Western type. SPEC.md requires German/English/**Tibetan** UI (Paraglide i18n is already in the architecture). Tibetan (Uchen) script has no concept of "uppercase," typically needs more line-height than Latin caps, and a heavy Latin display face will not render Tibetan glyphs at all. This system does not yet define a Tibetan-script fallback for `{typography.display}`/`{typography.section-label}` — flagged for the user rather than invented; needs a decision before the `bo` locale ships any screen that currently relies on all-caps display type.

## Layout & Spacing

Single-column, mobile-first. The prototype shows two concrete breakpoints: a phone-width card (~390-430px content column) and a desktop layout where the same content sits in a wider single column with the nav going horizontal and stat tiles / tables gaining a second dimension (2-up grid, full-width table with a dark header row) — no sidebar, no multi-column dashboard. Margins are generous on desktop, edge-to-edge with modest padding on phone. Vertical rhythm inside a data grouping (stat tiles, table rows) is tight (`{spacing.2}`–`{spacing.3}`); the gap between major sections (hero → access, one numbered section → the next) is large (`{spacing.5}`–`{spacing.6}`).

## Elevation & Depth

None. No shadows or elevation were observed anywhere in the prototype — every surface is flat, and separation between regions comes from solid color blocks (navy vs. white vs. blue) and hairline rules, never from a drop shadow. Keep it that way; a shadow would read as borrowed-from-a-generic-dashboard-kit against this system's poster-like flatness.

## Shapes

Zero border-radius, everywhere — buttons, inputs, cards, table cells, the phone-frame chrome itself. This is a hard rule, not a default: the sharp-corner language is part of what makes the system read as a printed workbook rather than a soft consumer app.

## Components

- **Primary button** — `{colors.primary}` fill, `{colors.primary-foreground}` text, full-width on phone, sharp corners, bold uppercase label (`{typography.button-label}`). One per screen/section — SIGN IN, CREATE ACCOUNT (bootstrap), CREATE CLASS, CREATE TEACHER.
- **Secondary button** — transparent fill, `{colors.ink-primary}` border and text, same shape/label treatment. Used for a screen's non-default action (e.g. "MANAGE TEACHERS" next to a filled "MANAGE CLASSES").
- **Top nav** — `{colors.surface-inverse}` bar. Brand wordmark "SHERAB" + version tag ("v0.1") left; role-appropriate tabs right, active tab rendered as a solid `{colors.primary}` block, inactive tabs plain light text; sign-out sits below/beside the tabs.
- **Section label** — small tracked uppercase caption pairing a two-digit index with a name (`{typography.section-label}`, e.g. "03 / TEACHERS"). Precedes every major heading; acts as the app's wayfinding/breadcrumb device in place of a conventional breadcrumb bar.
- **Stat tile** — 2×2 (or 2×N) hairline-bordered grid, each cell a small uppercase label (`{typography.section-label}`) over a huge bold number (`{typography.display}`, sized down from hero scale). A zero/empty value renders in a visibly lower-contrast tone than a populated one (observed: "STUDENTS 00" rendered pale vs. "CLASSES 02" rendered full-strength ink) — treat that dimming as the empty-state signal for numeric tiles. A tile whose count means "waiting on a person" (observed: "PENDING") renders its number in `{colors.attention}` instead of ink — the one departure from the ink/blue-only number rule, reserved for actionable-backlog counts.
- **Data table** — desktop: `{colors.surface-inverse}` header row with white uppercase column labels, white body rows separated by hairlines. Phone: same data as stacked, hairline-divided rows without the header bar (label-value pairs instead of columns).
- **Invite/class code** — rendered as tracked bold text in `{colors.primary}`, visually distinct from surrounding text as if clickable/copyable. [ASSUMPTION] Copy-to-clipboard behavior was not verified interactively; confirm intended behavior for EXPERIENCE.md.
- **Attention banner** — full-bleed `{colors.attention}` block with dark text, used above a form to explain an irreversible or one-time operation (observed: admin-bootstrap explainer).
- **Form field** — uppercase `{typography.form-label}` caption above a boxed input with a bottom-emphasis underline; no rounded corners, no floating label animation observed. Invalid state (observed: bad class code) swaps the underline to `{colors.error}` and adds a red inline message below the field.
- **Multi-step wizard header** — the same full-bleed blue hero panel doubles as a step-progress list: numbered steps (`01`, `02`, `03`) stacked with hairline dividers, the current step in bold white text, other steps dimmed. Steps 2+ pair the primary "CONTINUE" button with a secondary outline "BACK" button.
- **Status chip** — small solid label tagging a decided item: `{components.status-chip-approved}` (solid blue fill, white text) or `{components.status-chip-rejected}` (hairline-gray fill, muted text — the paired row's own text also renders muted, not just the chip).
- **Request row (approval queue)** — name, class-code link, and date, followed by a primary "APPROVE" / secondary "REJECT" button pair. The action is immediate — no confirmation dialog observed — after which the row moves into a "DECIDED" section below a divider and an `aria-live="polite"` banner confirms the outcome in a full sentence, not just a label.
- **Empty-queue panel** — a thin hairline-bordered box (distinct from the stat-tile zero-value treatment) with a bold short heading ("Nothing waiting") and one sentence of body copy describing what will appear there.

## Do's and Don'ts

| Do | Don't |
|---|---|
| One accent color (`{colors.primary}`) per screen for the single primary action | Multiple competing accent colors, or blue used decoratively |
| Sharp corners everywhere, no exceptions | Introduce rounded corners "for softness" on any one component |
| Flat surfaces, hairline separation | Add drop shadows or elevation for hierarchy |
| Huge all-caps display type for headlines only | Set body copy, button labels, or long strings in the display register |
| Numbered section labels as the wayfinding device | Add a second, conventional breadcrumb bar on top of it |
| Amber (`{colors.attention}`) for "waiting on a person": one-time-procedure notices and outstanding/pending counts | Amber for form-validation errors (that's `{colors.error}`) or as a decorative accent |
| Red (`{colors.error}`) for field-level validation only | Red for destructive-button fills or toast banners until a screen actually demonstrates that |
| Immediate action + `aria-live` confirmation for reversible list actions (approve/reject) | Add a confirmation dialog the source design doesn't show — don't invent friction either |
