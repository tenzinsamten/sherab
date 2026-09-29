---
title: 'New Sherab logo (prayer flags + ཤེས་རབ་) in the toolbar, sign-in pages and favicon'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '78ec0b061e766fb4a61ae6db9c897c9b17b64c04'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app still uses the old blue seal (`logo-seal-blue.png`) on the sign-in pages and old favicons, and the toolbar shows only the text "Sherab". The user has a new logo: the Tibetan wordmark ཤེས་རབ་ under a string of prayer flags, in four SVG variants (blue box, reverse, blue transparent, white transparent) plus PNG exports, at `/Users/tenzinsamten/Downloads/sherab-logo-final/` (readable with the Read tool; the shell cannot open ~/Downloads).

**Approach:** Copy the SVGs the app needs into `src/lib/assets/`, show the logo in the toolbar (iX `logo` slot of `ix-application-header`), replace the seal on the sign-in pages (AuthCard), and regenerate the favicon / apple-touch icon from the new logo.

**Decisions (user, 2026-09-29):**
- Toolbar: **logo only** on screens ≥ 48em (white-transparent variant, no "Sherab" name text); below 48em, where iX hides the logo slot, the "Sherab" name text stays. On desktop the logo itself is the link home; on phones the name stays the link (`headerHomeLink`).
- Favicon: an **SVG favicon** — the logo on a square #2563EB tile (the blue-box look) — plus PNG fallbacks in the same look (`favicon-32.png`, `favicon-512.png`, 180×180 `apple-touch-icon.png`).

## Boundaries & Constraints

**Always:** SVG used as-is (no redrawing); the logo keeps a text alternative (`alt` / `aria-label` "Sherab – ཤེས་རབ་"). The header name stays a link home (`headerHomeLink`). Header height unchanged; logo sized to fit it. Works in light and dark theme (the header is always dark navy `--sherab-frame`).

