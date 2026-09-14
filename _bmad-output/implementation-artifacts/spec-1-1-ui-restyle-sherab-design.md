---
title: 'Restyle Story 1-1 screens to the new Sherab design system'
type: 'refactor'
created: '2026-09-14'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tib-class-2026-09-14/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-tib-class-2026-09-14/EXPERIENCE.md'
  - '{project-root}/_bmad-output/specs/spec-class-tracker/stories/1-1-teacher-student-account-management.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1-1's already-implemented screens (sign-in, admin bootstrap, admin classes, admin teachers, teacher home) use an old design system (`src/app.css`: blue `#2563eb`/amber `#f59e0b` on light backgrounds, rounded `12px` corners, soft shadows, `Baloo 2`/`Source Sans 3`). The user replaced the product's visual direction with a bold, high-contrast, editorial/brutalist system, now finalized in `DESIGN.md`/`EXPERIENCE.md`, and wants the already-built screens updated to match it — no functional or scope changes to Story 1-1's frozen acceptance criteria.

**Approach:** Update `src/app.css`'s design tokens and shared classes (`.card`, `.btn`, `.btn-outline`, `.field`, `.banner-*`, `table`) to the new palette (navy `{colors.ink-primary}`/`{colors.surface-inverse}`, signal blue `{colors.primary}`, attention amber `{colors.attention}`, error red `{colors.error}`), zero border-radius, no shadows, and the new type system (heavy all-caps display for headings, small tracked uppercase captions for section labels/form labels, plain body text) — since every route already consumes these tokens/classes rather than hardcoded literals (confirmed: no hardcoded colors/fonts in `src/routes` or `src/lib`), this is primarily a token-level change. Then make the small per-route markup additions the new system requires that don't exist yet: numbered section labels (e.g. "01 / ACCESS"), the dark inverse-surface top nav with a solid-fill active tab (rebuilt in the shared `src/routes/+layout.svelte`), and uppercase form-label captions. Preserve the existing `--font-tibetan` (Noto Serif Tibetan) path for the `bo` locale entirely as-is — per `DESIGN.md`'s own open question, do not force the new heavy all-caps Latin display treatment onto Tibetan text; Tibetan headings render in `--font-tibetan` at a large bold weight without `text-transform: uppercase`.

</frozen-after-approval>

## Implementation Notes

**Token-level restyle (`src/app.css`).** Repointed `:root` custom properties to the new palette: `--color-primary: #2f5fe0` (signal blue), `--color-secondary: #f2a71b` (renamed usage from "amber warning" to "attention" per DESIGN.md's broader semantic), `--color-destructive: #d92d20` (error red), new `--color-surface-inverse`/`--color-on-surface-inverse` (`#0b1330`/`#ffffff`) for the dark nav/table-header surfaces. Zeroed `--radius-clay-quiet` and `--shadow-clay-quiet` (kept the variable names to avoid hunting every consumer — same effect as removing them). Swapped the display font from `Baloo 2` to `Archivo Black` (free, Google-hosted, matches DESIGN.md's "heavy grotesk" assumption) and made `h1`/`h2`/`h3` uppercase/tight-tracked/900-weight by default. Added `.section-label` utility class for the numbered wayfinding captions.

**Tibetan exemption.** Added `[lang='bo'] h1/h2/h3` override that keeps `--font-tibetan`, drops the uppercase transform, and uses a larger line-height — per DESIGN.md's own open question, the all-caps Latin treatment is not forced onto Tibetan script. This is a reasonable default, not a full resolution of that open question (no native-speaker review of the actual Tibetan copy itself, which was already flagged as pending in Story 1-1's own notes).

