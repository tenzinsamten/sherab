# Munich Tibetan Sunday School — Class Tracker
### Idea & Requirements Document (v1.3 — ready to build)

---

## 1. Problem & goal

The Sunday school runs weekly classes in Tibetan language, song, and dance, taught by volunteer teachers. Today progress, homework, and continuity between weeks likely live in teachers' heads or scattered notes. The goal is a lightweight app that:

- Lets teachers track each student's progress and assign/review homework
- Gives kids a motivating way to see their own progress (streaks, badges, team leaderboard)
- Survives teacher turnover — a new volunteer can pick up where the last one left off

**Non-goal (for now):** replacing in-class teaching, video lessons, or a public/marketing website for the school.

---

## 2. Stakeholders & roles

| Role | Who | Core need |
|---|---|---|
| Admin / head organizer | Likely you, or whoever runs the school | Full visibility across all classes and teachers |
| Teacher | Volunteer, usually one per class/age group | Update their own students' status, assign & review homework |
| Student | Kids attending | Register, see streak/badges/leaderboard, mark homework done |

**Future phase:** a parent view (separate login, visibility into their child's progress/homework) is deferred. For v1, any parent involvement happens informally through the student's own device/account.

---

## 3. Functional requirements

### 3.1 Accounts & registration
- **Teachers:** created only by the admin (no self-registration). A teacher's account is **verified by the admin** before it's active — admin assigns each verified teacher to their class(es). **A class can have more than one teacher, and one teacher can be assigned to multiple classes** (many-to-many).
- **Students:** self-register with a name + class code, but the account starts in a **Pending** state — not active, not visible on any roster or leaderboard, can't yet log progress.
  - Registration includes a **consent step** (parental/guardian consent for a minor's data being processed) before the request goes to the teacher for approval
  - The **class's own teacher(s)** review and approve/reject pending registrations for their class — any teacher assigned to that class can act on it.
  - The **admin acts as backup** — can approve/reject for any class, useful if a teacher is unavailable or a registration looks off.
  - This guards against duplicate/dummy sign-ups (e.g. random or joke entries) before a student can appear in the system.
  - Rejected/unrecognized entries should be easy to clear out.
- Each approved student picks a nickname/avatar for day-to-day use.

### 3.2 Roster & skill tracking
- **Visibility is scoped to class, not to teacher:** a teacher sees and can edit the roster, statuses, and homework for every class they're assigned to. If a class has multiple teachers, all of them see and can edit the same roster — visibility follows the class, not a single owning teacher. Teachers still cannot see a class they're not assigned to.
- **Attendance:** teacher marks each student present/absent per Sunday — feeds directly into streaks (3.4)
- Per student, per skill area (language, song, dance): a status — Not started / Learning / Confident
- Teacher can update status any time; history is kept (not just current state) so a substitute teacher has context
- Free-text notes per student per week (optional)
- Only the admin has cross-class visibility (see 3.7)

### 3.3 Homework

**Creating an assignment** (teacher, scoped to their own class)
- Title / instructions (e.g. "Write ཀ-ཁ-ག-ང ten times")
- Skill area: language / song / dance
- Assigned to: whole class, or a chosen subset of students (e.g. only the ones behind on a topic)
- Due date: default "next Sunday", but should support a longer window (e.g. "in two weeks") for bigger tasks
- **Optional reference link(s):** a website, YouTube video, or audio/song link the teacher attaches to the task — student taps it and is redirected straight to the source (e.g. the recording of the song they need to memorize, a video demonstrating the dance step)
  - Simple v1 version: one or more URLs pasted in, shown as a plain "Open reference" link/button — no embedded player or in-app viewer needed at this stage
  - Multiple links per assignment should be supported (e.g. one video + one audio clip)
  - No validation/preview check on the link is needed — since only admin-verified teachers can create assignments, trust is already established at the account level
- **Recurring assignments (in v1):** a teacher can create a task as recurring (e.g. "practice this week's song for 10 minutes"), set a repeat cadence (weekly is the main case), and it auto-generates a new instance each period without the teacher re-creating it.
  - The teacher sets it up once — series continues until the teacher pauses/ends it
  - Each generated instance has its own independent Done/Reviewed status per student — completing one week's instance doesn't mark future weeks done
  - The teacher can edit the series (change title, links, due-date offset) going forward, or end it entirely; past instances are untouched by edits
  - On the roster/teacher assignment views, a recurring assignment is visually distinguishable from a one-off (e.g. a repeat icon), so it's clear which task will reappear next week

**Student side**
- Sees their own open homework list (from their class only), grouped by due date or skill
- Any reference link on a task is shown as a tappable "Open reference" action, opening in a new tab/browser rather than embedded in-app
- Marks each item **Done** themselves during the week
- No proof required by default (self-report, low friction) — a photo/audio attachment is a possible future option if teachers find self-report unreliable, not v1

**Review workflow (states)**
- `Assigned` → `Done` (student self-reports) → `Reviewed` (teacher confirms in class, e.g. checks the writing or hears the recitation)
- A teacher can also mark something done on a student's behalf (e.g. if a young child can't use the app themselves)
- `Done` is enough to count toward a streak (3.4); `Reviewed` still matters separately for skill-status history (a teacher's actual assessment of mastery), so the two states serve different purposes

**Teacher's view of an assignment**
- Per-assignment: how many of the class have marked it Done, how many Reviewed, who hasn't started
- Quick per-student toggle to review/confirm without opening each student individually (as prototyped)

**Overdue / follow-up**
- Assignments past their due date and still not Done stay visible indefinitely, flagged as overdue — they only disappear if the teacher explicitly archives them. Nothing silently expires.

**Relationship to streaks**
- Streak counts key off homework **marked Done by the student** (reviewed status is not required to keep a streak alive) — combined with attendance (see 3.4)

**Future homework visibility**
- v1: a student can see one week ahead — the currently open instance plus next week's, nothing further out
- Kept configurable in the data model (a "look-ahead window") so this can later be widened (e.g. to a month) without a structural change, once there's a reason to

### 3.4 Streaks
- Tracks consecutive weeks with **both** attendance and homework marked Done — a streak week requires showing up and marking the week's homework done (reviewed status not required)
- **Grace period:** a streak survives up to **2 missed weeks by default**, configurable by the admin (not hardcoded), so the rule can be tuned without a code change

### 3.5 Badges
- **v1 badge criteria: attendance count and homework count, awarded in increments** — e.g. a badge at 5 classes attended, another at 10, another at 15, and the same milestone pattern for homework count (5 done, 10 done, 15 done…). Exact step size (5 vs. 10) to confirm once building.
- Visible on the student's own profile; not ranked against others

### 3.6 Leaderboard
- Team-based (e.g. 3 house-style teams), not individual ranking
- **Teams are fixed for the school year** — no reshuffling mid-year
- **Assignment is manual, by the teacher** — no auto-balancing or randomization. A teacher places their own students into a team when approving/onboarding them.
- **Mid-year joins:** if a new student joins partway through the year, the teacher decides which team they go into (no automatic rule)
- Ranked by combined streaks (or another agreed metric), so it rewards consistency over "who knows most"
- Only visible within the school, not public

### 3.7 Admin view
- Creates and manages teacher accounts, assigns each teacher to their class(es)
- Approves (or rejects) pending student registrations as **backup** to the class's own teacher — steps in for any class, e.g. if a teacher is unavailable or a registration looks suspicious
- Cross-class visibility: all teachers, all students, overall homework completion — the only role that sees across classes
- Reviews and actions data deletion requests (see section 4) — the human approval step before any student's data is erased
- (Maybe) simple way to onboard a new teacher with structured materials — carried over from the earlier "institutional memory" idea, may be a later phase

### 3.8 Future / explicitly out of scope for v1
- **Duolingo-style structured learning module** (lesson sequencing, exercise types, spaced repetition, adaptive difficulty, speech recognition) — a much larger effort requiring real curriculum authoring, not just engineering. Kept separate from this app for now.
  - The lighter version of this idea — reference links on homework (3.3) — is in scope for v1 and covers most of the immediate need at a fraction of the effort.

---

## 4. Non-functional requirements

- **Privacy for minors:** minimize data collected on kids — nickname + progress, no unnecessary personal info; no public-facing leaderboard or profile. Parental/guardian consent is captured at registration (3.1), before an account goes active.
- **Data deletion:** a student (or their account) can submit a data deletion request from within the app. This goes to the admin as a request to review — it is **not automatic**. Once the admin approves it, all of that student's data (profile, progress history, homework records) is deleted. A human always confirms before deletion happens.
- **Ownership:** the Munich Tibetan group owns the app and its data long-term, not any individual — relevant for hosting account ownership, domain, and admin access continuity
- **Language:** UI supports German, English, and Tibetan
- **Device access:** confirmed — students have reliable access to a phone/tablet, so no paper/offline fallback needed for homework or streak tracking
- **Low friction:** works on whatever phone/tablet a family already has; no app-store install required (PWA) if possible
- **Low cost:** ideally free/near-free to run given this is a volunteer-run school (e.g. Firebase/Supabase free tier)
- **Multi-teacher concurrency:** two teachers editing at once shouldn't clobber each other's updates
- **Offline-friendly:** classroom wifi may be unreliable; updates should queue and sync when back online (nice-to-have, not day-one)
- **Simple enough for non-technical volunteer teachers** to use without training

---

## 5. Approach

Build v1 directly from this spec rather than a formal requirement-gathering round with the other teachers first — get a working version in front of them, then take their suggestions and iterate from real feedback rather than speculation.

All open questions from earlier drafts are now resolved. This spec is ready to move into a data model / architecture pass.
