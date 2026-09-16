---
title: 'Restyle auth, join, and requests screens to the Story 1-1 prototype design'
type: 'refactor'
created: '2026-09-16'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/ui-restyle-story-1-1-prototype-reference.html'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-ui-restyle-sherab-design.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tib-class-2026-09-14/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tib-class-2026-09-14/EXPERIENCE.md'
  - 'https://claude.ai/artifact/BZvqrZenRHyAcHd7kCofu9 ("Story 1-1 Prototype.dc.html" — the user-shared source; the local reference file above is a decoded, durable copy of its markup)'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `spec-1-1-ui-restyle-sherab-design.md` already restyled Story 1-1's screens (login, signup, admin/classes, admin/teachers, teacher home) to a token-level interpretation of `DESIGN.md`/`EXPERIENCE.md` — bold, high-contrast, zero-radius, uppercase display type. Since then, the user built (and shared) a much more specific, fully interactive prototype covering that same territory plus the screens that restyle explicitly left out of scope (the Join wizard and the Requests approval queue). The user reports the live app "is not matching with the design provided." Comparing the prototype against the current implementation confirms this is not fine-tuning: the prototype uses a **split poster/form layout** (a colored or dark full-height panel with a giant uppercase headline on one side, the actual form on the other) for every auth-adjacent screen — a layout pattern the current implementation has **nowhere**, which instead centers a single plain `.card` on every such screen. The prototype also uses different exact color values (`#2563EB` signal blue vs. the implemented `#2f5fe0`; `#0F172A` ink vs. `#0b1330`; `#F59E0B` amber vs. `#f2a71b`; `#DC2626` error vs. `#d92d20`), a richer light-blue tint scale (`#F8FAFF`/`#F1F5FD`/`#E4ECFC`/`#BFD4FE`) the current tokens don't have, a single variable-weight `Archivo` family for both heading and body (the implementation instead pairs a separate `Archivo Black` display face with `Source Sans 3` for body), and dramatically larger hero/page-heading type scales the current `--text-*` scale tops out well short of.

**Approach:** Treat the prototype (`ui-restyle-story-1-1-prototype-reference.html`, decoded from the artifact link above — read it directly for exact markup/pixel/hex values, not just the diff summary below) as the new canonical visual reference, superseding `DESIGN.md`'s more abstract token guidance wherever the two differ. Retune `src/app.css`'s color tokens to the prototype's exact hex values and its richer tint scale; unify on one variable-weight `Archivo` font family (drop `Archivo Black`/`Source Sans 3` as two separate faces) with heading weight 800 by default and 900 for hero/page-level headings; add the missing large type-scale steps. Build the split poster/form layout as a reusable pattern and apply it to every screen the prototype shows it on: home, login, signup (admin bootstrap, amber poster), the three Join wizard steps, and `/join/pending`. Give `/requests`, `/admin/classes`, and `/admin/teachers` the prototype's large-number-counter-plus-kicker header treatment and grid-based (not `<table>`-based) row layout. Preserve every route, form action, i18n key, and the Tibetan `[lang='bo']` no-uppercase exemption exactly as-is — this is a pure visual/markup restyle with no functional or scope change, mirroring the prior restyle's own boundary. The prototype's own outer 2px-bordered "frame" and top prototype toolbar (Phone/Desktop/Reset buttons, the "STORY 1-1 / PROTOTYPE" chip) are tooling artifacts of the design canvas itself, not part of the app to replicate — the real target is everything *inside* that frame (the dark top nav bar down through the bottom locale/route status strip).

</frozen-after-approval>

## Concrete Design-vs-Implementation Diff

Derived by reading both `src/app.css` (current) and the decoded prototype reference (target) side by side. This is a distillation for planning — the reference file has the exact values.

**Color tokens** — current → target:
- `--color-primary: #2f5fe0` → `#2563EB` (hover `#1D4FD7`, active `#1B45BE`)
- `--color-secondary: #f2a71b` → `#F59E0B` (used only as the signup/admin-bootstrap poster background in the prototype, not a general secondary accent)
- `--color-surface-inverse: #0b1330` → `#0F172A`
- `--color-destructive: #d92d20` → `#DC2626`
- No equivalent today for the prototype's light-blue tint scale, all used repeatedly: `#F8FAFF` (input background), `#F1F5FD` (hover/tint background), `#E4ECFC` (hairline row dividers), `#BFD4FE` (light text on dark panels)
- No equivalent today for the prototype's slate scale: `#94A3B8`, `#475569`, `#334155`, `#CBD5E1`, `#E2E8F0` (current has only one `--color-muted-foreground: #6b7280` and one `--color-border: #d8dee9`)

