---
id: COMPONENTS-class-tracker
tool: ui-ux-pro-max
generated: 2026-09-13
companions: [brand-guide.md, design-tokens.md]
---

# Component Specs — Sherab

Maps [[design-tokens]] to the actual capabilities in `_bmad-output/specs/spec-class-tracker/SPEC.md`. Kid-facing components (student role) get full `--radius-clay` / `--shadow-clay` treatment; teacher/admin components use `-quiet` tokens — same shape language, lower volume, per [[brand-guide]].

## Navigation shells (one per role)

Bottom nav, mobile-first, ≤5 items (DB-matched nav-pattern limit), `padding-top` compensation on body for any sticky header.

- **Student:** Home (streak + today's homework) · Homework · Progress (skill areas) · Team/Leaderboard · Profile (badges). Full celebration styling — this is the primary experience.
- **Teacher:** My Classes · Roster/Attendance · Homework · (class switcher if assigned to >1 class). Quiet styling.
- **Admin:** Approvals · Teachers & Classes · Overview (cross-class) · Deletion Requests · Settings. Quiet styling.

All three inherit `--font-display: Baloo 2` for the nav label/heading row so the shell reads as one brand.

## Skill-status control (CAP-2)

Per-student, per-skill-area (language/song/dance) status: Not started / Learning / Confident, full history retained.

- **Control:** three `<button aria-pressed>` chips in a row (never a `<div onclick>` — Critical severity DB guidance), min `--touch-target-min` (48px) each, `--touch-gap-min` (8px) between.
- **Color:** `--color-status-not-started` / `--color-status-learning` / `--color-status-confident`, always paired with the text label — never color alone.
- **History:** tapping the current status opens a reverse-chronological list (date, status, optional free-text note); this is what makes a substitute teacher's "see complete history" success criterion work — don't collapse to "current value only" in the UI even though it's tempting for space.
- Uses `-quiet` tokens (teacher-facing).

## Attendance & roster list (CAP-2, CAP-7)

Teacher's class roster, admin's cross-class roster.

- Row-based list, `-quiet` radius/shadow, `--space-dense-*` spacing (data-dense, not the spacious kid scale).
- Weekly attendance toggle is a `<button aria-pressed>` per student, 48px min target, reachable one-handed on a phone (this is marked mid-class, standing up).
- Admin roster adds a class-filter and shows aggregate completion (its unique cross-class success criterion, CAP-7) — nothing else gets this view.

## Homework card (CAP-3)

- States: **Open** (`--color-primary` accent) · **Done, not Reviewed** (`--color-status-done`) · **Reviewed** (`--color-status-reviewed`) · **Overdue** (`--color-status-overdue`, persistent — never auto-dismisses per SPEC.md constraint, only a teacher's explicit archive action removes it from view).
- Reference link renders as an "Open reference ↗" action that opens externally (SPEC.md non-goal: no embedded preview/player) — external-link icon required so it's clear it leaves the app.
- Recurring badge (small pill: "Weekly") distinguishes recurring from one-off; each generated instance has its own independent Done/Reviewed state — the card never implies marking one instance affects others.
- Teacher creation form: title, skill area, target students (multi-select), due date, optional reference link, one-off/recurring toggle. Inline validation, errors rendered next to the field (DB priority-table guidance, category 8).
- Student surfaces: full `--radius-clay`/celebration styling. Teacher review surfaces: `-quiet`.

## Streak card (CAP-4) — full celebration treatment

- Primary hero element on the student Home screen: large `--text-3xl` count in `--font-display`, `--radius-clay` + `--shadow-clay`, `--color-secondary` (play yellow) as the dominant surface color.
- Grace-period state: if within the missed-week grace window, show a gentle "keep it going" nudge, not a warning — tone matters here (see brand-guide Voice: never shame a reset).
- On a fresh milestone/continued streak, a one-time `--color-accent` (pink) celebration flourish (confetti-style micro-interaction, `prefers-reduced-motion`-aware, DB priority-table category 7) — not persistent chrome.

## Badge grid (CAP-5) — full celebration treatment

- Grid of chunky rounded badge tiles (`--radius-clay`), earned badges at full color/`--shadow-clay`, unearned badges desaturated/outline-only (still visible, so progress-toward-next is legible — don't hide locked badges entirely, that removes the motivation).
- Visible **only on the student's own profile** (CAP-5 success criterion) — no path in the component tree that exposes another student's badge grid to a peer.
- Badge icon set: no DB match found for this domain (see [[design-tokens]] "Not found" section) — use a general SVG icon library (Lucide/Heroicons), never emoji.

## Team leaderboard (CAP-6) — full celebration treatment

- Team-based ranking (not individual), ordered by combined streak. Each team row: team name/color, combined streak number (`--font-display`, large), member count — never individual member streaks on this screen (privacy: CAP-5's "not ranked against others" logic extends here).
- Visible only within the school (no public/external route, no share action) — enforce at the routing layer, not just by omitting a share button.
- `-clay` styling, but no confetti/motion on this screen by default (it's a standing view, not a one-time moment) — reserve the celebration micro-interaction for the streak card and badge-earned event specifically.

## Registration & approval flow (CAP-1, CAP-7)

- Student self-registration form: name + class code + guardian consent checkbox (must be explicit, not pre-checked) → Pending state, plain confirmation screen ("waiting for your teacher to approve you") — friendly, not a dead end.
- Teacher/admin approval queue: card per pending student (name, class, requested date), Approve/Reject as two distinct `--touch-target-min` buttons, never adjacent-and-same-style (avoid accidental reject) — separate them with `--touch-gap-min` minimum and differentiate color (`--color-primary` approve / neutral outline reject, not destructive-red reject since rejecting a registration isn't a destructive data action).
- **Team picker (required on the Approve step, not a separate screen):** per stories.yaml Story 7 and AD-4, approving a student is the moment their fixed-for-the-year `team_id` is set (from `NULL` — the only time it's allowed to be set via the normal client path). The approval card expands, on Approve, into a required team-select control before the approval commits — a teacher cannot approve a student without picking a team. This is the only place team assignment happens in v1; there is no separate "assign team" admin screen.
- `-quiet` styling throughout (teacher/admin surface).

## Admin Settings screen

Houses the `app_settings` values every RLS/trigger reads instead of a hardcoded constant (AD-3, Consistency Conventions): streak grace period (weeks, default 2 — Story 5), badge milestone step (default unresolved per SPEC.md Open Questions — Story 6), homework look-ahead window (default current + next week — homework-workflow.md, Story 3/4). One simple form, each field using the numeric-input pattern from "Forms, generally" below, each showing its current effective value and a plain-language one-line explanation of what it controls. `-quiet` styling; admin-only route.

## Data-deletion request (CAP-8)

- Student-initiated request: simple confirm-style flow from their own profile settings, plain language explaining what happens (admin review required, not immediate).
- Admin review screen: request detail + explicit Approve action (`--color-destructive`-adjacent but deliberate, not a stray tap — require a confirm step) — this is the one place a destructive-style color is correct, since the action is genuinely irreversible per SPEC.md.

## Forms, generally

- Labels always visible (never placeholder-only — DB priority-table category 8).
- Errors inline, next to the field, in `--color-destructive`, plain-language.
- Numeric admin settings (grace period, badge milestone step, look-ahead window) use `inputmode="numeric"` and show the current effective value, not just an empty input.
- `lang` attribute switches per active locale (`de`/`en`/`bo`); Tibetan-script fields use `--font-tibetan` (see brand-guide flag on sans-Tibetan availability).

## Pre-delivery checklist (inherited from tool defaults, apply project-wide)

- [ ] No emoji as icons anywhere (SVG only)
- [ ] `cursor-pointer` / clear affordance on every clickable element
- [ ] Hover states 150-300ms (desktop only — most usage is touch)
- [ ] Text contrast 4.5:1 minimum in both light and dark mode, explicitly re-checked on the pink accent (`#EC4899`) combinations
- [ ] Visible focus ring for keyboard nav (admin likely uses a laptop)
- [ ] `prefers-reduced-motion` respected on all celebration micro-interactions
- [ ] Responsive at 375 / 768 / 1024 / 1440px, no horizontal scroll
- [ ] Every status/state signal pairs an icon or label with color — never color alone
