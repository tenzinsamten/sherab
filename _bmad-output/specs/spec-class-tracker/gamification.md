# Gamification: Streaks, Badges, Leaderboard

Detail behind CAP-4, CAP-5, CAP-6. The kernel states the intents and success criteria; this holds the numeric rules and assignment mechanics.

## Streaks

- Tracks consecutive weeks with **both** attendance and homework marked Done (Reviewed not required).
- Grace period: a streak survives up to **2 missed weeks by default** — configurable by the admin, not hardcoded.

## Badges

- v1 criteria: attendance count and homework count, awarded at increments (e.g. a badge at 5 classes attended, another at 10, another at 15; same milestone pattern for homework count).
- Exact step size (5 vs. 10) is unresolved — see Open Questions in SPEC.md.
- Visible only on the student's own profile; not ranked against others.

## Leaderboard

- Team-based (e.g. 3 house-style teams), not individual ranking.
- Teams are fixed for the school year — no reshuffling mid-year.
- Assignment is manual, by the teacher — no auto-balancing or randomization. A teacher places their own students into a team when approving/onboarding them.
- Mid-year joins: the teacher decides which team a new student joins — no automatic rule.
- Ranked by combined streaks (or another agreed metric) — rewards consistency over raw knowledge.
- Visible only within the school, never public.
