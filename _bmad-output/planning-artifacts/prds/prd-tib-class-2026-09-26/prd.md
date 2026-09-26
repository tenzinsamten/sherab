---
title: "PRD: Parent Role — tib-class"
status: final
created: 2026-09-26
updated: 2026-09-26
---

# PRD: Parent Role — tib-class

## 0. Document Purpose

**Status:** Ready for architecture, UX, and stories. Go-live is blocked on Open Question 1 (GDPR). The app isn't in use by real families yet, so there's no data to migrate.

This PRD adds a Parent role to Sherab, the Munich Tibetan Sunday school class tracker. It builds on the existing contract in `_bmad-output/specs/spec-class-tracker/` (SPEC.md and companions), the architecture spine, and the UX design, and doesn't repeat them. It's written for the maintainer and for downstream work: the architecture update, UX, and stories. §3 fixes the vocabulary, §4 lists features with globally numbered FRs, and §5 lists the spec changes this PRD requires. Technical notes are in `addendum.md`. Assumptions inferred during drafting in FR-2, FR-6, FR-10, FR-11, FR-12, SM-1, SM-2, and SM-C1 were confirmed by the product owner on 2026-09-26.

## 1. Vision

Sherab gives the Munich Tibetan Sunday school's volunteer teachers and students a shared record of progress, homework, and class sessions. It doesn't yet reach the people who are with the child the other six days of the week. Today homework lives only on the student's own account, so a child can skip an assignment and no parent ever finds out.

V1 deliberately deferred a parent login. But the school meets only about 40 times a year, and in a teacher meeting the conclusion was plain: with so little class time, the school can't succeed without parents supporting practice at home. A **Parent** account closes that gap. A parent signs in, picks one of their children, and immediately sees which homework is open or overdue, plus the rest of that child's class record. They can step in during the week instead of discovering the gap on Sunday.

The Parent role is deliberately read-only. Parents guide their child; they don't complete work on the child's behalf. The student still marks their own homework Done and owns their own streak. A parent can take exactly two actions:

- Mark their child Coming, On leave, or Sick for a session, so teachers and the admin know who will be in class that weekend.
- Request deletion of their child's data, which still needs the admin's approval.

### Why stricter leave

The same teacher meeting flagged last-minute cancellations. Teachers plan each session around who's coming, so leave announced late disrupts that planning. Streaks therefore reward leave that's announced early (§4.3).

## 2. Target User

**Parent**: the one adult per family who signs up, typically the parent who handles the school's communication. Non-technical; uses a family phone.

### 2.1 Jobs To Be Done

- Know, without asking my child, whether this week's homework is done or overdue.
- Tell the teacher ahead of time when my child won't be in class.
- Stay in control of my child's data.

### 2.2 Key User Journeys

- **UJ-1. Dolma gets her parent account when the family joins the school.**
  When Dolma signs her children up with the Munich Sunday school group, the organizer tells her to register as a parent first. She registers with her email, confirms it, and the Admin approves her, usually within a day and never more than a week later. Only then do Tenzin (9) and Pema (6) register with her email. They skip the email confirmation, and their teacher approves them. They appear on Dolma's landing page, first as "Waiting for approval", then with full details.
  **Edge case:** Tenzin tries to register before Dolma is approved and sees "No parent account found. Check the email, or ask your parent to register first."

- **UJ-2. Dolma checks on the kids mid-week.**
  On a weekday evening Dolma opens the app and sees one card per child with open and overdue homework counts. Tenzin's card shows one overdue item. She opens it, sees the homework, its status, and the teacher's note, and talks to Tenzin about it. She can't mark anything Done for him; he does that himself.

- **UJ-3. Dolma plans leave for a family trip.**
  The family is traveling in a month. Dolma opens each child's upcoming sessions and marks them On leave more than two weeks ahead, so the teacher knows and the children's streaks are protected.
  **Edge case:** Pema gets sick on Saturday. Dolma marks her Sick, the teacher approves it, and Pema's streak is protected even though the notice was short.

## 3. Glossary

