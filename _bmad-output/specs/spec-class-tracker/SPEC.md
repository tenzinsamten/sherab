---
id: SPEC-class-tracker
companions: [roles-and-permissions.md, homework-workflow.md, gamification.md, calendar.md]
sources: [../../../../class-tracker-requirements.md]
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Sherab — Munich Tibetan Sunday School Class Tracker

## Why

The Sunday school runs weekly volunteer-taught classes in Tibetan language, song, and dance, and today a student's progress, homework, and continuity between weeks live in teachers' heads or scattered notes — a pain that bites hardest on teacher turnover, when a new volunteer has no record to pick up from. This is a vision to realize as much as a pain to solve: a lightweight app that lets teachers track progress and homework per student, gives kids a motivating way to see their own progress (streaks, badges, a team leaderboard), and survives handoff between volunteers. It matters now because the school's approach is to ship v1 directly to its own teachers and iterate from real feedback rather than run another requirements round first.

## Capabilities

- **CAP-1**
  - **intent:** Admin creates and verifies teacher accounts and assigns them to classes (many-to-many); students self-register with name + class code, give guardian consent, and provide a guardian email that must be confirmed (via Supabase Auth's own confirmation flow) before a class teacher or the admin can approve them into their Pending-gated state.
  - **success:** An unapproved student is invisible on every roster and leaderboard and cannot log any progress; once approved, they appear everywhere and can act. See `roles-and-permissions.md`.

- **CAP-2**
  - **intent:** Any teacher assigned to a class can view and edit that class's roster, mark attendance per scheduled session (CAP-10), and set a per-student per-skill-area (language/song/dance) status of Not started/Learning/Confident, with full history retained and optional free-text notes.
  - **success:** A substitute teacher opens a class they're assigned to and sees complete status history, not just the latest value; a teacher not assigned to that class cannot see it.

- **CAP-3**
  - **intent:** A teacher creates one-off or recurring homework (title, skill area, target students, due date, optional reference links) scoped to their own class; a student sees their own class's open homework, opens reference links externally, and self-marks items Done; a teacher reviews items to Reviewed.
  - **success:** A recurring assignment auto-generates each period with independent per-instance Done/Reviewed status; overdue, not-Done items stay visible and flagged overdue until a teacher explicitly archives them, never expiring silently. See `homework-workflow.md`.

- **CAP-4**
  - **intent:** The system tracks a per-student streak of consecutive weeks with both attendance and homework Done (Reviewed not required), surviving an admin-configurable number of missed weeks (default 2).
  - **success:** A student who attends and marks homework Done keeps their streak; missing more than the configured grace window resets it, and the grace value can change without a code change. See `gamification.md`.

- **CAP-5**
  - **intent:** A student earns badges at configurable milestone increments of attendance count and homework-done count, visible only on their own profile.
  - **success:** Crossing a milestone awards the corresponding badge without ranking the student against peers. See `gamification.md`.

- **CAP-6**
  - **intent:** Students belong to a fixed-for-the-year team, manually assigned by their teacher at approval/onboarding (including mid-year joins), and teams are ranked by a combined-streak metric visible only within the school.
  - **success:** The leaderboard reflects team standing by combined streak and never triggers automatic team (re)assignment or public exposure. See `gamification.md`.

- **CAP-7**
  - **intent:** The admin manages teacher accounts and class assignments, acts as backup approver for any class's pending registrations, holds the only cross-class view (all teachers, students, overall homework completion), and reviews/actions data-deletion requests.
  - **success:** The admin can approve or reject a registration for any class and see aggregate completion across all classes; no other role has cross-class visibility. See `roles-and-permissions.md`.

- **CAP-8**
  - **intent:** A student can submit a data-deletion request from within the app; the admin must explicitly review and approve it before any of that student's profile, progress, or homework records are erased.
  - **success:** No deletion occurs without a recorded admin approval step, and once approved, all of that student's records are gone.

- **CAP-9**
  - **intent:** The admin marks the school-wide days on which classes happen; several classes can run on the same day.
  - **success:** No class session can be scheduled on a day the admin has not marked, and every role sees the same class days. See `calendar.md`.

- **CAP-10**
  - **intent:** Each class has a default start time and duration; every class day gets a session for the class with those defaults, and any teacher assigned to the class can change a single day's start time and duration or cancel that day.
  - **success:** Changing or cancelling one day leaves the default and all other days untouched, and the class's students see that day's actual start time and duration. See `calendar.md`.

- **CAP-11**
  - **intent:** A student marks each upcoming session of a class they are enrolled in as Coming or On leave, visible to that class's teachers, classmates, and the student's team.
  - **success:** Before class, a teacher sees who is coming and who is on leave; an announced leave does not consume streak grace. See `calendar.md` and `gamification.md`.

## Constraints

- Teachers are created and verified admin-side only — no teacher self-registration.
- Student registration requires guardian consent, a confirmed guardian email, and Pending-state gating before any visibility or activity, to guard against dummy/duplicate sign-ups. Approval is blocked until the guardian confirms; rejection is not.
- Visibility is class-scoped, not teacher-owned: every teacher assigned to a class shares full view/edit of that class; a teacher sees nothing for classes they're not assigned to.
- Skill-status changes retain full history, not just the current value, so a substitute teacher has continuity.
- Homework Done (self-report) alone is sufficient for a streak; Reviewed is a separate, teacher-confirmed state for skill-mastery history and does not gate the streak.
- Overdue, not-Done assignments never auto-expire — visible and flagged until a teacher explicitly archives them.
- The streak grace period (default 2 missed weeks) must be admin-configurable, not hardcoded.
- The homework look-ahead window (default: current + next week) must be configurable in the data model without a structural change.
- Leaderboard teams are fixed for the school year and manually assigned by teachers — no auto-balancing or randomization, including mid-year joins.
- Minimize personal data collected on minors (nickname + progress only); no public-facing leaderboard or profile.
- Data deletion is never automatic — it requires an explicit, recorded admin approval step.
- UI must support German, English, and Tibetan.
- Must run as a low/near-free-cost PWA usable on existing family phones/tablets, with no app-store install required.
- Must tolerate two teachers editing the same class concurrently without clobbering each other's updates.
- The Munich Tibetan group owns the app and its data long-term, not any individual — bears on hosting-account ownership, domain, and admin-access continuity.
- Device access is confirmed reliable (phone/tablet per family) — no paper/offline fallback path is needed for homework or streak tracking.
- Must be simple enough for non-technical volunteer teachers to use without training.
- Class sessions exist only on admin-marked class days; a per-day start time or duration is an override on the class default, never a change to the default.
- Scheduled sessions are the source of truth for attendance and for streak holidays: a week with no non-cancelled session for a class does not consume grace, and neither does a missed session with an announced leave.

## Non-goals

- Parent-facing login/view — deferred to a future phase; v1 has no separate parent account.
- A structured Duolingo-style curriculum engine (lesson sequencing, spaced repetition, adaptive difficulty, speech recognition) — only plain outbound reference links are in scope for v1.
- Embedded in-app media player/preview for reference links — v1 links open externally as plain "Open reference" actions.
- Photo/audio proof-of-completion attachments — a possible future option, not v1; homework completion is self-reported only.
- Offline queueing/sync — nice-to-have, not day-one scope.
- A public/marketing website or video-lesson platform for the school.
- Replacing in-class teaching itself — the app supports continuity and motivation around classes, not a substitute for them.

## Success signal

V1 ships directly to the school's own teachers — no separate requirements-gathering round first — and is validated by one real Sunday-session run end-to-end: the admin onboards a teacher, a teacher approves a pending student, marks attendance, assigns a one-off and a recurring homework item with a reference link, the student marks it done, the teacher reviews it, and the student's streak, badges, and team-leaderboard position update correctly. Iteration afterward is driven by real teacher feedback, not further speculation.

## Assumptions

- Assumed a single admin role/account model for v1 — the source describes one admin view with no multi-admin delegation or admin-of-admins concerns.
- Session times are Munich local time (Europe/Berlin); no multi-timezone support.
- Leave protects a streak only when set before the session starts, so it cannot retroactively excuse an absence.
- Streaks stay weekly: if a class meets on more than one day in a week, attending any session that week qualifies.
- An unanswered session is shown as "not answered" and treated as expected; no reason is collected for leave.
- Removing a class day cancels every class session on that day.

## Open Questions

- Badge milestone step size (every 5 vs. every 10 attendances/homework-done) is explicitly left unresolved in the source — needs confirmation once building.
- GDPR-specific obligations beyond the described consent-at-registration and admin-approved-deletion flow (data controller identity, retention limits, breach notification) are unaddressed, and this app stores EU minors' personal data — needs a compliance decision before real student data is stored. Sharper now that registration also collects and retains a guardian's real email address (an adult's personal data, processed to verify a minor's registration) on the student's profile.
- Should students be notified (push/email) when a session is moved or cancelled, or is in-app display enough for v1?
- Can a student set leave for a date range (e.g. a three-week holiday), or only per session?
- Should the app warn when a student enrolled in two classes has overlapping sessions?
- Is calendar export or sync (iCal, Google Calendar) wanted, or in-app only?
- Leave is visible to the student's team across classes (nickname + Coming/On leave only). Confirm this fits the minimize-data-on-minors constraint.
