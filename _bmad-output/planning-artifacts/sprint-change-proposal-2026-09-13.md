---
id: SPRINT-CHANGE-sherab-rename
date: 2026-09-13
trigger: Product naming decision — app named "Sherab"
mode: Batch
scope: Minor
---

# Sprint Change Proposal — Propagate "Sherab" App Name

## 1. Issue Summary

During UI/UX design work this session, the product was named **Sherab** (ཤེས་རབ་, "wisdom") — chosen over the alternative "Sheja" for its warmth, recognizability, and fit with the streak/badge gamification narrative. This decision is recorded in `_bmad-output/brand-guide.md`, but every other planning artifact still carries the working title "Munich Tibetan Sunday School — Class Tracker" (or "Class Tracker"). A repo-wide search found the old name in 9 files.

This is a naming/branding change only — no capability, requirement, or architectural decision changes.

## 2. Impact Analysis

- **Epic/Story Impact:** None. `_bmad-output/specs/spec-class-tracker/stories.yaml` contains no reference to the product name — checked directly, zero matches. No story text requires modification.
- **Artifact Conflicts:**
  - `SPEC.md` — H1 title still reads the old name.
  - `ARCHITECTURE-SPINE.md` — frontmatter `name:`/`scope:` fields and H1 title still reference the old name.
  - `design-tokens.md`, `component-specs.md` — H1 titles still reference the old name (both produced this session, before the naming decision).
- **Technical Impact:** None yet — no source code exists (project is in READY_TO_BUILD, `src/` not yet created), so there's no code-level naming (package name, PWA manifest, etc.) to touch. That will matter the first time `bmad-build` scaffolds the project — noting it here so it isn't missed then.

## 3. Recommended Approach

**Direct Adjustment** (Option 1) — apply the rename directly to the current/canonical artifacts. Effort: **Low**. Risk: **Low**. No rollback or MVP-scope review applies; this doesn't touch requirements or architecture decisions, only their titles/labels.

**Scoped deliberately** — not every file with the old name gets changed:

| File | Action | Rationale |
|---|---|---|
| `SPEC.md` | Rename (H1 only) | Canonical, current contract — should reflect the real name |
| `ARCHITECTURE-SPINE.md` | Rename (frontmatter + H1) | Canonical, current contract |
| `design-tokens.md` | Rename (H1) | Canonical, current — produced same session as the naming decision |
| `component-specs.md` | Rename (H1) | Canonical, current |
| `class-tracker-requirements.md` | **Leave as-is** | Original raw source input (referenced in `SPEC.md` frontmatter `sources:` for traceability only) — rewriting the source material would misrepresent what was actually provided |
| `*/.memlog.md` (×2) | **Leave as-is** | Process/session logs — historical record of work as it happened, not a live contract |
| `review-adversarial.md`, `review-web-verification.md` | **Leave as-is** | Completed review reports — they reviewed a document that was, at that time, titled "Class Tracker"; rewriting them would falsify the review record |
| `_bmad/bmm/config.yaml`, `_bmad/core/config.yaml` (`project_name: tib-class`) | **Leave as-is** | Internal repo/project slug used by BMAD tooling — distinct from the product-facing name; renaming this is a separate, more invasive change (would touch the working directory's BMAD identity) and wasn't asked for |

Internal identifiers that are structural, not cosmetic, are also left alone: `SPEC.md`'s frontmatter `id: SPEC-class-tracker` and the `_bmad-output/specs/spec-class-tracker/` directory path, since companions are linked by that path — renaming it is a bigger filesystem-level change, not a text edit, and nothing requires it functionally.

## 4. Detailed Change Proposals

**`_bmad-output/specs/spec-class-tracker/SPEC.md`** (line 9)
```
OLD: # Munich Tibetan Sunday School — Class Tracker
NEW: # Sherab — Munich Tibetan Sunday School Class Tracker
```

**`_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md`** (lines 2, 7, 16)
```
OLD: name: 'Class Tracker Architecture Spine'
NEW: name: 'Sherab Architecture Spine'

OLD: scope: 'Munich Tibetan Sunday School Class Tracker v1 - all 8 stories'
NEW: scope: 'Sherab (Munich Tibetan Sunday School Class Tracker) v1 - all 8 stories'

OLD: # Architecture Spine — Class Tracker Architecture Spine
NEW: # Architecture Spine — Sherab Architecture Spine
```

**`_bmad-output/design-tokens.md`** (line 8)
```
OLD: # Design Tokens — Class Tracker
NEW: # Design Tokens — Sherab
```

**`_bmad-output/component-specs.md`** (line 8)
```
OLD: # Component Specs — Class Tracker
NEW: # Component Specs — Sherab
```

Rationale for all four: bring canonical current-state documents in line with the naming decision already recorded in `brand-guide.md`, so a reader landing on any of them sees a consistent product name.

## 5. Implementation Handoff

**Scope classification: Minor** — direct text edits to existing documents, no backlog reorganization, no epic/story changes, no architectural re-decision. No PM/Architect escalation needed.

**Handoff:** applied directly as part of this workflow run (four small edits, all approved together in Batch mode) — no separate Developer-agent dispatch needed for a naming-only doc edit. The one open action item, noted in Section 2, is to carry the "Sherab" name into `package.json`, the PWA manifest, and any UI chrome copy once `bmad-build` scaffolds the SvelteKit project — flagging it now so it isn't missed at that point.