**Typography** — current → target:
- Two font families (`Archivo Black` display + `Source Sans 3` body) → one variable-weight `Archivo` family (400–900) for both
- No hero scale today → prototype's poster-panel headlines: 76px desktop / 52px phone, weight 900, line-height 0.92, letter-spacing -0.035em
- No large page-heading scale today → prototype's list/management page headings (Requests, Classes, Teachers): 56px desktop / 40px phone, weight 900
- Micro-labels/eyebrows: prototype uses `font-variant-numeric: tabular-nums` with 10–11px, letter-spacing 0.12–0.14em, weight 700 consistently for every uppercase caption, kicker, and table header — current `.section-label`/`.field label` use 0.6875–0.75rem with a slightly different letter-spacing/weight combination

**Layout — the largest gap:**
- Every auth-adjacent screen in the prototype (home, login, signup, all three Join steps, join/pending) is a **split poster/form layout**: a colored/dark panel (ink for login/pending, signal blue for home/join, amber for signup) with a giant uppercase headline plus supporting copy or a numbered step list, next to a plain white panel holding the actual form, centered, max-width ~400–420px; stacks to a single column on narrow viewports. **The current implementation has no such layout anywhere** — every one of these routes centers a single `.card` instead (confirmed by reading `login/+page.svelte`, `(auth)/join/+page.svelte`, `(auth)/join/pending/+page.svelte` this session).
- `/requests` in the prototype has a large (56px/900-weight) pending-count number top-right next to the heading, plus a numbered "kicker" line (e.g. "05 / Teacher"); the current `requests/+page.svelte` is a plain `<h1>` with no counter or kicker.
- `/admin/classes` and `/admin/teachers` follow the same counter+kicker header pattern (`02 / Classes`, `03 / Teachers`), which the current implementation doesn't have — it only has a plain heading (no numbered kicker, no live count).
- The prototype's Join step-3 consent control is a full-width clickable row with a custom 22×22 square checkbox glyph (2px border, fills blue+checkmark when checked) and a hover tint — the current implementation uses a bare native `<input type="checkbox">` with no custom visual treatment.
- The prototype's Join wizard step indicator lives *inside* the poster panel as a vertical numbered list with opacity-dimmed inactive steps ("01 Class code", "02 Your name", "03 Guardian consent") — the current implementation has a small horizontal `01/02/03` tab strip at the top of the plain card instead, a materially different presentation.
- The prototype's tables (Classes, Teachers, Requests) are CSS grid rows with `grid-template-areas` that swap between a desktop multi-column layout and a phone-stacked layout, with a dark (`ink`) header row — the current implementation uses literal `<table>` elements styled via the shared `table`/`thead th`/`th, td` rules, which don't reflow the same way on narrow viewports.
- The prototype's top nav bar includes a small "v0.1" version tag next to the brand wordmark, and the whole frame has a bottom status strip showing the current route path and "locale de · en · bo" — neither exists in the current `+layout.svelte`.

