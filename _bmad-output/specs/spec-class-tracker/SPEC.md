---
id: SPEC-class-tracker
companions: [roles-and-permissions.md, homework-workflow.md, gamification.md, calendar.md, ../../planning-artifacts/prds/prd-tib-class-2026-09-26/addendum.md]
sources: [../../../../class-tracker-requirements.md, ../../planning-artifacts/prds/prd-tib-class-2026-09-26/prd.md]
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Sherab — Munich Tibetan Sunday School Class Tracker

## Why

The Sunday school runs weekly volunteer-taught classes in Tibetan language, song, and dance, and today a student's progress, homework, and continuity between weeks live in teachers' heads or scattered notes — a pain that bites hardest on teacher turnover, when a new volunteer has no record to pick up from. This is a vision to realize as much as a pain to solve: a lightweight app that lets teachers track progress and homework per student, gives kids a motivating way to see their own progress (streaks, badges, a team leaderboard), and survives handoff between volunteers. It matters now because the school's approach is to ship v1 directly to its own teachers and iterate from real feedback rather than run another requirements round first. With only ~40 sessions a year, teachers concluded the school also needs parents: today a child can skip homework and no parent finds out, so parents get a read-only view of their children.

## Capabilities

- **CAP-1**
  - **intent:** Admin creates and verifies teacher accounts and assigns them to classes (many-to-many); students self-register with name + class code, give guardian consent, and provide a guardian email that must belong to an approved parent (CAP-12) before a class teacher or the admin can approve them out of their Pending-gated state. A student can request a guardian email correction, which the admin approves.
  - **success:** A student whose guardian email matches no approved parent cannot register; an unapproved student is invisible on every roster and leaderboard and cannot log any progress; once approved, they appear everywhere and can act. See `roles-and-permissions.md`.

- **CAP-2**
  - **intent:** Any teacher assigned to a class can view and edit that class's roster, mark attendance per scheduled session (CAP-10), and set a per-student per-skill-area (language/song/dance) status of Not started/Learning/Confident, with full history retained and optional free-text notes written for the student's parent.
  - **success:** A substitute teacher opens a class they're assigned to and sees complete status history, not just the latest value; a teacher not assigned to that class cannot see it.

- **CAP-3**
  - **intent:** A teacher creates one-off or recurring homework (title, skill area, content language, required formatted content, target students, due date, optional reference links) scoped to their own class; a student sees their own class's open homework with its formatted content, opens reference links externally, and self-marks items Done; a teacher reviews items to Reviewed.
  - **success:** A homework cannot be saved without content; its title and content are shown in the font of the language chosen for it, whatever the viewer's interface language. A recurring assignment auto-generates each period with independent per-instance Done/Reviewed status; overdue, not-Done items stay visible and flagged overdue until a teacher explicitly archives them, never expiring silently. See `homework-workflow.md`.

- **CAP-4**
  - **intent:** The system tracks a per-student streak of consecutive weeks with both attendance and homework Done (Reviewed not required), surviving an admin-configurable number of missed weeks (default 2). Leave protects the streak only when planned early enough or when it is teacher-approved sick leave.
  - **success:** A student who attends and marks homework Done keeps their streak; missing more than the configured grace window resets it; short-notice leave consumes grace; the grace value and leave notice period can change without a code change. See `gamification.md`.

- **CAP-5**
  - **intent:** A student earns badges at configurable milestone increments of attendance count and homework-done count, visible only on their own profile.
  - **success:** Crossing a milestone awards the corresponding badge without ranking the student against peers. See `gamification.md`.

- **CAP-6**
  - **intent:** Students belong to a fixed-for-the-year team, manually assigned by their teacher at approval/onboarding (including mid-year joins), and teams are ranked by a combined-streak metric visible only within the school.
  - **success:** The leaderboard reflects team standing by combined streak and never triggers automatic team (re)assignment or public exposure. See `gamification.md`.

- **CAP-7**
  - **intent:** The admin manages teacher accounts and class assignments, is the only approver of parent accounts, acts as backup approver for any class's pending registrations, holds the only cross-class view (all teachers, students, overall homework completion), and reviews/actions data-deletion requests.
  - **success:** The admin can approve or reject a registration for any class and see aggregate completion across all classes; no other role has cross-class visibility. See `roles-and-permissions.md`.

- **CAP-8**
  - **intent:** A student, or their parent, can submit a data-deletion request from within the app; the admin must explicitly review and approve it before any of that student's profile, progress, or homework records are erased.
  - **success:** No deletion occurs without a recorded admin approval step, and once approved, all of that student's records are gone.

