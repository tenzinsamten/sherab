---
title: 'Foundation: Tailwind, shadcn-svelte, Sherab theme, CSS isolation'
type: 'chore'
created: '2026-10-18'
status: 'done'
route: 'dispatch'
baseline_commit: '354d82a233af0f7c74bffcc64dec61ba8bcbb888'
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
- [x] `e2e/ix-visual.e2e.ts` -- FIRST, before any other change: screenshot test for login, teacher dashboard, parent dashboard, admin classes at 375px and 1440px, animations disabled, dynamic text masked; generate baselines on the unchanged code and commit them -- proves "unchanged".
- [x] `package.json` -- add pinned `tailwindcss`, `@tailwindcss/vite`, `bits-ui`, `clsx`, `tailwind-merge`, `tailwind-variants`, `tw-animate-css`, `@lucide/svelte` -- stack.md.
- [x] `vite.config.ts` -- register `tailwindcss()` plugin.
- [x] `src/lib/ui/tailwind.css` -- import Tailwind theme and utilities layers (no preflight) with `important`; shadcn theme variables (`--background`, `--primary`, `--radius`, ...) from the iX values; `@theme inline` mapping; `bo` font rule.
- [x] `src/lib/ui/reset.css` -- Tailwind preflight scoped under `[data-ui='new']`, unlayered and specific enough to beat iX/app.css element and `a[href]` rules.
- [x] `components.json`, `src/lib/utils.ts` -- shadcn-svelte config (aliases `$lib/components/ui`, `$lib/utils`) and `cn()` + type helpers.
- [x] `src/lib/components/ui/button/`, `src/lib/components/ui/card/` -- generated with the shadcn-svelte CLI as the smoke-test components.
- [x] `src/routes/dev/ui/+page.server.ts`, `+page.svelte` -- `error(404)` unless `dev`; renders Button variants, Card, a heading, a link, a table and a Lucide icon inside `data-ui="new"`, in en and bo.
- [x] `e2e/ui-foundation.e2e.ts` -- on `/dev/ui`, assert computed styles: button background `rgb(37, 99, 235)`, radius `4px`, heading/link/table not styled by iX or app.css, Tibetan text uses Atisha.

**Acceptance Criteria:**
- Given the baselines committed before the change, when `npx playwright test e2e/ix-visual.e2e.ts` runs after it, then all screenshots match.
- Given the full suite, when `npm run test:e2e` runs, then every existing e2e test passes without modification.
- Given a production build, when the bundle is inspected, then `/dev/ui` is not reachable and the PWA manifest and service worker are still emitted.

## Implementation Notes