**Reasonably already aligned (low/no risk here):** zero border-radius, no box-shadows, flat (non-elevated) hover states in spirit, the `.field input`/underline-style input treatment (bg tint + bottom border only, close to the prototype's `#F8FAFF` + bottom-border inputs), the Tibetan `[lang='bo']` no-uppercase/no-forced-display-font exemption, and the `Requests` decided-section's colored status badges (blue "approved" pill / gray "rejected" pill already exist and are visually close to the prototype's).

## Boundaries & Constraints

**Always:** Keep every route, Svelte action name (`?/register`, `?/approve`, etc.), and i18n message key exactly as they are today — this is markup/CSS only. Keep the Tibetan `[lang='bo']` exemption (no forced uppercase/display font) working exactly as it does now for every screen touched. Route every new/changed piece of UI copy through Paraglide (`m.*`), never an inline literal — this was a real finding in the prior restyle's own review (a hardcoded section-label string broke German/Tibetan) and applies again here. Preserve existing ARIA attributes (`aria-current="page"` on the active nav link, `aria-describedby` on the consent checkbox, `aria-live="polite"` outcome announcements) and add equivalents for any new custom control (e.g. the prototype's custom checkbox glyph needs a real accessible checked-state, not just a visual `✓`).

**Never:** Do not change any server action's behavior, validation, or the guardian-email-verification gating just built (unverified badge, approve-disabled-until-confirmed) — this restyle wraps that behavior in new markup, it doesn't touch it. Do not rebuild the prototype's outer bordered "frame" or its Phone/Desktop/Reset prototype toolbar — those are design-canvas tooling, not app UI. Do not introduce a second CSS framework or component library — keep extending `src/app.css`'s shared classes/tokens, the same approach the prior restyle used. Do not touch student-facing/gamification screens — none exist yet, out of scope.

## Code Map

- `src/app.css` — retune color tokens to the prototype's exact hex values (see diff above); add the light-blue tint scale and slate scale as new custom properties; collapse `--font-display`/`--font-body` to one `Archivo` family, update the Google Fonts `@import` accordingly; add hero (76px/52px) and page-heading (56px/40px) scale steps; add a reusable `.poster-split`/`.poster-panel`/`.form-panel` class pair (or similar) for the split-screen layout, parameterized by poster background color via a modifier class or CSS variable (ink/blue/amber per screen); add a custom-checkbox class for the consent control; convert `.field label`/`.section-label`'s letter-spacing/weight to match the prototype's tabular-nums micro-label treatment.
- `src/routes/+layout.svelte` — add the "v0.1" version tag next to the brand wordmark; add the bottom status strip (route path + locale list) if it's judged worth keeping outside the prototype-only toolbar (flag this as a judgment call during implementation — it may be more prototype-navigation furniture than real product chrome; note the decision either way).
- `src/routes/(auth)/login/+page.svelte`, `(auth)/signup/+page.svelte` — rebuild as split poster/form layout (ink poster for login with the prototype demo-account shortcuts *omitted*, since those are prototype-only fake data — real login has no such list; amber poster for signup/admin-bootstrap, matching the prototype's one-time-step framing).
- `src/routes/(auth)/join/+page.svelte` — rebuild all three steps as split poster/form layout with the poster-panel vertical step list; rebuild the guardian-email + consent step's checkbox as a full-row custom control (this step now also has the guardian-email field added for verification — fold the prototype's consent-row treatment onto both the guardian-email input and the consent control, since the prototype predates that field).
- `src/routes/(auth)/join/pending/+page.svelte` — rebuild as split poster/form layout with the prototype's name/class/consent summary grid (and add the guardian-email-confirmation line already added in this session's guardian-email-verification work, styled consistently with the new summary grid).
- `src/routes/requests/+page.server.ts` — likely needs a live pending-count passed to the page data if not already exposed in the right shape for the new counter header (check `data.pending.length` is already sufficient before adding anything).
- `src/routes/requests/+page.svelte` — rebuild the header with the kicker+counter treatment; convert the pending/decided lists from the current flex/`<li>` layout to the prototype's CSS-grid row pattern with responsive `grid-template-areas`; keep the guardian-email "unverified" badge and confirmation-gated Approve button from the just-built verification work, restyled to match (e.g. as an additional small tag near the status badges, not a structural change).
- `src/routes/admin/classes/+page.svelte`, `admin/teachers/+page.svelte` — apply the same kicker+counter header and grid-row table pattern.
- `src/routes/teacher/+page.svelte`, `src/routes/+page.svelte` (home) — apply the split poster/form (home) and simple-header (teacher home) treatments per the prototype.
- `messages/{en,de,bo}.json` — any new copy the restyle needs (e.g. a poster-panel supporting line not currently rendered anywhere) needs new keys following the `<route>_<element>_<purpose>` convention; `bo.json` gets English placeholders per established convention.

## Tasks & Acceptance

