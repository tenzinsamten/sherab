# Gamification: Streaks, Badges, Leaderboard

Detail behind CAP-4, CAP-5, CAP-6. The kernel states the intents and success criteria; this holds the numeric rules and assignment mechanics.

## Streaks

- Tracks consecutive weeks with **both** attendance and homework marked Done (Reviewed not required).
- Grace period: a streak survives up to **2 missed weeks by default** — configurable by the admin, not hardcoded.
- Holidays come from the calendar: a week with no non-cancelled session for the class does not consume grace. A missed session with Planned Leave or teacher-approved Sick leave does not consume grace either. See `calendar.md`.
- Short-notice leave (set later than the leave notice period, default 2 weeks, admin-configurable) and rejected Sick leave consume one grace week, like an unannounced absence. Rationale: late cancellations disrupt teachers' planning.
- A Sick decision (or its automatic approval after 2 weeks) recalculates the streak for that week.

## Badges

- Criteria: attendance count and homework-done count, each counted **per class subject** (language, dance incl. song, instrument).
- Milestones: 1, 5, 10, 25, 50, 100 (`app_settings.badge_milestone_thresholds`), each with its own icon.
- Visible to the student, their linked parents, teachers of their classes, and admin; never ranked against others.
- Full rules, icons, badge page, and celebration: `../spec-badge-detail/SPEC.md` and its `badge-catalog.md`.

## Leaderboard

- Team-based (e.g. 3 house-style teams), not individual ranking.
- Teams are fixed for the school year — no reshuffling mid-year.
- Assignment is manual, by the teacher — no auto-balancing or randomization. A teacher places their own students into a team when approving/onboarding them.
- Mid-year joins: the teacher decides which team a new student joins — no automatic rule.
- Ranked by combined streaks (or another agreed metric) — rewards consistency over raw knowledge.
- Visible only within the school, never public.
