---
id: SPEC-badge-detail
companions:
  - badge-catalog.md
  - ../spec-class-tracker/gamification.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Badge Detail

## Why

Badges are meant to motivate kids, but today an earned badge is a bare pill ("10 classes"). It doesn't say what it rewards, when it was earned or how close the next one is, and unearned badges are invisible, so there is no goal to work toward. This is a vision to realize, motivation-first: turn badges into a visible per-subject path with distinct Tibetan-styled icons, which the student follows and their parents and teachers can follow too. This spec supersedes the Badges section of `gamification.md` where they differ: badges are now per subject and visible beyond the student's own profile.

## Capabilities

- **CAP-1**
  - **intent:** Each class carries a badge subject (language, dance, or instrument; song classes use dance), set by the admin.
  - **success:** Every class shows a subject; the admin cannot save a new or edited class without one. Existing classes start without one until the admin assigns it, and count toward no badges until then.
- **CAP-2**
  - **intent:** A student earns attendance and homework badges at each configured milestone, counted separately per subject.
  - **success:** 10 present sessions across a student's dance and song classes earns dance-attendance-10, and the student's language count is unchanged.
- **CAP-4**
  - **intent:** Every badge renders its own icon for its subject, type, and milestone. See `badge-catalog.md`.
  - **success:** All 36 combinations render the correct icon; a milestone without an icon renders the trophy fallback.
- **CAP-5**
  - **intent:** Tapping an earned badge shows what it rewards, its subject, the date earned, and the next milestone in that track.
  - **success:** The dance-homework-5 detail shows "5 dance homework done", its earned date, and "Next: 10".
- **CAP-6**
  - **intent:** For each of their subjects, a student sees progress toward the next badge in each track.
  - **success:** Shown counts (e.g. "7 / 10") equal the student's real per-subject counts and update after attendance or homework is marked.
- **CAP-7**
  - **intent:** A badge page of its own lists every badge for the student's subjects: earned ones with their date, locked ones as the greyed real icon with the requirement to unlock. The dashboard Badges tile shows recent badges and links to it ("See all").
  - **success:** A student in language and dance sees 24 badges with correct earned/locked states and no instrument badges; the tile's "See all" opens the page.
- **CAP-8**
  - **intent:** Linked parents and teachers of the student's classes see the same badge detail, progress, and badge page (their own route for that student) as the student, across all subjects.
  - **success:** Parent and teacher views match the student's; any other student, parent, or teacher is denied.
- **CAP-9**
  - **intent:** The first time a student opens the app after earning a badge, they see a one-time "New badge!" moment showing its icon.
  - **success:** Each earned badge triggers the moment exactly once; after dismissal it does not reappear.

CAP-3 (recompute existing badges) is retired: the app has no live badge history, so no migration is needed.

## Constraints

- Badges are trigger-written only (AD-3): the database awards them when attendance or homework changes; the client never inserts badge rows.
- Earned badges are never deleted or downgraded.
- Milestones come from `app_settings.badge_milestone_thresholds` (today 1, 5, 10, 25, 50, 100); icons exist only for those.
- Song and dance classes feed one shared dance count, not two tracks.
- No ranking: badges and progress are never compared between students or fed into the team leaderboard.
- Visibility is enforced in the database: the student, their linked parents, teachers of the student's classes, and admin. Teachers gain read access they lack today.
- All text around the icons (names, criteria, progress, dates, celebration) is localized in en, de, and bo; the icons carry baked-in Tibetan labels.
- Icons ship as the 36 labelled SVGs in `static/badges/` (see `badge-catalog.md`); the plain set is not used.

## Non-goals

- No migration or recompute of existing badge rows; existing subject-less rows may be discarded.
- No new badge kinds (streak, skill, special awards); only attendance and homework.
- No download, print, or share of badge images outside the app.
- No admin UI to edit milestone thresholds; they stay DB-configured.

## Success signal

- At launch, after one real Sunday session: a dance student opens their badge page and sees the newly earned badge (celebrated once) with the right icon and date, correct "x / next" progress, and greyed locked badges; their parent and teacher see the same.
- Over the following term, the share of homework marked Done by its due date rises compared with the previous term.

## Assumptions

- Teachers do not create classes today, so only the admin sets the subject in `/admin/classes`.
- A class has exactly one badge subject.