- **Parent**: An adult account holder responsible for one or more Students. One Parent account per family.
- **Parent Email**: The email the Parent registers with. Unique per Parent.
- **Guardian Email**: The email a Student supplies at registration; the key that links the Student to a Parent.
- **Linked Child**: A Student whose Guardian Email equals an approved Parent's Parent Email. A Parent has one or more Linked Children over time; a Student has exactly one Parent.
- **Parent Approval**: The Admin action that activates a Pending Parent account.
- **Selected Child**: The Linked Child whose details the Parent is currently viewing.
- **Guardian Email Change Request**: A Student's request to correct their Guardian Email.
- **Session Leave**: A Linked Child's answer for one Session: Coming, On leave, Sick, or not answered. Extends the existing CAP-11 concept. Sick has a decision state: pending, approved, or rejected.
- **Leave Notice Period**: The minimum notice for On leave to count as Planned Leave. Admin-configurable; default 2 weeks.
- **Planned Leave**: On leave set at least the Leave Notice Period before the Session.
- **Short-Notice Leave**: On leave set later than the Leave Notice Period allows.
- **Sick Leave**: Session Leave with the answer Sick.
- **Child Summary**: The per-child card on the Parent's landing page.
- **Open Homework**: Homework assigned to the child that isn't Done and isn't archived. "Pending" is used only for account and approval states.
- **Deletion Request**: The existing request type (CAP-8) to erase a Student's data.
- Existing terms (Student, Teacher, Admin, Pending, Class, Homework, Done, Reviewed, Overdue, Session, Streak, Badge, Team) keep their meaning from `specs/spec-class-tracker/SPEC.md`.

## 4. Features

### 4.1 Parent Registration & Linking

**Description:** Parents register first and are approved by the Admin. Students then register with an approved Parent's email, which links them to that Parent. One Parent account per family. Realizes UJ-1.

#### FR-1: Parent self-registration

A visitor can register as a Parent with an email and password.

**Consequences (testable):**
- A new Parent account starts Pending and can't see any Student data.
- The Parent must confirm their email before the Admin can approve them.
- A Parent Email already used by an approved or Pending Parent is refused.
- A Teacher or the Admin can hold the Parent role on the same login. The Parent role still needs its own Admin approval, and the person switches between roles in the app.

#### FR-2: Admin approves or rejects Parents

Only the Admin can approve or reject a Pending, email-confirmed Parent.

**Consequences (testable):**
- Approval is blocked until the Parent confirms their email; rejection is always available.
- The Admin decides by recognizing the family. No Student exists yet to match against, so there's no automated check.
- Teachers can't see or act on Parent registrations.
- A rejected Parent can submit a new registration with the same email.

#### FR-3: Student registration requires an approved Parent

A Student can register only with a Guardian Email that belongs to an approved Parent.

**Consequences (testable):**
- If the Guardian Email matches no approved Parent, registration stops with the message: "No parent account found. Check the email is correct, or ask your parent to register first."
- A Parent who is registered but still Pending or unconfirmed counts as not found.
- When the Guardian Email matches an approved Parent, no Guardian Email confirmation is sent. The registration goes straight to the teacher approval queue as verified.
- The guardian consent step is still shown and required.
- Several siblings can register with the same Guardian Email, including while more than one is Pending.
- Teacher approval of the Student is unchanged and remains the guard against a false registration that uses a known Parent Email.
- The "No parent account found" message reveals whether an email belongs to a Parent. This is an accepted risk for an internal school app.

#### FR-4: Linking

A Student is a Linked Child of the Parent whose Parent Email equals the Student's Guardian Email.

**Consequences (testable):**
- A Pending Linked Child appears to the Parent as waiting for approval; an approved child appears with full details (§4.2).
- A rejected Student no longer appears.

#### FR-5: Guardian Email correction

A Student can submit a Guardian Email Change Request, and the Admin approves or rejects it.

**Consequences (testable):**
- The new value must belong to an approved Parent.
- On approval, the Student moves from the old Parent to the new one.
- The Guardian Email never changes without a recorded Admin approval.

### 4.2 Child Overview & Details

**Description:** After signing in, the Parent lands on a page with one Child Summary per Linked Child, showing at a glance how much Homework is open and overdue. Choosing a child opens that child's details. Everything is read-only: the Parent can't mark Homework Done, change statuses, or act on the child's behalf. Realizes UJ-2.

#### FR-6: Child Summary landing

An approved Parent sees one Child Summary per Linked Child.