- **CAP-9**
  - **intent:** The admin marks the school-wide days on which classes happen; several classes can run on the same day.
  - **success:** No class session can be scheduled on a day the admin has not marked, and every role sees the same class days. See `calendar.md`.

- **CAP-10**
  - **intent:** Each class has a schedule — the weekdays it runs on, one start time and duration, a start date and an optional end date — set by the admin or any teacher assigned to the class. The class gets a session on every class day that matches its schedule, and may get extra one-off sessions on other class days. Any teacher assigned to the class can change a single session's start time and duration or cancel it.
  - **success:** A class only has sessions on class days matching its schedule or added as extras; changing the schedule regenerates sessions from today on and never touches past sessions; changing or cancelling one session leaves the schedule and all other sessions untouched, and the class's students see that session's actual start time and duration. See `calendar.md`.

- **CAP-11**
  - **intent:** A student's parent marks each session of a class the student is enrolled in as Coming, On leave, or Sick; the answer is visible to that class's teachers, classmates, and the student's team, and the student sees it read-only. Sick leave needs a teacher's approval.
  - **success:** Before class, a teacher sees who is coming and who is on leave; classmates and team never see Sick, only On leave; planned or approved-sick leave does not consume streak grace. See `calendar.md` and `gamification.md`.

- **CAP-12**
  - **intent:** A parent self-registers with email and password, confirms the email, and is approved by the admin; every student registered with that email is the parent's linked child. One parent account per family; one parent per student.
  - **success:** A pending or unconfirmed parent sees no student data; an approved parent sees exactly the students registered with their email, pending ones marked "Waiting for approval". See `roles-and-permissions.md`.

- **CAP-13**
  - **intent:** An approved parent picks a linked child from per-child summary cards (open and overdue homework counts) and sees that child's homework, attendance history, skill status with history, teacher notes, streak, badges, team and leaderboard, sessions and leave answers, and teachers. The parent also has a My Profile page like the teacher's.
  - **success:** The parent can change nothing about homework, attendance, skills, or notes, and sees no other student's personal data beyond what the leaderboard shows the child. See `roles-and-permissions.md`.

- **CAP-14**
  - **intent:** Any teacher assigned to a class, or the admin, writes that class's syllabus, one per school year (September to August): optional formatted text in a chosen content language, plus optional links. Students enrolled in the class see it on their class page.
  - **success:** A student sees the current school year's syllabus of a class they are enrolled in, or the newest one when this year has none, with its formatting and in the font of its language; a teacher not assigned to the class can neither see nor change it; a syllabus may consist of links only.

## Constraints

- Teachers are created and verified admin-side only — no teacher self-registration.
- Student registration requires guardian consent, the email of an approved parent account, and Pending-state gating before any visibility or activity, to guard against dummy/duplicate sign-ups. Parents register and are approved first; the parent's already-confirmed email replaces the separate guardian-email confirmation.
- Parent access is read-only except setting attendance intent and submitting deletion requests: parents guide the student, never complete work for them.
- No reason or medical detail is collected for Sick leave, and Sick is never shown to classmates or team.
- Visibility is class-scoped, not teacher-owned: every teacher assigned to a class shares full view/edit of that class; a teacher sees nothing for classes they're not assigned to.
- Skill-status changes retain full history, not just the current value, so a substitute teacher has continuity.
- Homework Done (self-report) alone is sufficient for a streak; Reviewed is a separate, teacher-confirmed state for skill-mastery history and does not gate the streak.
- Overdue, not-Done assignments never auto-expire — visible and flagged until a teacher explicitly archives them.
- The streak grace period (default 2 missed weeks) and the leave notice period (default 2 weeks) must be admin-configurable, not hardcoded.
- The homework look-ahead window (default: current + next week) must be configurable in the data model without a structural change.
- Leaderboard teams are fixed for the school year and manually assigned by teachers — no auto-balancing or randomization, including mid-year joins.
- Minimize personal data collected on minors (nickname + progress only); no public-facing leaderboard or profile.
- Data deletion is never automatic — it requires an explicit, recorded admin approval step.
- UI must support German, English, and Tibetan.
- A class and a team have a name in each interface language. English and Tibetan are required when the admin creates or edits one; German is optional. Everyone sees the name of their interface language, and the English name when that language has none. A name cannot repeat within one language.
- Homework content and syllabus text are written in one chosen content language (Tibetan, English, or German). That language, not the viewer's interface language, decides the font the text and a homework's title are shown in.
- Homework content and syllabus text are formatted text limited to bold, italic, underline, two heading sizes, bullet and numbered lists, and links to web or email addresses. They have no length limit a teacher can reach. Whatever a teacher types is shown as text, never run as markup.
- Must run as a low/near-free-cost PWA usable on existing family phones/tablets, with no app-store install required.
- Must tolerate two teachers editing the same class concurrently without clobbering each other's updates.
- The Munich Tibetan group owns the app and its data long-term, not any individual — bears on hosting-account ownership, domain, and admin-access continuity.
- Device access is confirmed reliable (phone/tablet per family) — no paper/offline fallback path is needed for homework or streak tracking.
- Must be simple enough for non-technical volunteer teachers to use without training.
- Class sessions exist only on admin-marked class days; a per-day start time or duration is an override on the class default, never a change to the default.
- Scheduled sessions are the source of truth for attendance and for streak holidays: a week with no non-cancelled session for a class does not consume grace, and neither does a missed session with Planned Leave or approved Sick Leave.

