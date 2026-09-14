# Epic 2 Context: Roster & Skill Tracking

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic gives any teacher assigned to a class the ability to run their weekly Sunday session: mark attendance and record each student's per-skill-area progress (language/song/dance), with the full change history preserved rather than just a current snapshot. It matters because progress and continuity currently live only in teachers' heads — when a volunteer teacher is substituted or turns over, the next person needs to see the real history, not a single overwritten value, to pick up where the class left off.

## Stories

- Story 2.1: Roster & skill-status tracking

## Requirements & Constraints

- Any teacher assigned to a class (not just its "owner" — class-scoped, many-to-many) can view and edit that class's full roster: mark weekly attendance and set a per-student per-skill-area status across three states (Not started / Learning / Confident) for language, song, and dance independently.
- Every status/attendance change must retain full history, not just the current value — the defining success test is a substitute teacher opening an assigned class and seeing the complete timeline, not just the latest mark.
- Optional free-text notes may accompany a status entry.
- A teacher not assigned to a class must see nothing for it — this class-scoping applies to reads as well as writes.
- Must tolerate two teachers editing the same class concurrently without one clobbering the other's update.
- Must remain usable by non-technical volunteer teachers with no training, and support German/English/Tibetan UI (all copy goes through Paraglide, never inline strings).
- Attendance and homework-Done data recorded here become inputs other epics read later (streaks in Story 4-1 need attendance; badges in Story 4-2 count attendance) — this epic only needs to record them correctly, not compute anything derived from them itself.

## Technical Decisions

- Persistence is `attendance_records` and `skill_status_history`, written directly by the client (no custom API layer) and authorized entirely by Postgres RLS — never by frontend-only gating.
- History-as-append is mandatory here: attendance marks and skill-status changes each insert a new row rather than updating one in place; "current" is always the latest row by timestamp for a given (student, subject) pair. This is also what makes concurrent two-teacher edits safe — there's no shared row to clobber.
- Class-scoped visibility resolves through the existing `class_teachers` join table and `profiles.role` (established in Story 1.1) — every RLS policy for roster reads/writes checks membership there, not a locally invented per-feature check.
- Conventions carried over from the architecture spine: `snake_case` DB tables/columns, kebab-case routes, `PascalCase` Svelte components, UUID PKs, `timestamptz` UTC timestamps, ISO 8601 dates.
- Column-level schema for these two tables is not yet fixed by planning docs — it's owned by the migration this story writes, working within the append-only/class-scoped constraints above.

## UX & Interaction Patterns

- No screen design exists yet for roster/attendance/skill-status marking specifically — the current UX spine explicitly defers it ("roster/attendance tracking is explicitly out of scope here — belongs to Story 2-1") and the existing `/teacher/classes` screen only shows a placeholder note where this UI will go. Build functional screens against the patterns below; flag any real design decision needed rather than inventing one.
- Visual system is bold/editorial: zero border-radius anywhere, flat surfaces with hairline dividers (no shadows/elevation), one accent color (Signal Blue) per screen for the single primary action, huge all-caps display type for headings only (never body/button text), small tracked-uppercase captions for labels.
- Existing data-table pattern should extend naturally to a roster grid: desktop renders a dark-header full-width table; phone renders the same data as stacked, hairline-divided label/value rows — same dataset, not two different views.
- WCAG 2.2 AA is the accessibility floor; real `<h1>`/`<h2>` semantics must back the all-caps visual treatment, not just styled divs.
- Terse, instructive microcopy with no exclamation points or emoji; an empty roster or empty history should describe the user's actual situation, not project-roadmap language.

## Cross-Story Dependencies

- Depends on Story 1.1 for `profiles`, `class_teachers`, and the RLS/identity foundation — roster visibility and edit rights resolve through structures that story creates.
- Attendance records this story writes are a direct input to Story 4.1 (streaks, which need both attendance and homework Done per week) and Story 4.2 (badges, which count attendance milestones) — this epic must get the data model right since later epics read it, but does not itself implement any derived/computed behavior.