**Consequences (testable):**
- Each card shows the child's name, every class they're enrolled in, the number of Open Homework items, and the number of Overdue items.
- Overdue items are visually highlighted.
- A Pending Linked Child shows "Waiting for approval" and no details.
- A Parent with a single Linked Child still sees the card, one tap from the details.

#### FR-7: Child details

A Parent can open a Linked Child and view:

- Homework (open, Overdue, Done, and Reviewed) with due dates; reference links open externally.
- Attendance history.
- Skill status per skill area, with full history.
- Teacher notes on the child. Teacher notes are written for the Parent: the notes field on the teacher side reads "Visible to the student's parent", and teachers shouldn't name other children in them.
- Streak and Badges.
- The child's Team and the team leaderboard, as the child sees them.
- Upcoming class Sessions with their actual start time and duration, and the child's Session Leave answers.
- The Teachers assigned to the child's classes.

**Consequences (testable):**
- The Parent sees exactly what the child can see about themselves, plus attendance history, skill status, and teacher notes.
- The Parent sees no other Student's personal details beyond what the leaderboard already shows the child.
- No control on the page lets the Parent change Homework, attendance, skills, or notes.

### 4.3 Session Leave by Parent

**Description:** Session Leave moves from the Student to the Parent and becomes stricter about protecting the Streak. The Parent marks a Linked Child Coming, On leave, or Sick for a Session so teachers and the Admin know who's coming this weekend. The Student sees the answer but can no longer set it. Leave protects the Streak only when it's Planned Leave or Sick Leave that a Teacher approves. Any other leave is still recorded and visible, but that week consumes one grace week, exactly like an unannounced absence. This changes CAP-11 and the streak rules in `gamification.md`. Realizes UJ-3.

#### FR-8: Parent sets Session Leave

A Parent can set Coming, On leave, or Sick for a Session of a Linked Child.

**Consequences (testable):**
- The class's Teachers, the Admin, and the Parent see the full answer. Classmates and the child's Team see Sick as "On leave", never as Sick.
- The Student sees their Session Leave answers read-only; the Student-side control is removed.
- Coming and On leave can be changed any number of times until the Session starts. Sick can be set until the end of the day after the Session (FR-10).

#### FR-9: Planned vs. Short-Notice Leave

The system classifies On leave as Planned Leave or Short-Notice Leave by when it was set.

**Consequences (testable):**
- On leave set at least the Leave Notice Period before the Session starts is Planned Leave and doesn't consume Streak grace.
- On leave set later is Short-Notice Leave. It's still recorded and shown to Teachers, but the week consumes one grace week.
- The Admin can change the Leave Notice Period without a code change; the default is 2 weeks.
- Before saving, the Parent sees whether the leave will count as Planned or Short-Notice.

#### FR-10: Sick Leave with Teacher approval

A Parent can mark a Linked Child Sick for a Session any time before it, up to the end of the day after it. A Teacher of the class approves or rejects it.

**Consequences (testable):**
- Approved Sick Leave doesn't consume Streak grace, regardless of notice.
- Rejected Sick Leave consumes one grace week.
- Pending Sick Leave doesn't protect the Streak yet.
- Any Teacher assigned to that Session's class can decide; the Admin can too, as backup.
- Sick Leave that isn't decided within 2 weeks is approved automatically.
- When the decision or auto-approval happens, the child's Streak is recalculated for that week.
- No reason or medical detail is collected.

### 4.4 Deletion Request by Parent

**Description:** A Parent can ask for a Linked Child's data to be erased, using the existing Admin-approved deletion flow.

#### FR-11: Parent requests data deletion

A Parent can submit a Deletion Request for a Linked Child.

**Consequences (testable):**
- The request enters the existing Admin review queue (CAP-8), recorded as submitted by the Parent.
- Nothing is erased without Admin approval.
- After deletion, the child no longer appears on the Parent's landing page. The Parent account itself remains.

### 4.5 Parent Profile

**Description:** A Parent has a My Profile page like the Teacher's.

#### FR-12: My Profile

A Parent can manage their own account details.

**Consequences (testable):**
- The Parent can edit their display name and change their password.
- A Parent who forgets their password uses the existing forgot-password flow, as Teachers do.
- The Parent Email is shown read-only.
- The page supports German, English, and Tibetan like the rest of the app.

## 5. Changes to the Existing Spec

