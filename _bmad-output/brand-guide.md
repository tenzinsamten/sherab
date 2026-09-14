---
id: BRAND-class-tracker
tool: ui-ux-pro-max
generated: 2026-09-13
companions: [design-tokens.md, component-specs.md]
---

# Brand Guide — Sherab (Munich Tibetan Sunday School Class Tracker)

## App name: Sherab

**ཤེས་རབ་** (Wylie: *shes rab*) — "wisdom" / "insight," a direct parallel to Sanskrit *prajñā*. Chosen over the alternative "Sheja" (ཤེས་བྱ་, "object of knowledge" — a technical Buddhist-epistemology term) because it's warmer, widely recognized by Tibetan speakers in everyday use (it's also a common given name), and gives the gamification system a natural story: streaks and badges represent wisdom growing through consistent effort, not an abstract category of knowable things.

- **Latin wordmark:** Sherab
- **Tibetan script (paired wherever space allows, and always in the `bo` locale):** ཤེས་རབ་
- **Say it:** "sheh-rab"
- This is a naming decision only — it has not yet been propagated into `_bmad-output/specs/spec-class-tracker/SPEC.md` (still titled "Munich Tibetan Sunday School — Class Tracker") or the architecture doc. Propagate it there via a small `bmad-correct-course` pass, or a direct edit, before the name shows up in code/config — flagging so it isn't missed, not doing it here since SPEC.md is BMAD's canonical contract and out of this design skill's scope.

## Who this is for, in priority order

1. **Students (kids)** — the primary audience. They open the app to see their own streak, badges, homework, and team standing. The app's whole job, for them, is to feel like a small weekly reward, not a chore.
2. **Teachers** — volunteers, often non-technical, using a phone/tablet mid-class. They need speed and clarity, but they are *guests in the kids' app*, not the other way around — their screens share the same visual language, just quieter.
3. **Admin** — one person, lowest frequency of use, cross-class oversight and approvals.

**Decision (per user direction):** because students are the main audience, the brand is built kid-first. Teacher/admin surfaces are the same design system at lower visual volume — not a competing "serious dashboard" style bolted on next to a "fun kids" style. One brand, two dials (see [[design-tokens]] `--density` and `--celebration-intensity`).

## Style direction: Claymorphism

**Source:** `ui-ux-pro-max` `--design-system "education nonprofit gamified kids progress tracker"` → matched style `Claymorphism` (DB match, `styles.csv`).

Soft 3D, chunky, toy-like, bubbly. Thick borders (3-4px), double shadows (inner+outer), generously rounded corners (16-24px), soft 200ms press feedback. Explicitly listed as best-for: *educational apps, children's apps*. This is the primary style for the whole product — badges, streak counters, and the team leaderboard get the fullest expression of it (chunky, celebratory, tactile); roster tables, forms, and admin lists use the same corner radius / shadow / color language at reduced intensity so an adult scanning a class list isn't fighting visual noise, but nothing in the app looks like it belongs to a different product.

**Avoid** (per DB match): muted colors, low energy. Don't let the "calmer" teacher/admin variant drift into gray corporate-dashboard territory — it should still read as the same friendly app.

## Color

**Source:** DB match, `styles.csv` Claymorphism palette ("Learning blue + play yellow + fun pink"), cross-checked against the `colors.csv` "LMS (Learning Management System)" match (education teal) — kept the Claymorphism palette as primary since it's the direct style-paired result and fits the kid-first priority; the LMS teal is noted below as an alternate if the group wants a slightly calmer primary later.