## Non-goals

- Parent notifications (email or push) — a later stage.
- More than one parent account per family, in-app parent-teacher messaging, parents editing the child's profile, changing the parent email, and teachers approving parents.
- A structured Duolingo-style curriculum engine (lesson sequencing, spaced repetition, adaptive difficulty, speech recognition) — only plain outbound reference links are in scope for v1.
- Embedded in-app media player/preview for reference links — v1 links open externally as plain "Open reference" actions.
- Images, tables, file attachments, or embedded media inside homework content or a syllabus, and more than one content language per homework or syllabus.
- Photo/audio proof-of-completion attachments — a possible future option, not v1; homework completion is self-reported only.
- Offline queueing/sync — nice-to-have, not day-one scope.
- A public/marketing website or video-lesson platform for the school.
- Replacing in-class teaching itself — the app supports continuity and motivation around classes, not a substitute for them.

## Success signal

V1 ships directly to the school's own teachers — no separate requirements-gathering round first — and is validated by one real Sunday-session run end-to-end: the admin onboards a teacher, a teacher approves a pending student, marks attendance, assigns a one-off and a recurring homework item with a reference link, the student marks it done, the teacher reviews it, and the student's streak, badges, and team-leaderboard position update correctly. Iteration afterward is driven by real teacher feedback, not further speculation. For the parent role: the share of homework marked Done by its due date rises compared with the term before parent accounts, without a growing gap between Done and Reviewed.

## Assumptions

- Assumed a single admin role/account model for v1 — the source describes one admin view with no multi-admin delegation or admin-of-admins concerns.
- Session times are Munich local time (Europe/Berlin); no multi-timezone support.
- The app is not yet in use by real families, so no students or notes need migrating when the parent role ships.
- Streaks stay weekly: if a class meets on more than one day in a week, attending any session that week qualifies.
- An unanswered session is shown as "not answered" and treated as expected; no reason is collected for leave.
- Removing a class day cancels every class session on that day.

## Open Questions

- Badge milestone step size (every 5 vs. every 10 attendances/homework-done) is explicitly left unresolved in the source — needs confirmation once building.
- GDPR-specific obligations (a go-live precondition for the parent role; owner not assigned) beyond the described consent-at-registration and admin-approved-deletion flow (data controller identity, retention limits, breach notification) are unaddressed, and this app stores EU minors' personal data — needs a compliance decision before real student data is stored. Sharper now that the app stores a parent account per family (an adult's name and email) and shows teacher notes to parents.
- Should students be notified (push/email) when a session is moved or cancelled, or is in-app display enough for v1?
- Can a parent set leave for a date range (e.g. a three-week holiday), or only per session?
- Should the app warn when a student enrolled in two classes has overlapping sessions?
- Is calendar export or sync (iCal, Google Calendar) wanted, or in-app only?
- Leave is visible to the student's team across classes (nickname + Coming/On leave only; Sick shown as On leave). Confirm this fits the minimize-data-on-minors constraint.
- What happens to a parent account when all its linked children are deleted or leave the school?
- Planned-leave edge cases: flipping On leave → Coming → On leave, sessions added or moved inside the notice period, and whether changing the notice period reclassifies earlier leave.
- How does a parent regain access after losing access to their email?
- Should a parent see a homework's content? Today the parent sees its title, due date, status, and reference links, not the content the teacher wrote.
- Should the syllabus text be required, as homework content is? It is optional for now.