**Never:** No change to header colours, menu or avatar. No new runtime dependency (image conversion is a one-off; commit the generated PNGs). Don't edit `_bmad-output/manual-verification-issues.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop header | signed in, ≥ 48em wide | new logo at the left of the toolbar | N/A |
| Desktop header | ≥ 48em | logo only, no name text; clicking the logo goes home | N/A |
| Phone header | < 48em (iX hides the logo slot) | "Sherab" name text, still a link home | N/A |
| Sign-in pages | /login, /register, /join, /forgot-password, /reset-password | new logo above the card title instead of the seal | N/A |
| Browser tab / home screen | any page | new favicon and apple-touch icon | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte:160-161` -- favicon + apple-touch-icon links; `:188` `<ix-application-header name="Sherab" use:headerHomeLink={homeHref}>` -- add a `slot="logo"` link (`<a href={homeHref}>` wrapping the white logo `<img>`) (iX 5.2.1 slot `logo`; hidden below 48em per `src/lib/ix.ts:70-74`).
- `src/lib/ix.ts:70-110` -- `headerHomeLink` makes the `.name` text a link; keep it working for phones; hide the `.name` text at ≥ 48em (e.g. an extra rule in the adopted stylesheet: `@media (min-width: 48em) { .name { display: none } }` — verify iX's breakpoint for the logo slot and match it).
- `src/app.css:47-60` -- header theme vars (`--sherab-frame` #0f172a); add logo sizing (height ≈ 2rem) near the other `ix-application-header` rules (~:254).
- `src/lib/components/AuthCard.svelte:4,17` -- `logoSeal` 72×72 → new logo (blue-transparent), ≈ 180px wide, height auto; `src/app.css:450` `.auth-card-header img`.
- `src/lib/assets/logo-seal-blue.png` -- delete once unused (only AuthCard imports it).
- `static/favicon-32.png`, `static/favicon-512.png`, `static/apple-touch-icon.png` (180×180) -- regenerate from the new logo; macOS `sips` is available (e.g. resize the @4x PNG, then `--padToHeightWidth` with the chosen background).
- `messages/*.json` `nav_seal_aria_label` -- reuse or rename for the logo alt text.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/assets/sherab-logo-white.svg`, `src/lib/assets/sherab-logo-blue.svg` -- copied from the white-transparent and blue-transparent SVGs.
- [x] `src/routes/+layout.svelte` + `src/app.css` -- logo in the header `logo` slot, sized to the header; name text hidden at ≥ 48em, logo links home; favicon links: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` then the PNG fallback, and the apple-touch icon.
- [x] `src/lib/components/AuthCard.svelte` -- new logo instead of the seal; remove `logo-seal-blue.png`.
- [x] `static/favicon.svg` (logo on a square #2563EB tile, rounded corners like the blue-box variant), `static/favicon-32.png`, `static/favicon-512.png`, `static/apple-touch-icon.png` (180×180) -- same look; PNGs generated with `sips` from the @4x blue PNG padded onto a blue square, committed.
- [x] `e2e/` -- extend an existing header/auth test: the header contains the logo link/image with its alt text and navigates home; /login shows the new logo.

**Acceptance Criteria:**
- Given a signed-in user on a desktop screen, when any page loads, then the new logo shows in the toolbar without the name text and clicking it goes home; given a phone-width screen, the "Sherab" name shows and still goes home.
- Given the /login page, when it loads, then the new logo shows above the title and the old seal file is no longer referenced anywhere.

## Implementation Notes

- iX hides the logo slot with `@media only screen and (max-width: 48em)`; the name is hidden with the exact complement `@media not all and (max-width: 48em)` (adopted stylesheet in `headerHomeLink`), so at exactly 48em one of the two always shows.
- Favicon PNGs were rendered from `static/favicon.svg` with `sharp` (already in node_modules, one-off `node -e`, no new dependency) instead of `sips`: the only blue @4x PNG (reverse) has transparent rounded corners that would leave notches when padded, and there is no white-transparent PNG export. The apple-touch icon is a full (unrounded) blue square, since iOS applies its own mask.
- Message key `nav_seal_aria_label` renamed to `nav_logo_alt` = "Sherab – ཤེས་རབ་" in all locales.

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence | Route |
|---|-----------------|---------|----------|-------|
| 0 | "Sherab" still visible next to the logo on desktop (user, screenshots) | high | adopted `.name` rule lost to iX's `:host .left-side .name`; the e2e `toBeHidden()` did not see the shadow-DOM element | patch (selector + e2e reads computed display) |
| 1 | Signed-out header loses name and home link at ≥ 48em (vgap, blind, edge) | high | same action on the public header (+layout.svelte:267), which had no logo slot | patch (logo on public header; hide name only when `.logo:not(.hide-logo)`; signed-out e2e) |
| 2 | Name flashes before the sheet is adopted (edge) | low | brief, desktop only; fix adds early-adoption machinery | reject |
| 3 | `.name` lookup failure skips the hide (edge) | false | iX always renders `.name` (application-header.js render) | reject |
| 4 | 48em boundary untested (blind) | low | complement media query; covered at 1280 and 390 | reject |
| 5 | Header test lives in role-switcher.e2e.ts (blind) | low | organisation only | reject |
| 6 | Logo link has no visible focus style (blind) | low | default ring on navy header; one CSS rule | patch |
| 7 | Link name is the brand, not "home"; no `lang="bo"` (blind) | low | the phone text link is also just "Sherab" | reject |
| 8 | `nav_logo_alt` identical in all locales (blind) | low | brand name, intentionally untranslated | reject |
| 9 | Flags 1 and 6 vanish at favicon size (blind) | low | user chose the blue-tile look; details are cosmetic at 32px | reject |
| 10 | SVGs not optimised (~21 kB each) (blind) | low | spec: SVGs used as-is | reject |
| 11 | `favicon-512.png` unreferenced (blind) | low | pre-existing (no manifest before either) | reject |
| 12 | Favicon link order (blind) | low | SVG-capable browsers use the SVG; PNG is the fallback | reject |
| 13 | apple-touch-icon has no `sizes` (blind) | low | optional attribute | reject |

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npx playwright test e2e/role-switcher.e2e.ts e2e/forms.e2e.ts` (+ the extended test) -- expected: pass

**Manual checks:**
- Toolbar logo on desktop and phone width; favicon in the browser tab.