| Token | Hex | Role |
|---|---|---|
| `--color-primary` | `#2563EB` | Primary actions, nav accents, links — "learning blue" |
| `--color-secondary` | `#F59E0B` | Streaks, in-progress states, secondary CTAs — "play yellow" |
| `--color-accent` | `#EC4899` | Celebration moments only: badge-earned, streak-milestone, confetti — "fun pink" |
| `--color-background` | `#EFF6FF` | App background (light mode) |
| `--color-foreground` | `#0F172A` | Body text |
| `--color-card` | `#FFFFFF` | Card/surface background |
| `--color-muted` | `#F1F5FD` | Subtle fills, disabled states |
| `--color-muted-foreground` | `#475569` | Secondary text |
| `--color-border` | `#E4ECFC` | Default borders (thin contexts) |
| `--color-destructive` | `#DC2626` | Errors, delete/reject actions |
| `--color-ring` | `#2563EB` | Focus ring |

Contrast: verify every text/background pair hits **4.5:1** before shipping (checklist item — Claymorphism is flagged `accessibility: conditional`, this is the thing that condition is about). Pink accent (`#EC4899`) is for decoration and celebration copy only — never the only signal for a pass/fail state (pair with an icon/label, not color alone).

**Alternate (not used, noted for the record):** LMS teal palette (`#0D9488` primary / `#D97706` amber accent) — DB match, calmer/more "serious education product." Revisit only if real classroom feedback says the primary blue+pink reads as too young for the teacher-facing views; don't switch preemptively.

## Typography

**Source:** DB match, `styles.csv` Claymorphism → paired font recommendation `Baloo 2 / Comic Neue` (kids, education, playful, friendly). DB match, `typography.csv` "Corporate Trust" (`Lexend` / `Source Sans 3` — accessibility-focused) used as the deliberate substitution for dense/small text, per the reasoning below.

| Context | Font | Why |
|---|---|---|
| Headings, badge names, streak numbers, nav labels, buttons (kid-facing + shared chrome) | **Baloo 2** | DB-matched playful/rounded display weight that carries the brand everywhere, including on teacher/admin screens — this is what keeps the "quieter" screens still feeling like the same app. |
| Short playful copy (empty states, celebration toasts, onboarding) | **Comic Neue** | DB-matched pairing partner for Baloo 2, used only for short strings. |
| Body copy, table/list rows, form labels, admin data (roster names, dates, settings) | **Source Sans 3** | Deliberate adaptation: Comic Neue is not legible enough at small sizes for dense roster/attendance tables or German/English form copy — swapping to the DB-matched accessibility-first body font (from the "Corporate Trust" pairing) for anything dense, while keeping Baloo 2 headings so the page still reads as the same brand. |
| Tibetan-script UI text (third locale, per SPEC.md constraint) | **Noto Serif Tibetan** | DB match, `google-fonts.csv`, the only Tibetan-subset family the database returned with broad weight coverage (100–900). No Noto **Sans** Tibetan equivalent was found in this database (search returned only Serif options: Noto Serif Tibetan, Jomolhari, Uchen — all serif/display) — **flag for the team**: confirm this renders acceptably next to the sans-serif Latin type before launch; a genuinely sans Tibetan face may need to be sourced outside this tool if it reads inconsistently. |

```css
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700&family=Comic+Neue:wght@300;400;700&family=Source+Sans+3:wght@300;400;500;600;700&family=Noto+Serif+Tibetan:wght@400;500;600;700&display=swap');
```

## Voice

Warm, encouraging, plain-language — written for an 8-year-old and a first-time volunteer teacher at the same time. Celebrate effort ("3-week streak!") over comparison language. Never shame a missed week or a reset streak — the grace period exists precisely so the tone can stay kind. Teacher/admin copy is the same voice, just terser (task-focused, not childish).

## What NOT to do

- Don't let admin/teacher screens fall back to a generic dark "SaaS ops dashboard" look (an earlier search pass surfaced Glassmorphism/dark-tech as a plausible admin direction — explicitly rejected: wrong audience priority, and a poor fit for non-technical volunteers).
- No emoji as icons anywhere — SVG icon set only (see [[component-specs]]; this is a general-defaults fallback, not a DB match — the icon-domain search for "badge/achievement/streak" returned 0 results).
- Don't use the pink celebration accent as a status color (pass/fail, done/not-done) — reserve it for one-time celebratory moments.