This PRD overrides parts of the current contract. When it's finalized, update these files:

**`SPEC.md`**
- **Non-goals:** remove "Parent-facing login/view — deferred".
- **CAP-1:** a Student can register only with an approved Parent's email, and the Guardian Email confirmation step is dropped in that case (FR-3). The Admin gains Parent approval (FR-2).
- **CAP-2:** teacher notes are written for the Parent and are visible to them (FR-7).
- **CAP-4:** leave protects the Streak only as Planned Leave or approved Sick Leave. Short-Notice Leave and rejected Sick Leave consume one grace week. New admin setting: Leave Notice Period (FR-9, FR-10).
- **CAP-8:** a Parent can also submit a Deletion Request (FR-11).
- **CAP-11:** only the Parent sets Session Leave, which gains a Sick option (FR-8, FR-10).
- **Constraints:** "Student registration requires … a confirmed guardian email" becomes "requires an approved Parent's email" (FR-3).
- **Assumptions:** "Leave protects a streak only when set before the session starts" gains the Sick Leave exception and the Leave Notice Period (FR-9, FR-10).
- **Open Questions:** date-range leave becomes more relevant (UJ-3's multi-week trip).

**`calendar.md`**
- The "Attendance intent" row changes from Student to Parent, and its states gain Sick.
- Visibility hides Sick from classmates and the Team (FR-8).

**`gamification.md`**
- Grace rules as in CAP-4 above (FR-9, FR-10).

**`roles-and-permissions.md`**
- Add the Parent role to the role table and remove "Parent view is a deferred future phase".
- Add Parent approval to the Admin's responsibilities.
- Allow one login to hold both a Teacher or Admin role and the Parent role (FR-1).

## 6. Non-Goals

- Notifications to Parents (email or push). Planned for a later stage.
- A second Parent account per family, or more than one Parent per Student.
- Parents marking Homework Done or acting for the child in any way besides Session Leave and Deletion Requests.
- In-app messaging between Parents and Teachers.
- Parents editing the child's profile, nickname, or avatar.
- Changing the Parent Email, because the email is what links every Linked Child.
- Teachers approving Parents.
- Student registration without a Parent account.

## 7. MVP Scope

**In scope:** FR-1 to FR-12, with all screens in German, English, and Tibetan.

**Out of scope:** everything in §6.

**Go-live precondition:** Open Question 1 (GDPR) is resolved.

## 8. Constraints & Privacy

- The app isn't in use by real families yet, so there are no existing Students or teacher notes to migrate. Test data is reset at release.
- Same platform as today: a low-cost PWA on family phones, with no app-store install.
- Must stay simple enough for non-technical parents to use without instructions.
- A Parent sees only their own Linked Children, and no other child's data beyond what the leaderboard already shows.
- The app now stores an adult's name and email per family. GDPR obligations are still open (§10, Open Question 1).
- No reason or medical detail is collected for Sick Leave.

## 9. Success Metrics

**Primary**
- **SM-1: More Homework Done.** The share of assigned Homework items marked Done by their due date, per class, compared with the term before Parent accounts. Target: an increase; no numeric target is set. Validates FR-6, FR-7.

**Secondary**
- **SM-2: Parent adoption.** The share of approved Students whose Parent signed in at least once in the last 2 weeks. Validates FR-1 to FR-4.
- **SM-3: Parent approval time.** The time from Parent email confirmation to the Admin's decision: usually within a day, never more than a week. Validates FR-2.

**Counter-metrics (don't optimize)**
- **SM-C1: Done without Reviewed.** A growing gap between Done and Reviewed may mean pressure to tick boxes rather than practice. Counterbalances SM-1.

## 10. Open Questions

1. **GDPR** for Parent data (an adult's name and email) and for teacher notes shown to Parents: data controller, retention, and legal basis. Go-live precondition: must be decided before real family data is stored. Owner: not yet assigned.
2. **Parent notifications**, such as a weekly overdue summary. Planned for a later stage; design them then.
3. What happens to a Parent account when all its Linked Children are deleted or leave the school?
4. **Planned Leave edge cases** (deferred): switching On leave → Coming → On leave; Sessions added or moved inside the Leave Notice Period; and whether changing the Leave Notice Period reclassifies earlier leave.
5. How does a Parent regain access after losing access to their email? Possibly with the Admin's help.
