---
title: "PRD: Parent Role — tib-class"
status: draft
created: 2026-09-26
updated: 2026-09-26
---

# PRD: Parent Role — tib-class

## 1. Vision

Sherab gives the Munich Tibetan Sunday school's volunteer teachers and students a shared record of progress, homework, and class sessions. What it does not yet do is reach the people who are with the child the other six days of the week. Today homework lives only on the student's own account: a child can skip an assignment and no parent ever finds out, because parents have no way to see it.

The school meets roughly 40 times a year. In a teacher meeting the conclusion was plain: with so little class time, the school cannot succeed without parents supporting practice at home. A **Parent** account closes that gap. A parent signs in, picks one of their children, and immediately sees what is pending or overdue — plus the rest of that child's class record — so they can step in during the week instead of discovering the gap on Sunday.

The Parent role is deliberately read-only. Parents guide their child; they do not complete work on the child's behalf. The student still marks their own homework Done and owns their own streak. A parent can take exactly two actions: mark their child Coming or On leave for an upcoming session, so teachers and the admin know who will be in class that weekend; and request deletion of their child's data, which still goes through the admin's approval.

### Why now
V1 deliberately deferred a parent login. Running it with real classes, teachers concluded that parental support is essential given only ~40 sessions a year — so parent visibility moves from "future phase" to the next increment.

## 2. Target User

**Parent** — the one adult per family who signs up, typically the parent who handles the school's communication. Non-technical; uses a family phone.

### 2.1 Jobs To Be Done
- Know, without asking my child, whether this week's homework is done or overdue.
- Tell the teacher ahead of time when my child won't be in class.
- Stay in control of my child's data (request deletion).

### 2.2 Key User Journeys

- **UJ-1. Dolma gets her parent account when the family joins the school.**
  When Dolma signs her children up with the Munich Sunday school group, the organizer tells her to register as a parent first. She registers with her email, confirms it, and is approved by the Admin — usually within a day, never more than a week. Only then do Tenzin (9) and Pema (6) register with her email; they skip the email confirmation, and their teacher approves them. They appear on Dolma's landing page, first as "Waiting for approval", then with full details.
  **Edge case:** Tenzin tries to register before Dolma is approved and sees "no parent account found — check the email, or ask your parent to register first."

- **UJ-2. Dolma checks on the kids mid-week.**
  On a weekday evening Dolma opens the app and sees one card per child with open and overdue homework counts. Tenzin's card shows one overdue item. She opens it, sees the homework, its status, and the teacher's note, and talks to Tenzin about it. She cannot mark anything Done for him — he does that himself.

- **UJ-3. Dolma plans leave for a family trip.**
  The family is travelling in a month. Dolma opens each child's upcoming sessions and marks them On leave more than two weeks ahead, so the teacher knows and the children's streaks are protected.
  **Edge case:** Pema falls sick on Saturday. Dolma marks Sick leave; the teacher approves it, and Pema's streak is protected even though the notice was short.

## 3. Glossary

- **Parent** — An adult account holder responsible for one or more Students. One Parent account per family. Read-only access to Linked Children, except setting Session Leave and submitting Deletion Requests.
- **Parent Email** — The email the Parent registers with. Unique per Parent.
- **Guardian Email** — The email a Student supplies at registration. Must belong to an approved Parent; the join key to that Parent.
- **Linked Child** — A Student whose Guardian Email equals an approved Parent's Parent Email. A Parent has one or more Linked Children over time; a Student has exactly one Parent.
- **Parent Approval** — Admin action that activates a Pending Parent account.
- **Selected Child** — The Linked Child whose details the Parent is currently viewing.
- **Guardian Email Change Request** — A Student-initiated request to correct their Guardian Email, approved by the Admin.
- **Session Leave** — A Linked Child's Coming / On leave answer for one upcoming Session (existing CAP-11 concept); set only by the Student's Parent (the Student can see it but no longer set it).
- **Leave Notice Period** — Admin-configurable minimum notice (default 2 weeks) for On leave to count as Planned Leave.
- **Planned Leave** — On leave set at least the Leave Notice Period before the Session; protects the Streak.
- **Short-Notice Leave** — On leave set later than the Leave Notice Period; recorded, but consumes one grace week.
- **Sick Leave** — Leave marked Sick by the Parent up to the end of the day after the Session; protects the Streak only if a Teacher approves it.
- **Child Summary** — The per-child card on the Parent's landing page showing pending and overdue Homework counts.
- **Deletion Request** — Existing request type (CAP-8) to erase a Student's data; a Parent may now also submit one for a Linked Child.
- Existing terms (Student, Teacher, Admin, Pending, Class, Homework, Done, Reviewed, Overdue, Session, Streak, Badge, Team) keep their meaning from `specs/spec-class-tracker/SPEC.md`.