- Baselines committed first (6ff3f41) on the unchanged code. Viewport-only screenshots; masked: header avatar, admin class counter, the admin "all classes" card (depends on DB contents) and the schedule date inputs (default to today).
- Tailwind sources are restricted: `utilities.css ... important source(none)` plus `@source` for `src/lib/components/ui` and `src/routes/dev/ui`. Auto-detection would pick up legacy class names that are also utilities (`block` is used on iX pages) and emit them as `!important`. Each migrated page/folder must add its own `@source` line in `src/lib/ui/tailwind.css`.
- Reset specificity: every reset selector carries `:not(#__)` (id weight) to beat iX's `a[href]:not(.disabled):not(:disabled):hover` (0,4,1) and app.css element rules regardless of order. Consequence: inside `data-ui="new"`, scoped Svelte `<style>` rules lose to the reset; new code styles with utilities.
- Radius: `--radius-sm` = radius - 2px, `--radius-md/lg/xl` = `--radius` (0.25rem), so shadcn's `rounded-lg` button and `rounded-xl` card both get 4px.
- Packages installed with Node 22.23.2 (.nvmrc; 22.16 fails engine-strict on @siemens/ix-icons) and npm 11 (npm 10.9 crashes with "Cannot read properties of null (reading 'edgesOut')"). npm 11 dropped two optional peer entries from the lockfile (`@cloudflare/workers-types`, `yaml`); no other existing version changed.
- `/dev/ui` is compiled into the server bundle but its load throws 404 whenever `dev` is false.
- Matrix audit: the "Production → 404" row had only a manual preview check; added `src/routes/dev/ui/page.server.spec.ts` (load with `dev` false throws 404, with `dev` true returns `{}`), 2 passed.
- Full-suite verification found `ix-visual` order-dependent: other test files leave classes and pending requests in the shared DB, which widened the masked class counter, lengthened the masked class list and added the admin Requests pill. Masks take the size of what they cover, so `ix-visual` now normalizes these before shooting (counter → one digit, admin class list emptied at a fixed 8rem, menu notification pills removed). The changed `admin-classes-desktop` baseline was regenerated on the pre-story commit 354d82a in a temporary worktree (no Tailwind import there), so the proof still compares against unchanged code; the other 7 baselines are the originals from 6ff3f41. Passes with a leftover-filled DB.
- Pre-existing failure, not caused by this story: `e2e/teacher.e2e.ts:1235` (Reset PIN, student not sent back to /login) fails identically on the baseline commit in a clean worktree.
- Pre-existing, unchanged: `npm run lint` prettier warnings on non-source files (.claude, _bmad, _bmad-output, ...); `wrangler pages dev` answers 404 for /manifest.webmanifest and /sw.js on the baseline too (files are emitted).

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter BH, edge-case-hunter EH, verification-gap VG):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| BH2 | `dark:` variants fire under OS dark mode | medium | Tailwind v4 default `dark` is `prefers-color-scheme`; `button.svelte` ships `dark:bg-input/30` etc.; breaks the Always "light theme only" on dark-mode phones | patch |
| EH10 | `[data-ui='new'] [lang]` resets font/leading on every element with `lang`, overriding a parent's utilities | low | Selector matches `lang="en"` inside an English root too, setting explicit font-family/line-height instead of inheriting | patch |
| VG1 | Nested-`lang` font rules untested | low | `/dev/ui` sets `lang` on roots only; deleting either nested selector leaves `ui-foundation` green | patch |
| BH10/EH1/EH2 | `renderedFonts` builds selector from possibly-undefined values; CDP session leaks on throw | low | `scope`/`testId` unchecked; `detach()` not in `finally` | patch |
| EH11 | Scoped reset omits preflight's datetime-field padding and `:-moz-ui-invalid` rules | low | Compared against `tailwindcss/preflight.css`; direct copy fixes it | patch |
| BH4/EH5 | Darwin-only baselines, no platform guard | low | No CI exists; one-line `test.skip` keeps other platforms from writing unverified baselines | patch |
| BH7/EH9 | Scoped reset hits iX elements placed inside a `data-ui="new"` root | maybe-false (medium if true) | Not reachable in this diff (no iX inside a root); story 2's shell wraps iX pages and could trigger it | defer |
| BH8 | "Style new code with utilities" enforced only by a CSS comment | low | Real for future authors; fix belongs in agent-context docs | defer |
| BH1 | Global `!important` utilities hit legacy markup using `block`/`sr-only` | low | VG verified only these two legacy names match; both already have identical effect (`app.css` `.sr-only`, `ix-button.block` already `display:block`) | reject |
| BH3 | Baselines miss `bo`, `/`, calendar, student pages | low | All new rules are scoped to `[data-ui='new']`; only `:root` custom properties are global and no consumer reads them | reject |
| BH5/EH3 | "Not clipped" check can't detect glyph-ink overflow | low | Button has no `overflow` clip, so ink is never cut; check is weak but the bad outcome does not occur | reject |
| BH9/EH4 | Fixed 500 ms sleep; fragile mask selector | low / false | Mask: both `<section>`s on `admin/classes` carry `.card`, so `:last-of-type` matches; sleep has not flaked, a layout-stable wait adds complexity | reject |
| BH6 | Generic `:root` variable names may collide | false | grep: no `var(--background|border|radius|primary|...)` in iX CSS, `app.css`, event-calendar or driver.js | reject |
| BH11 | `bits-ui` unused; exact pinning breaks `^` convention; `hooks` alias missing | false / low | Spec task requires `bits-ui` and pinned versions; `hooks` alias is shadcn's default and unused | reject |
| BH12 | Preview: `#top` missing, no disabled variants, `Card.Title` is a `div` | low | Dev-only page, never shipped | reject |
| BH13 | Lint suppression for `href` in `button.svelte` | low | No base path configured (`svelte.config.js`); vendor code | reject |
| EH6 | Parent approval update may match 0 rows | false | `handle_new_user()` inserts the `parents` row (migration 0024); committed baseline shows the parent dashboard | reject |
| EH7 | Disabled link-button still runs `onclick` | low | Upstream shadcn behaviour, rare; fix adds a branch | reject |
| EH8 | `href=""` renders a `<button>` | low | Upstream behaviour; empty href is not a caller pattern | reject |

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
