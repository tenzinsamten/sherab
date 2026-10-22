---
title: 'Atisha for Tibetan text in any interface language'
type: 'bugfix'
created: '2026-10-22'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tibetan text without its own `lang="bo"` renders in the system font instead of Atisha. This happens in the en and de interfaces, for example a Tibetan class or team name under the English name, or Tibetan text in a toast. #78 gave Tibetan characters Atisha in every interface language through a `Siemens Sans` alias. The new UI's sans stack (`--sherab-font-sans`, `src/lib/ui/tailwind.css:117`) never named that family, so pages migrated in stories 1–9 lost it, and story 10 removed the alias. It was deferred from mobile-first story 10.

**Approach:** Put `'Atisha'` first in `--sherab-font-sans`. Its `@font-face` `unicode-range` (U+0F00–0FFF, `src/app.css`) limits it to Tibetan characters, so Latin text and digits keep the system stack, and the face is only downloaded on pages that show Tibetan. Lock this in with an e2e check on the `/dev/ui` preview: Tibetan text in the English root without `lang` is drawn in Atisha, and Latin text is not.

</frozen-after-approval>

## Implementation Notes

- `src/lib/ui/tailwind.css`: `'Atisha'` leads `--sherab-font-sans`. `--sherab-font-bo` is now the same stack (`var(--sherab-font-sans)`), kept as its own token because the `bo` rules pair it with line height 2. The comment on the nested-language rules was updated: only the line height differs now.
- `src/routes/dev/ui/+page.svelte`: added an untagged Tibetan `<p data-testid="untagged-bo">` to the English preview root.
- Surprise: with Atisha first in every stack, the computed `font-family` no longer tells Tibetan from Latin text. The positive `/Atisha/` assertions in 5 e2e files became vacuous, and 3 negative ones failed. User decision (2026-10-22): move `renderedFonts` (CDP `CSS.getPlatformFontsForNode`) from `ui-foundation.e2e.ts` to `e2e/fixtures.ts`, working for any locator (temporary `data-font-probe` attribute, waits for `document.fonts.ready`). The assertions in `ui-foundation`, `teacher` (#73/#74), `forms`, `syllabus-sections` and `toast` now check the font actually drawn. The helper only counts the element's own text, so it points at the element holding the text (e.g. `.rich-text p strong`). The syllabus test's "Tibetan interface around it" check now asserts line height 2 on the page root, because the page `h1` has its own `leading-*`.
- Verification (2026-10-22), after `npm run supabase:reset`: `npm test` exit 0 (1590/1590); `npm run check` 0/0; `npm run build` exit 0. e2e `ui-foundation`, `toast`, `forms`, `syllabus-sections`, `teacher` (Reset PIN #88 excluded; it fails on the baseline too) passed 41/41.

## Review Triage Log

- Positive `/Atisha/` font-family assertions vacuous (5 files): medium. Every stack starts with Atisha. Fixed with the shared `renderedFonts` helper (user decision).
- Replacement line-height checks don't test the font: medium, same root cause as above. Replaced with `renderedFonts`.
- Line-height lambda duplicated in two tests: low. Removed by the fix above.
- Untagged Tibetan may clip at 1.36x in 1.5-line rows: maybe-false (medium if true). Deferred with how to settle it.
- `tailwind.css` nested-language comment stale: low, direct comment fix. Patched.
- Legacy `--font-tibetan: 'Atisha', serif` in `app.css`: low. Predates this change; only Latin inside legacy `[lang='bo']` outside new roots falls to serif. Rejected.
- Monospace stacks (`code`, `.credential`) lack Atisha: low. They hold Latin usernames, PINs and codes; rarely met. Rejected.
- German interface untested: low. The stack does not depend on the interface language. Rejected.
- "Only downloaded on Tibetan pages" claim untested: low. `unicode-range` is long-standing (#77). A network-assertion test adds setup for little value. Rejected.
- Spec incomplete (no AC or verification sections, stale line reference): false. The oneshot template omits those sections, and the line reference sits in the frozen intent.
- Untagged Tibetan has no `lang` for screen readers: medium. Predates this change. Deferred.

