---
title: 'Foundation: Tailwind, shadcn-svelte, Sherab theme, CSS isolation'
type: 'chore'
created: '2026-10-18'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-mobile-ux/stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The mobile-first migration (SPEC CAP-5, CAP-7) needs a new component system that can live next to Siemens iX page by page, but iX's global CSS (element reboot on `a`, `body`, headings, scrollbars) and `src/app.css` element rules would leak into new components, and Tailwind's preflight would restyle every iX page.

**Approach:** Add Tailwind CSS v4 (no global preflight), shadcn-svelte and Lucide, with a Sherab theme mapped from today's iX values, and a scoped reset so new components render correctly only inside a `data-ui="new"` root. No user-facing page changes; prove isolation with screenshot baselines and a dev-only preview route.

## Boundaries & Constraints

**Always:** Every existing iX page renders pixel-identical to before. Tailwind utilities beat iX/app.css element rules inside the new root. Theme carries primary `#2563eb`, navy frame `#0f172a`, radius `0.25rem`, the iX system font stack and Atisha for `lang='bo'`. Light theme only (app is light-only). `npm run build` still produces the Cloudflare bundle and PWA.

**Never:** No migrated page, no change to `+layout.svelte` markup or any route's behaviour. No Tailwind preflight at global scope. No edits to `@siemens/ix` CSS or to existing e2e tests. The preview route must not exist in production builds.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| iX page | Any existing route | Identical screenshot to the pre-change baseline | Test fails on any pixel diff above threshold |
| New component in root | `<Button>` inside `data-ui="new"` | Theme primary background, 0.25rem radius, no iX link/heading styles | — |
| New component outside root | `<Button>` without the root | Still styled by utilities (utilities are global); only the reset is scoped | — |
| Tibetan | Preview at `lang='bo'` | Atisha font, label not clipped | — |
| Production | `GET /dev/ui` in a production build | 404 | — |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte:2-3` -- imports `@siemens/ix/.../siemens-ix.css` then `../app.css`; add the Tailwind entry import after them, nothing else in this file.
- `src/app.css` -- unlayered legacy rules (element rules for `h1-h3`, `a`, `table`, `fieldset`, `body`); leave untouched. Its header says DESIGN.md/design-tokens.md are superseded: the live brand is the iX overrides at lines 61-130.
- `node_modules/@siemens/ix/dist/siemens-ix/siemens-ix.css` -- unlayered, no `@layer`; theme values `--theme-default-border-radius: 0.25rem`, `--theme-font-family: Siemens Sans, system-ui, ...` (no Siemens Sans face shipped, so users see system-ui). Checked: no class-name collisions with Tailwind utilities, no `--background/--border/--primary/--radius` variables.
- `vite.config.ts` -- add `@tailwindcss/vite` before `sveltekit()`.
- `src/lib/index.ts` -- empty placeholder; `src/lib/utils.ts` does not exist yet.
- `e2e/fixtures.ts:326` -- `signIn(page, user)` and service-role fixture helpers to reuse for baseline screenshots.
- `playwright.config.ts` -- single Desktop Chrome project, port 5199; screenshots are platform-specific (darwin baselines).

## Tasks & Acceptance

**Execution:**
- [ ] `e2e/ix-visual.e2e.ts` -- FIRST, before any other change: screenshot test for login, teacher dashboard, parent dashboard, admin classes at 375px and 1440px, animations disabled, dynamic text masked; generate baselines on the unchanged code and commit them -- proves "unchanged".
- [ ] `package.json` -- add pinned `tailwindcss`, `@tailwindcss/vite`, `bits-ui`, `clsx`, `tailwind-merge`, `tailwind-variants`, `tw-animate-css`, `@lucide/svelte` -- stack.md.
- [ ] `vite.config.ts` -- register `tailwindcss()` plugin.
- [ ] `src/lib/ui/tailwind.css` -- import Tailwind theme and utilities layers (no preflight) with `important`; shadcn theme variables (`--background`, `--primary`, `--radius`, ...) from the iX values; `@theme inline` mapping; `bo` font rule.
- [ ] `src/lib/ui/reset.css` -- Tailwind preflight scoped under `[data-ui='new']`, unlayered and specific enough to beat iX/app.css element and `a[href]` rules.
- [ ] `components.json`, `src/lib/utils.ts` -- shadcn-svelte config (aliases `$lib/components/ui`, `$lib/utils`) and `cn()` + type helpers.
- [ ] `src/lib/components/ui/button/`, `src/lib/components/ui/card/` -- generated with the shadcn-svelte CLI as the smoke-test components.
- [ ] `src/routes/dev/ui/+page.server.ts`, `+page.svelte` -- `error(404)` unless `dev`; renders Button variants, Card, a heading, a link, a table and a Lucide icon inside `data-ui="new"`, in en and bo.
- [ ] `e2e/ui-foundation.e2e.ts` -- on `/dev/ui`, assert computed styles: button background `rgb(37, 99, 235)`, radius `4px`, heading/link/table not styled by iX or app.css, Tibetan text uses Atisha.

**Acceptance Criteria:**
- Given the baselines committed before the change, when `npx playwright test e2e/ix-visual.e2e.ts` runs after it, then all screenshots match.
- Given the full suite, when `npm run test:e2e` runs, then every existing e2e test passes without modification.
- Given a production build, when the bundle is inspected, then `/dev/ui` is not reachable and the PWA manifest and service worker are still emitted.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

Why `important` instead of layering the legacy CSS: iX and `app.css` are unlayered; Tailwind utilities live in `@layer utilities` and would lose to any unlayered element rule (`a { color }`, `h2 { font-size }`). Moving the legacy CSS into a layer would instead let every page's scoped Svelte styles override `app.css` rules they lose to today, which breaks "pixel-identical". `important` utilities touch only new markup.

```css
@layer theme, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities) important;
```

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: clean local DB.
- `npm test` -- expected: all unit tests pass.
- `npm run check` -- expected: 0 errors.
- `npm run lint` -- expected: clean.
- `npm run build` -- expected: success, PWA files emitted.
- `npm run test:e2e` -- expected: all pass, including `ix-visual` and `ui-foundation`.