## 4. Features

### 4.1 Parent Registration & Linking

**Description:** Parents come first. A Parent registers themselves with an email and password, confirms the email, and waits in a Pending state until the Admin approves them. Only an approved Parent's email can be used as a Guardian Email when a Student registers. Because the Parent Email is already verified, the Student's registration skips the Guardian Email confirmation step; the guardian consent step is still shown. Every Student whose Guardian Email equals the Parent Email is a Linked Child. Families share a single Parent account; there is no second-parent account in this increment. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Parent self-registration

A visitor can register as a Parent with an email and password.

**Consequences (testable):**
- A new Parent account starts Pending and cannot see any Student data.
- The Parent must confirm their email before the Admin can approve them.
- A Parent Email already used by another Parent account is refused.

#### FR-2: Admin approves or rejects Parents

The Admin (only) can approve or reject a Pending, email-confirmed Parent.

**Consequences (testable):**
- Approval is blocked until the Parent has confirmed their email; rejection is always available.
- The Admin decides by recognizing the family. [ASSUMPTION: no Student can exist yet to match against, so there is no automated check.]
- Teachers cannot see or act on Parent registrations.
- A rejected Parent can submit a new registration with the same email.

#### FR-3: Student registration requires an approved Parent

A Student can register only with a Guardian Email that belongs to an approved Parent.

**Consequences (testable):**
- If the Guardian Email matches no approved Parent, registration stops with a message: no parent account was found; check the email is correct, or ask your parent to register first.
- A Parent who is registered but still Pending (or unconfirmed) counts as "not found".
- When the Guardian Email matches an approved Parent, no Guardian Email confirmation is sent; the registration goes straight to the teacher approval queue as verified.
- The guardian consent step is still shown and required.
- Several siblings can register with the same Guardian Email, including while more than one is Pending.
- Teacher approval of the Student is unchanged and remains the guard against a false registration using a known Parent Email.

#### FR-4: Linking

A Student is a Linked Child of the Parent whose Parent Email equals the Student's Guardian Email.

**Consequences (testable):**
- A Pending Linked Child appears to the Parent marked as pending approval; an approved child appears with full details (§4.2).
- A rejected Student no longer appears.

#### FR-5: Guardian Email correction

A Student can submit a Guardian Email Change Request; the Admin approves or rejects it.

**Consequences (testable):**
- The new value must belong to an approved Parent.
- On approval, the Student moves from the old Parent to the new one.
- The Guardian Email never changes without a recorded Admin approval.

**Out of Scope:**
- Multiple Parent accounts per Student.
- Teacher approval of Parents.
- Student registration without a Parent account.

### 4.2 Child Overview & Details

**Description:** After login the Parent lands on a page with one Child Summary per Linked Child, showing at a glance how much Homework is pending and overdue. Choosing a child opens that child's details. Everything is read-only; the Parent cannot mark Homework Done, change statuses, or act on the child's behalf. Realizes UJ-2.

**Functional Requirements:**

#### FR-6: Child Summary landing

An approved Parent sees one Child Summary per Linked Child.

