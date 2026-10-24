---
title: 'Design documents describe the app as built (#130)'
type: 'chore'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `design-tokens.md` and `brand-guide.md` describe Claymorphism everywhere, Baloo 2 / Noto Serif Tibetan, 48px targets, a dark theme and #DC2626; the UX `DESIGN.md` ("final") says 0 radius, no shadows and all-caps display type. The app is an iX-derived light theme with a 0.25rem radius, the system font plus Atisha, 44px targets and clay only on kid-facing celebration surfaces.

**Approach:** Rewrite `_bmad-output/design-tokens.md` from the code (`src/lib/ui/tailwind.css`, `src/lib/ui/classes.ts`, `src/lib/ui/contrast.spec.ts`): colour tokens with their roles and checked contrast, the strong tokens (#119, #129), the navy frame, the celebration tokens, typography (Atisha + system stack, Tibetan line height 2, #114), radius, 44px targets (`ui.touch`), focus outline (#122), light theme only (dark deferred, #13), and the Tailwind `@source` rule. Add a "superseded" banner to `brand-guide.md`, `component-specs.md` and the UX `DESIGN.md` that points to it and says what still holds. No code changes.

**Decisions (2026-10-24):** The user chose 44px (as built) as the target, and banners rather than rewrites for the older documents. On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `_bmad-output/design-tokens.md` rewritten from the code; banners on `brand-guide.md`, `component-specs.md` (frontmatter `status: superseded-for-visuals`) and the UX `DESIGN.md` (`status: superseded`). Two code comments that pointed at the old docs' sections now point at the new one (`tailwind.css`, `classes.ts`). Every contrast figure recomputed by the reviewer.

## Review Triage Log

All findings were documentation accuracy, each a direct correction, patched: the calendar chip palette and toast colours as exceptions to "tokens only"; which ratios are tested; where #124's rule is tested; the focus rule's exceptions; the side gutter is the signed-in shell's; `ui.touch` in full, NativeSelect `sm`; Atisha's `@font-face` (`size-adjust: 136%`, unicode range, one weight) and the old-UI Tibetan rules; the line-height caveats (other leadings, `text-5xl`+, Tailwind 4.3.3); the fixed font sizes; motion and reduced motion; ratios on `--muted` (red 4.41, green 4.12 — below 4.5); invalid, disabled and dialog states; what `tailwind-sources.spec.ts` covers; rem breakpoints; frontmatter sources; stale comments; consistent superseded markers; EXPERIENCE.md's visual notes named as superseded in the DESIGN banner. Rejected: `confirm.spec.ts` uses "Reject" with `destructive` as a generic example string (a unit test of the dialog, not the requests page).