**Nav rebuild (`src/routes/+layout.svelte`).** Replaced the light card-colored nav with the dark `surface-inverse` bar; added a `navLinkStyle()` helper that compares `page.url.pathname` to render the active tab as a solid blue block (matches the prototype's active-tab treatment). Initially tried a `{#snippet}` with a `Pathname`-typed parameter for this, but `svelte-check` rejected it (the typed-routes plugin narrows each `resolve()` call to its own literal type, which a shared snippet parameter widens back to the full `Pathname` union) — switched to a plain `string`-typed helper function instead, which resolved cleanly.

**Per-route markup additions.** Added one `.section-label` line to `(auth)/login` ("01 / ACCESS"), `(auth)/signup` ("ONE-TIME STEP", colored via `--color-secondary` instead of a full-bleed banner block — a lighter-touch stand-in for the prototype's full amber banner, chosen to avoid restructuring the card layout for a oneshot-scoped change), `admin/classes` ("02 / CLASSES"), `admin/teachers` ("03 / TEACHERS"), and `teacher` ("02 / MY CLASSES"). No other markup changes — forms, tables, and cards keep their existing structure and inherit the new look through the shared classes/tokens.

**Bug caught during self-verification.** An initial `.field input:invalid:not(:placeholder-shown)` rule (meant to redden an invalid field automatically) fired on page load for any empty `required` input lacking a `placeholder` attribute (e.g. the class-name field), since `:placeholder-shown` never matches without one. Removed the automatic `:invalid` selector; kept only the explicit `[aria-invalid='true']` hook for when server/client validation actually sets it (none currently do — this is inert until that's wired up, matching the fact that no route in this story sets `aria-invalid` today).

**Verification performed:** `npm run check` (0 errors), `npx eslint src` (clean), `npm run test` (19/19 passed, live Supabase). Started the dev server and visually verified in a real browser (light color-scheme forced, since the sandboxed browser defaulted to dark): home/welcome screen, `/admin/classes` (including the create-class form and table), `/admin/teachers` (including the class-assignment checkboxes and table), `/login` (default and a real wrong-credentials error state), and `/signup` (bootstrap notice). **Not independently browser-verified:** `/teacher` (no teacher credentials were available in this session to sign in and check it live) — it shares the identical `.card`/`.section-label`/table CSS already confirmed working elsewhere, so this is a low-risk gap, but it is a gap.

**Scope line held.** Did not touch: favicon/app icon (still the stock Svelte logo — Story 1-1's own notes already flag icon design as a not-yet-produced UI/UX deliverable, so this restyle leaves it alone rather than inventing one), the home page's own copy ("Signed in."), table responsive/stacking behavior (kept as a plain table at all viewport widths rather than building the prototype's phone-stacked-rows transform, which would be a markup/layout change beyond a token-level restyle), and anything related to student self-registration/approval screens (out of scope — separate deferred story, see `deferred-work.md`).

**Also fixed while in here:** the PWA manifest's `background_color`/`theme_color` in `vite.config.ts` still had the old palette's hex values — updated to match, and recompiled Paraglide's generated `src/lib/paraglide/messages.js` after adding new message keys (it's a generated file `svelte-check` doesn't regenerate on its own; `npx @inlang/paraglide-js compile` was run directly).

## Review Triage Log

Blind Hunter review, N=5 floor (17.44 kB changed → min(floor(sqrt(17.44)+1),10)=5), 10 findings returned:

- **high — patched.** Section-label text ("01 / ACCESS" etc.) was hardcoded English on every page instead of routed through Paraglide, violating ARCHITECTURE-SPINE.md's explicit "UI strings keyed through Paraglide, never inline literals" convention and breaking German/Tibetan localization for a base-locale-`de` app. Added `*_section_label` keys to `messages/{de,en,bo}.json` and swapped every hardcoded string for `m.*_section_label()`.
- **medium — patched.** Signup's section-label used `color: var(--color-secondary)` (amber `#f2a71b`) as text on a white card — independently verified at ≈2.1:1 contrast, well under WCAG AA's 4.5:1 floor for 12px bold text. Removed the color override; the label now uses the same accessible muted-gray style as every other page.
- **medium — patched.** The active nav tab was indicated by background color alone, with no `aria-current` — a real screen-reader regression from the nav rebuild. Added `aria-current="page"` to the active link.
- **medium — patched.** Removing the old `.btn:hover { transform }` (correctly, per DESIGN.md's no-elevation rule) left zero hover feedback anywhere. Added flat, motion-free hover states (`filter: brightness()`/background tint) to `.btn`, `.btn-outline`, and the new `.nav-link` class.
- **low — patched.** `teacher/+page.svelte`'s section label ("02 / MY CLASSES") numerically collided with `admin/classes`' "02" — cosmetic (the two are never shown together) but a one-line fix, so renumbered to "01 / My Classes" (the teacher's own first/only screen).
- **low — patched.** Section-label-to-heading vertical rhythm could differ between pages that explicitly zeroed the heading's top margin (login/signup) and pages that didn't (admin/classes, admin/teachers, teacher) — margin collapsing narrows this but doesn't guarantee identical spacing across browsers. Added a single global `.section-label + h1 { margin-top: 0; }` rule instead of per-page inline overrides.
- **low — patched.** The nav's `border-bottom` used the theme-dependent `--color-border` token against the theme-independent `--color-surface-inverse` background, going near-invisible in dark mode. Switched to a fixed `rgba(255,255,255,0.25)` hairline (matches DESIGN.md's `border-hairline-inverse` token) so it reads consistently in both themes.
- **false.** "Tibetan `[lang='bo']` styling is unreachable — no route sets `lang='bo'`." Disproved: the `lang` attribute is set at the document-root level by Paraglide (outside the 7 files given to the reviewer, not per-route), and this exact selector convention already existed pre-restyle — Story 1-1's own Implementation Notes confirm "locale switches correctly (routing, `lang` attribute, `--font-tibetan` CSS) end-to-end." The reviewer's blind spot was not having `src/app.html` in scope.
- **defer.** Google Fonts `@import` is render-blocking; pre-existing pattern from before this restyle, not caused by it. Logged in `deferred-work.md`.
- **defer.** Repeated inline `style` fragments (muted text, checkbox "chips") could be promoted to utility classes; pre-existing code style from Story 1-1's original implementation, not caused by this restyle. Logged in `deferred-work.md`.

## Verification

**Commands:**
- `npm run check` — 0 errors, 0 warnings (947 files, after Paraglide recompile).
- `npx eslint src` — clean, no output.
- `npm run test` — 19/19 passed (live local Supabase).

**Manual checks:** Started the dev server and visually verified in a real browser (light color-scheme forced — the sandbox's browser defaulted to dark) after both the initial restyle and the post-review patches: home/welcome, `/admin/classes` (form + table), `/admin/teachers` (form, checkbox chips, table), `/login` (default state and a real wrong-credentials error banner), `/signup` (bootstrap notice, corrected label contrast). `/teacher` was not independently browser-verified (no teacher credentials available this session) but shares identical CSS/markup patterns already confirmed elsewhere.