**Consequences (testable):**
- Each card shows the child's name, class, number of open Homework items, and number of Overdue items.
- Overdue items are visually highlighted.
- A Pending Linked Child shows "Waiting for approval" and no details.
- A Parent with a single Linked Child still sees the card (one tap to details). [ASSUMPTION]

#### FR-7: Child details

A Parent can open a Linked Child and view:

- Homework — open, Overdue, Done, and Reviewed, with due dates; reference links open externally.
- Attendance history.
- Skill status per skill area, with full history.
- Teacher notes on the child. Teacher notes are written for the Parent; the teacher-side label should say so.
- Streak and Badges.
- The child's Team and the team leaderboard (same view the child has).
- Upcoming class Sessions with actual start time and duration, and the child's Session Leave answers.
- The Teachers assigned to the child's class.

**Consequences (testable):**
- The Parent sees exactly what the child can see about themselves, plus attendance history, skill status, and teacher notes.
- The Parent sees no other Student's personal details beyond what the leaderboard already shows the child.
- No control on the page lets the Parent change Homework, attendance, skills, or notes.

### 4.3 Session Leave by Parent

**Description:** Session Leave moves from the Student to the Parent, and becomes stricter about protecting the Streak. The Parent marks a Linked Child Coming, On leave, or Sick for an upcoming Session so teachers and the Admin know who is coming this weekend; the Student sees the answer but can no longer set it. Leave protects the Streak only when it is Planned Leave (set at least the Leave Notice Period ahead, default 2 weeks) or Sick Leave approved by a Teacher. Any other leave is still recorded and visible, but that week consumes one grace week, exactly like an unannounced absence. This changes CAP-11 and the streak rules in `gamification.md`. Realizes UJ-3.

#### FR-8: Parent sets Session Leave

A Parent can set Coming or On leave for any upcoming Session of a Linked Child.

**Consequences (testable):**
- The answer is visible to the same people as today (the class's Teachers, the Admin, classmates, and the child's Team).
- The Student sees their Session Leave answers read-only; the Student-side control is removed.
- The Parent can change an answer any number of times until the Session starts.

#### FR-9: Planned vs short-notice leave

The system classifies On leave as Planned Leave or Short-Notice Leave by when it was set.

**Consequences (testable):**
- On leave set at least the Leave Notice Period before the Session start is Planned Leave and does not consume Streak grace.
- On leave set later is Short-Notice Leave: still recorded and shown to Teachers, but the week consumes one grace week.
- The Leave Notice Period is admin-configurable without a code change; default 2 weeks.
- The Parent sees, before saving, whether the leave will count as Planned or Short-Notice.
- Changing a Planned Leave's date re-evaluates it against the Leave Notice Period at the new time of setting. [ASSUMPTION]

#### FR-10: Sick Leave with Teacher approval

A Parent can mark a Linked Child Sick for a Session, from any time before it until the end of the day after it; a Teacher of the class approves or rejects it.

**Consequences (testable):**
- Approved Sick Leave does not consume Streak grace, regardless of notice.
- Rejected Sick Leave consumes one grace week.
- While pending, Sick Leave does not yet protect the Streak. [ASSUMPTION: the streak is recalculated when the Teacher decides.]
- No reason or medical detail is collected (minimize data on minors). [ASSUMPTION]
- Any Teacher assigned to the class can decide; the Admin can too, as backup. [ASSUMPTION]

### 4.4 Deletion Request by Parent

#### FR-11: Parent requests data deletion

A Parent can submit a Deletion Request for a Linked Child.

**Consequences (testable):**
- The request enters the existing Admin review queue (CAP-8), recorded as submitted by the Parent.
- Nothing is erased without Admin approval.
- After deletion the child no longer appears on the Parent's landing page. [ASSUMPTION: the Parent account itself remains.]

### 4.5 Parent Profile

#### FR-12: My Profile

A Parent has a My Profile page like the Teacher's.

**Consequences (testable):**
- The Parent can edit their display name and change their password.
- The Parent Email is shown read-only. [ASSUMPTION: changing it would break every link; out of scope.]
- The page supports German, English, and Tibetan like the rest of the app.