**Execution:**
- [x] Retune `src/app.css` tokens (colors, font family, type scale) to the prototype's exact values
- [x] Build the reusable split poster/form layout pattern
- [x] Apply it to home, login, signup, all three Join steps, join/pending
- [x] Build the kicker+counter header pattern and grid-row table pattern; apply to `/requests`, `/admin/classes`, `/admin/teachers`
- [x] Custom checkbox control for Join's consent (and guardian-email) step, and admin/teachers' class-assignment chips
- [x] Preserve guardian-email-verification UI (unverified badge, confirmation-gated Approve) through the `/requests` restyle
- [x] Preserve `[lang='bo']` exemption through every touched screen
- [x] New/changed copy routed through Paraglide in all three locales
- [x] (human-directed addition) Made the previously `display:none`-hidden locale switcher actually visible/usable; changed `project.inlang/settings.json`'s `baseLocale` from `de` to `en`

**Acceptance Criteria:**
- Given any screen this spec touches, when viewed against the decoded prototype reference, then the layout structure (split poster/form vs. single card, header treatment) matches, not just the color palette.
- Given the Tibetan locale, when any touched screen renders, then headings still use `--font-tibetan` without forced uppercase, exactly as before this restyle.
- Given the guardian-email verification behavior built in the prior session (unverified badge, approve blocked until confirmed), when `/requests` is restyled, then that behavior and its visual signal both still work — this restyle must not silently regress it.
- Given no functional/route/i18n-key changes were intended, when `npm run check`/`npx eslint src`/`npm run test` run after this restyle, then they pass exactly as before (0 new errors, all tests green).

## Implementation Notes (2026-09-16)

Built as designed above, plus two real bugs surfaced by actually browser-verifying the restyled pages (not just running the test suite, which never exercises either path):

- **`requests/+page.server.ts` (`selectColumns`) was broken for every real visit.** `profiles`↔`classes` now has three FK paths (`classes.created_by`, `profiles.class_id`, the `class_teachers` many-to-many), so PostgREST's embed shorthand `classes ( id, name, code )` returns `PGRST201` ("more than one relationship was found") instead of data — confirmed directly against the local REST API. `rls.spec.ts` never caught this because it asserts against raw table selects, never this route's actual embedded-relation syntax. Fixed with the explicit FK hint PostgREST's own error suggested: `classes!profiles_class_id_fkey ( id, name, code )`.
- **The locale switcher didn't switch.** The Paraglide Vite plugin's default `strategy` (`['cookie', 'globalVariable', 'baseLocale']`) never included `'url'`, so the locale-prefixed links `localizeHref()` already generated (`/de/...`) were never actually honored — this was true before this session too, just unnoticed since the switcher was `display:none`. Added `strategy: ['url', 'cookie', 'baseLocale']` to `vite.config.ts`'s `paraglideVitePlugin()` call: URL takes priority (so an explicit locale link works), cookie persists the choice across plain/unprefixed navigation afterward.
- Human-directed additions beyond the original spec: `project.inlang/settings.json`'s `baseLocale` changed from `de` to `en` (new default for visitors with no locale cookie); the locale switcher itself made visible (was `display:none`) and restyled to match the footer/status-strip pattern; the PWA manifest's stale pre-restyle `theme_color` (`#0b1330`) synced to the new ink token (`#0f172a`), matching the prior restyle's own precedent for fixing this exact drift.

**Verified:** `npm run check` (0 errors), `npx eslint src` (clean), `npm run test` (109/109 passing), and browser-verified live (light color-scheme forced, sandboxed browser defaults to dark) — home, login, signup, join wizard (all 3 steps), `/requests` (signed in as a real local admin account, including the PGRST201 fix), `/admin/classes`; confirmed the locale switcher actually changes rendered language and persists via cookie across navigation, and that a fresh visitor (no cookie) now defaults to English.

## Verification

**Commands:**
- `npm run check` — expected: 0 errors, 0 warnings
- `npx eslint src` — expected: clean
- `npm run test` — expected: all tests pass (this is a markup/CSS-only change; no test behavior should change)

**Manual checks:** Start the dev server and visually compare each touched screen against `ui-restyle-story-1-1-prototype-reference.html` (open it in a browser directly, or re-read its inline styles) at both phone (~390px) and desktop (~1120px) widths, in both light content and — separately — with `lang="bo"` forced, to confirm the Tibetan exemption still holds. Re-verify the guardian-email "unverified" badge and confirmation-gated Approve button on `/requests` still render and function correctly post-restyle.
