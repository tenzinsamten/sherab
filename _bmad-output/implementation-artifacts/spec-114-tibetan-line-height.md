---
title: 'Tibetan line height survives Tailwind size and leading utilities (#114)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tibetan text is meant to have `line-height: 2` (#78, #85; `src/lib/ui/tailwind.css` Tibetan rule), but every Tailwind size utility (`text-xs` … `text-3xl`) sets its own Latin line height, `!important`, so about 150 elements under a Tibetan interface get leading of roughly 1.25–1.5 on Atisha drawn at 136%; wrapped lines nearly touch (`static/help/bo/teacher-5.png`). The `leading-tight` / `leading-snug` utilities (`ui.heading`, `ui.cardTitle`, 25 other uses) cramp Tibetan headings the same way (deferred-work.md, story 6 entry).

**Approach:** Wherever the language is Tibetan, redefine the theme variables those utilities read (`--text-*--line-height`, `--leading-tight`, `--leading-snug`, `--leading-relaxed`) to the Tibetan line height 2, and restore Tailwind's values on an element in another language nested inside Tibetan, mirroring the existing Tibetan / nested-language rule pair. Decided (assistant, following the one Tibetan line height of #78/#85 and app.css's `[lang='bo'] h1–h3 { line-height: 2 }`): every size and named leading resolves to 2 in Tibetan; English and German are unchanged.

</frozen-after-approval>

## Implementation Notes

- Mechanism (Tailwind 4.3.3 compiled CSS): `.text-sm { line-height: var(--tw-leading, var(--text-sm--line-height)) !important }`; `.leading-tight { --tw-leading: var(--leading-tight); line-height: var(--leading-tight) }`; `.text-sm/relaxed` reads `--leading-relaxed`. `--tw-leading` is registered `inherits: false`, so overriding it on the root would not reach children; the theme variables are ordinary inherited custom properties, so setting them on the Tibetan root (and on `[lang='bo']` elements) covers every descendant.
- Selectors: reuse the two selector lists of the existing Tibetan rule pair in `src/lib/ui/tailwind.css` (Tibetan → 2; nested other language → Tailwind's own values, copied from `tailwindcss/theme.css` with a comment naming the source).
- Test: extend `/dev/ui` (`src/routes/dev/ui/+page.svelte`) with a `text-sm` paragraph and check in `e2e/ui-foundation.e2e.ts` that under `preview-bo` it and a `leading-tight` heading compute to 2× font size, and under `preview-en` keep Tailwind's ratio.
- `classes.ts` keeps `leading-tight` / `leading-snug` for Latin text; no per-page edits.
- Closes the deferred-work.md entry "New-UI page headings (`ui.heading` and AuthCard's h1) use `leading-tight`…". The `bo` help screenshots will change and can be regenerated with `npm run help:screenshots`.
- Built (2026-10-24): the theme variables are declared in the two existing Tibetan / other-language rules in `src/lib/ui/tailwind.css` (no separate rule pair), so the selectors cannot drift; English and German roots get Tailwind's own values, the same as the theme. `/dev/ui` has `sized-text` (`text-sm`), `tight-heading` (`text-lg leading-tight`), `snug-text` (`text-base leading-snug`) and `nested-sized` (English in Tibetan, Tibetan in English); `e2e/ui-foundation.e2e.ts` checks all of them. The test fails on the old CSS (`text-sm` ratio 1.43, expected 2).
- Verified: prettier and eslint clean; after a reset, `npm test` 1667/1667 (third run; the first two each had one different, unrelated `rls.spec.ts` failure, see Review Triage Log), `npm run check` 0 errors, `npm run build` exit 0; after another reset, ui-foundation, toast, syllabus-sections, shell and breadcrumbs browser tests 46/46.
- Decided by the assistant, not the user: every leading in Tibetan is 2, so a wrapped `text-2xl` heading gets a 48px line. To confirm with the user on a phone.

## Review Triage Log

- Blind Hunter 1 (selector lists repeated in a second rule pair): low, real; patched by moving the variables into the existing two rules.
- Blind Hunter 2 (copied Latin values brittle, version not named): low, real; patched: the comment names Tailwind 4.3.3 and says to update them with Tailwind; the e2e test compares the restored and English-root ratios for `text-sm`, `leading-tight` and `leading-snug`.
- Blind Hunter 3 (comment says "every one", other leadings not covered): low, real; patched: the comment lists what is covered and what is not (`leading-none/normal/loose`, spacing and arbitrary leadings, none used in `src`).
- Blind Hunter 4 (`leading-snug`, Tibetan-in-English with a size utility, portal not tested): low, real for the first two; patched (`snug-text`, `nested-sized` in the English root). Portal: false; `#ui-portal` is a `data-ui="new"` root that takes `lang` from `<html>`, so it matches the root selector like any page root.
- Blind Hunter 5 (fixed-height controls overflow with the taller line): false for clipping; no caller uses `size="xs"`, the `icon-sm` close buttons are overridden to `size-11` and hold only an icon, and badges use `min-h-5`, so they grow (the intended fix) instead of clipping.
- Blind Hunter 6 (deferred-work entry not closed): false as a defect; the workflow does not edit old deferred entries; this spec records that it closes it.
- Blind Hunter 7 (issue log still "logged, not built"): low, real; patched with a log entry for #114.
- Blind Hunter 8 (spec status, verification not recorded, help screenshots stale): low, real; status and verification recorded here; screenshots left for `npm run help:screenshots` when the user regenerates them (stale help screenshots are already logged in deferred-work.md).
- Blind Hunter 9 (one leading for every size in Tibetan is an assistant decision): maybe-false, low; recorded above for the user's check on a phone; would be settled by the user's look at wrapped Tibetan headings.
- Blind Hunter 10 (test comment overstates what is checked): low, real; patched (comment names the three utilities).
- Gate (not a reviewer finding): `rls.spec.ts` failed once on a duplicate class day (`#105 … CD002`, random far-future date) and once on a 5-second timeout (`7-5 sick leave decisions`), each on a fresh reset; pre-existing flakiness in database tests, unrelated to CSS; deferred.
