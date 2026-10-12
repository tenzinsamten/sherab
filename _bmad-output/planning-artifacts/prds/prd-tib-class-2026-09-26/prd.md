---
title: "PRD: Parent Role — tib-class"
status: final
created: 2026-09-26
updated: 2026-10-10
---

# PRD: Parent Role — tib-class

## 0. Document Purpose

**Status:** Ready for architecture, UX, and stories. Go-live is blocked on Open Question 1 (GDPR). The app isn't in use by real families yet, so there's no data to migrate.

This PRD adds a Parent role to Sherab, the Munich Tibetan Sunday school class tracker. It builds on the existing contract in `_bmad-output/specs/spec-class-tracker/` (SPEC.md and companions), the architecture spine, and the UX design, and doesn't repeat them. It's written for the maintainer and for downstream work: the architecture update, UX, and stories. §3 fixes the vocabulary, §4 lists features with globally numbered FRs, and §5 lists the spec changes this PRD requires. Technical notes are in `addendum.md`. Assumptions inferred during drafting in FR-2, FR-6, FR-10, FR-11, FR-12, SM-1, SM-2, and SM-C1 were confirmed by the product owner on 2026-09-26.

**Extended on 2026-10-01:** §4.6 (FR-13 to FR-16) adds rich-text Homework Content and Syllabus with a Content Language. These requirements are for Teachers and Students, not the Parent role. They were reported by the product owner during manual verification (issues #72 to #75 in `_bmad-output/manual-verification-issues.md`), decided the same day, and are already built; this PRD records them because it is the project's only PRD. Their spec changes are listed in §5 and were applied to the spec files the same day.

**Extended on 2026-10-03:** §4.7 (FR-17) gives every Class and Team a name per interface language. It is for the Admin and for everyone who sees a Class or Team name, not only the Parent role. It was reported by the product owner (issue #76 in `_bmad-output/manual-verification-issues.md`), decided the same day, and is already built. §4.8 (FR-18), added the same day from issue #77 and also built, sets the font Tibetan text is shown in.

**Extended on 2026-10-10:** §4.9 to §4.14 (FR-19 to FR-27) record what was built from issues #81 to #95 between 2026-10-03 and 2026-10-08: Syllabus Sections and their PDF files, Homework notifications, email confirmation and sign-in help, a Student's PIN reset, the Help page, confirmation before actions that can't be undone, and the installable app. All of it was reported or asked for by the product owner and is already built. Five earlier statements changed with it and are marked where they stand: FR-2 (approval without a confirmed email), FR-16 (the Syllabus is now made of Sections), FR-18 (size of Tibetan text), and two Non-Goals in §6 (notifications, file attachments). The spec changes in §5 for this extension are listed but not yet applied to the spec files.

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
- **Homework Content**: The formatted text of a Homework that tells the Student what to do. Required. Replaces the earlier optional plain-text description.
- **Syllabus**: A Class's plan for one school year, written by its Teacher or the Admin as a list of Sections (since 2026-10-08; before that, one optional formatted text plus optional links). One per Class per school year.
- **Content Language**: The language a Homework or a Syllabus Section is written in: Tibetan, English, or German. It selects the font the text is shown in, independent of the viewer's interface language.
- **Section**: One titled part of a Syllabus, such as one song: a required title, optional formatted text in its own Content Language, optional links, and optional Section Files. A Syllabus has any number of Sections, in an order the Teacher sets.
- **Section File**: A PDF a Teacher or the Admin attaches to a Section. At most 5 per Section, at most 1 MB each.
- **Homework Notification**: A message the app sends to a phone or browser about Homework: New, Due soon, or Overdue.
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
- Approval is blocked until the Parent confirms their email; rejection is always available. Changed 2026-10-06 (FR-23): the Admin can approve a Parent whose email isn't confirmed, after a warning.
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

### 4.6 Homework Content & Syllabus

**Description:** A Teacher writes what a Homework asks for, and a Class's Syllabus, as formatted text in a chosen language. Before this, Homework had an optional plain-text description of at most 2000 characters and a Syllabus had plain text of at most 5000. Neither had a language, so Tibetan text was shown in the Tibetan font only to a viewer whose interface was set to Tibetan. Added 2026-10-01; not part of the Parent role.

#### FR-13: Homework Content is required

A Teacher must write Homework Content when creating or editing a Homework.

**Consequences (testable):**
- A Homework can't be saved without Homework Content. A text of only blank lines or spaces counts as empty, and the Teacher sees "Content is required."
- This applies to one-off and weekly Homework, on create and on edit.
- The Content field replaces the Description field and spans the full width of the form.
- When saving fails for any reason, what the Teacher typed stays in the form.
- A Homework created before this change shows its old description as its Homework Content, one paragraph per line. One that had no description has no content until a Teacher edits it, and that edit must add content.

#### FR-14: Formatting and length

Homework Content is formatted text with no length limit a Teacher can reach.

**Consequences (testable):**
- The Teacher can apply bold, italic, underline, two heading sizes, bullet lists, numbered lists, and links.
- A link in the text may lead only to a web address (http or https) or an email address (mailto), and opens externally.
- There is no character counter and no stated limit. A text far longer than the old 2000 characters saves.
- The Student sees the Homework Content with its formatting, exactly as the Teacher wrote it.
- Text a Teacher types is always shown as text. Typed markup is never run as part of the page.
- The reference links listed under a Homework are unchanged and stay separate from links inside the text.

#### FR-15: Content Language

The Teacher chooses the Content Language of a Homework, and it decides the font the Homework is shown in.

**Consequences (testable):**
- The choices are Tibetan, English, and German. The Teacher's interface language is preselected.
- The Homework Content is shown in the Content Language's font to every viewer, whatever their interface language. A Student with an English interface sees Tibetan Homework in the Tibetan font, and a Student with a Tibetan interface sees English Homework in the standard font.
- The Homework's title follows the same rule wherever Homework is listed or opened: for the Teacher, the Student, and the Parent.
- While the Teacher writes, the editing area uses the chosen language's font.
- The Content Language can be changed when the Homework is edited.
- A Homework created before this change is Tibetan if its title or description contains Tibetan script, otherwise English.

#### FR-16: Syllabus with formatting and Content Language

A Class's Syllabus is formatted text with a Content Language, like Homework Content.

**Consequences (testable):**
- The Teacher of the Class or the Admin writes the Syllabus with the same formatting tools as FR-14 and chooses its Content Language as in FR-15.
- The Syllabus text stays optional: a Syllabus may consist of links only, and clearing the text is allowed.
- There is no length limit a Teacher can reach. A text far longer than the old 5000 characters saves.
- The Syllabus is shown formatted and in its Content Language's font on the Teacher's and Admin's Syllabus pages and on the Student's class page. The one-line preview in the list of Syllabi follows the same font rule.
- A Syllabus written before this change keeps its text, one paragraph per line, and is Tibetan if that text contains Tibetan script, otherwise English.
- One Syllabus per Class per school year, as before.
- Changed 2026-10-08 (FR-19): the formatted text, the Content Language, and the links now belong to each Section of the Syllabus, not to the Syllabus as a whole. The rules above apply to a Section's text unchanged.

### 4.7 Class & Team Names

**Description:** A Class and a Team have a name in each interface language. Before this, each had one name, typed once by the Admin and shown unchanged under German, English, and Tibetan, and it couldn't be changed afterwards. Added 2026-10-03; not part of the Parent role.

#### FR-17: Class and Team names per language

The Admin gives a Class or a Team an English, a Tibetan, and (optionally) a German name; everyone sees the name of their interface language.

**Consequences (testable):**
- Creating a Class or a Team asks for three names. English and Tibetan are required: without either, nothing is created and the names typed so far are kept. German is optional.
- A viewer sees the name of their interface language wherever a Class or Team name appears (lists, page titles, breadcrumbs, the calendar, the leaderboard, requests, the join steps, the Parent's pages). Switching the interface language switches the names.
- Under the Tibetan interface language, dates, weekday names and numbers are in Tibetan: the Gregorian date in Tibetan words (`ཕྱི་ལོ་ ༢༠༢༦ ཟླ་ ༡༠ ཚེས་ ༣ གཟའ་སྤེན་པ`), not the Tibetan lunar calendar, and Tibetan digits (༠–༩) for counts, ranks, times and dates. Date and time input fields, and digits inside names, class codes and typed content, stay as they are (issue #80, 2026-10-03).
- The chosen interface language holds until the viewer picks another: across every link in the app, sign-in and sign-out, and a later visit. The address of a page does not contain the language; an older link that does (`/bo/…`, `/de/…`) still opens the page in that language (issue #79, 2026-10-03).
- When a Class or Team has no name in the viewer's language, the English name is shown. This covers a missing German name and every Class and Team created before this change.
- The Admin can edit the three names of an existing Class or Team ("Edit names") with the same rules as at creation. A Teacher can't.
- A name can't repeat within one language (ignoring case and surrounding spaces), for Classes and for Teams. The message names the name that is already taken.
- The Admin's lists of Classes and Teams show the name of the interface language with the names of the other languages under it, so a missing name is visible.

### 4.8 Tibetan Font

**Description:** All Tibetan text is shown in the Atisha font (by Lobsang Monlam), which the app serves itself. Before this, Tibetan text used Noto Serif Tibetan, loaded from Google Fonts. Added 2026-10-03; not part of the Parent role.

#### FR-18: Tibetan text uses the Atisha font

**Consequences (testable):**
- Tibetan text is shown in Atisha wherever the Tibetan font applies: the whole interface under the Tibetan interface language, Homework and Syllabus text written in Tibetan (FR-15, FR-16), and the Tibetan names of Classes and Teams (FR-17).
- The font is part of the app. Opening any page loads nothing from Google or another third party for fonts.
- Only Tibetan characters use Atisha. English or German words and digits inside Tibetan text keep the font they had before.
- Atisha has one weight. Bold Tibetan text (headings, bold in Homework Content) is drawn from that weight by the browser.
- This holds for every part of the page, including menus, buttons, form fields and their labels, and for Tibetan text shown under the English or German interface language (issue #78, 2026-10-03).
- Tibetan text is drawn 1.36 times the size of the English or German text around it. It was 1.5 times at first (issue #78, 2026-10-03); the product owner found that too big and it was reduced (issue #85, 2026-10-05).
- No Tibetan letter is cut off at the top or bottom, in running text or inside buttons, menus and form fields. Lines of Tibetan text are 1.2 to 1.5 times the Tibetan text size apart (issue #78, 2026-10-03).
- Breadcrumb labels and side menu labels show Tibetan letters in full, under the Tibetan interface and for a Tibetan name under another interface language (issue #86, 2026-10-05).

### 4.9 Syllabus Sections & Files

**Description:** A Syllabus is a list of Sections, and a Section can carry PDF files. Before this, a Syllabus held one text and one list of links, so a Teacher who planned two songs had to put both into that one text and couldn't attach a document. Added 2026-10-08 (issues #94 and #95); not part of the Parent role.

#### FR-19: A Syllabus is made of Sections

The Teacher of a Class or the Admin adds Sections to a Syllabus, each with a title, optional text, and optional links.

**Consequences (testable):**
- A Section needs a title of 1 to 200 characters. Its text and links are optional and follow FR-14 and FR-16: the same formatting tools, its own Content Language, up to 10 links.
- A new Section goes last. The Teacher or the Admin can move a Section up or down, edit it, and delete it after a confirmation.
- A Section's title is shown in the font of the Section's Content Language. A new Section takes the interface language of the person adding it, and keeps the language it was saved with.
- The Student sees the Sections of the Syllabus in the Teacher's order on the class page, each with its title, text, and links. A Syllabus without Sections shows "no syllabus yet".
- The Admin and the Teachers of the Class can change Sections. Students enrolled in the Class can read them. Nobody else sees them, including Parents (§10, Open Question 14).
- A Syllabus written before this change has its text and links in one Section titled "Syllabus" in the Syllabus's Content Language. Nothing was lost and nothing shows twice.
- The list of a Class's Syllabi shows how many Sections each has.

#### FR-20: PDF files on a Section

The Teacher of a Class or the Admin attaches PDF files to a Section; enrolled Students open them.

**Consequences (testable):**
- Only PDF files are accepted, at most 1 MB each, and at most 5 per Section. A file that is too large, isn't a PDF, or would be the sixth is refused with a message that names the limit, and nothing is stored.
- A file counts as a PDF by its content, not its name: a renamed Word document is refused.
- Each file is listed with its original name and its size. Selecting the name opens the PDF in a new tab; "Download" saves it under its original name.
- The Teacher or the Admin can replace a file with a newer version, which keeps its place in the list, and remove a file after a confirmation.
- Files are private. The Admin, the Teachers of the Class, and Students enrolled in it can open a file. Anyone else, signed in or not, gets "not found", also with a link copied from someone who has access. A link to a file stops working after about a minute.
- Deleting a file, its Section, its Syllabus, or its Class deletes the stored files too. If the stored files can't be removed, the delete is refused. If the delete fails after the files were removed, the message says the files are gone.
- Students and Parents can't upload anything.

### 4.10 Homework Notifications

**Description:** Students and Parents can get a notification on their phone or browser about Homework. Before this, the app sent nothing, and §6 listed notifications to Parents as a non-goal for this stage. Added 2026-10-06 (issue #92).

#### FR-21: Homework Notifications for Students and Parents

An approved Student or an approved Parent can turn on Homework Notifications for the device they're using.

**Consequences (testable):**
- **New:** when a Teacher creates a one-off Homework, each Student it's assigned to and that Student's Parent are notified. Weekly Homework sends no New notification.
- **Due soon:** on Saturday morning, a Student and their Parent are notified about Open Homework due in the next 7 days.
- **Overdue:** the morning after the due date, the Parent is notified once. The Student isn't.
- Teachers and the Admin get no notifications.
- "My Account" has a Notifications card with a switch, for approved Students and approved Parents. The switch belongs to the device: turning it on affects only that phone or browser.
- On a shared phone, notifications go to whoever is signed in. Signing out stops them for that person on that device.
- A notification is written in the language of the browser it goes to.
- The same notification isn't sent twice.
- No email is sent. Notifications are push only.

### 4.11 Sign-in, Email Confirmation & PIN

**Description:** Small changes that keep a Parent, a Teacher, or a Student from getting stuck at the door. Each came from a problem the product owner hit while registering real accounts. Added 2026-10-05 and 2026-10-06 (issues #82, #83, #88, #89, #90).

#### FR-22: Confirming an email, and asking for a new link

A confirmation link confirms the email only when the person presses a button, and a Parent whose link expired can ask for a new one.

**Consequences (testable):**
- Opening the confirmation link shows a page with one button ("Confirm my email"). The email is confirmed when the button is pressed, not when the link is opened, so a mail program that opens links by itself doesn't use the link up.
- A Parent can ask for a new confirmation email by entering their email. The answer is the same whether or not an account exists for that email.
- The way to ask for a new link is offered after registering ("Check your email"), after a link that failed or expired, and after a sign-in with an unconfirmed email.
- Registering with an email that already has an account says so and tells a Teacher who is also a Parent to sign in and use "Request parent access" under My Account (issue #83).
- Every password field has a button inside it that shows or hides what was typed: on register, sign-in, reset password, and My Account. A Student's PIN field on the sign-in page has it too (issue #82).

#### FR-23: Admin helps a Parent whose confirmation email doesn't arrive

The Admin can resend a Parent's confirmation email, or approve the Parent without it.

**Consequences (testable):**
- A Pending Parent whose email isn't confirmed has a "Resend confirmation email" action on the Requests page. If the email can't be sent, the Admin sees that.
- The Admin can approve such a Parent. The app asks first, names the email address, and says that nobody has proven they own it. After approval the Parent can sign in without confirming.
- This changes FR-2, which blocked approval until the email was confirmed.

#### FR-24: Resetting a Student's PIN

A Teacher of the Student's Class or the Admin can give a Student a new PIN.

**Consequences (testable):**
- "Reset PIN" is offered per Student in the list of class members, on the Teacher's class page and on the Admin's class students page.
- The app asks first. The username and the new PIN are then shown once, each with a copy button.
- Only an approved Student enrolled in that Class can be reset, and only by the Admin or a Teacher assigned to that Class.
- The Student is signed out everywhere and signs in with the new PIN.
- A Teacher can reset the PIN of their own child (§10, Open Question 16).

### 4.12 Help

**Description:** A public Help page explains the app per role. Before this, the app had no guidance, although §8 asks that parents can use it without instructions. Added 2026-10-05 (issue #87).

#### FR-25: Help page

Anyone can open a Help page with a step-by-step guide for Parents, Teachers, and Students.

**Consequences (testable):**
- The page has one guide per role, as numbered steps, and a list of common questions shared by all roles.
- A signed-in person starts on the guide for their own role. The Admin and a signed-out visitor start on the Parents' guide. There is no guide for the Admin.
- The page is reachable without signing in, from the start page and the sign-in page ("Need help?"), and from every role's menu.
- The guides are in German, English, and Tibetan, and the Parents' and Students' guides include screenshots.

### 4.13 Confirming Before an Action That Can't Be Undone

**Description:** An action that can't be undone asks before it runs. Before this, several such actions ran on one press. Added 2026-10-06 (issue #91).

#### FR-26: The app asks before an action that can't be undone

**Consequences (testable):**
- The question names the person or item it's about. Cancelling leaves everything as it was.
- On the Requests page this covers: rejecting a Parent, rejecting a Student's registration, clearing a rejected registration, approving or rejecting Sick Leave, and rejecting a Deletion Request.
- For a Teacher's Homework it covers: mark done, mark reviewed, archive, pause a series, and end a series. For a Student it covers mark done.
- It also covers the actions added since: deleting a Section, removing a Section File, resetting a PIN, and approving a Parent without a confirmed email.
- Actions that pressing again or editing corrects don't ask: attendance, skill status, cancelling or restoring one Session, schedule edits, and create and rename forms.

### 4.14 Installable App

**Description:** A phone or browser can install Sherab from the website. Before this, the app was meant to be a PWA (§8) but no page offered installation. Added 2026-10-03 (issue #81).

#### FR-27: Sherab can be installed from the browser

**Consequences (testable):**
- A browser that supports it offers to install Sherab or add it to the home screen, with the app's name and icon.
- Installing needs no app store.
- On an iPhone, Homework Notifications (FR-21) work only after Sherab was added to the Home Screen.

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

**Added 2026-10-01 for §4.6. Applied to the spec files on 2026-10-01.**

**`SPEC.md`**
- **CAP-3:** a Homework's fields become title, skill area, Content Language, required Homework Content (formatted text), target students, due date, and optional reference links (FR-13 to FR-15).
- **CAP-14 (new):** the Syllabus wasn't in the spec. It came from manual verification (issues #32 and #37) and now has formatted text and a Content Language (FR-16).
- **Constraints:** the Content Language decides the font; the formatting tools are limited to those in FR-14; typed text is never run as markup.
- **Non-goals:** images, tables, attachments, or embedded media in the text; more than one Content Language per item.
- **Open Questions:** whether a Parent should see the Homework Content; whether the Syllabus text should be required.

**`homework-workflow.md`**
- "Creating an assignment" gains Content Language and required Homework Content with the formatting tools of FR-14. "Title / instructions" becomes the title only.
- "Editing the series (title, links, due-date offset)" also covers the Homework Content and its Content Language.
- "Student side": the Student sees the formatted Homework Content in its Content Language's font (FR-14, FR-15).

**Added 2026-10-03 for §4.7. Applied to the spec files on 2026-10-03.**

**`SPEC.md`**
- **Constraints:** a Class and a Team have a name per interface language (English and Tibetan required, German optional); the viewer's interface language decides which is shown, with the English name as the fallback; names are unique per language (FR-17).

**Added 2026-10-10 for §4.9 to §4.14. Not yet applied to the spec files.**

**`SPEC.md`**
- **CAP-14:** a Syllabus is a list of Sections (title, optional formatted text in its own Content Language, optional links), ordered by the Teacher; a Section can carry up to 5 PDF files of at most 1 MB (FR-19, FR-20). The success line for the Student changes to the Sections and their files.
- **New capability:** Homework Notifications to Students and Parents: New, Due soon, Overdue (FR-21).
- **New capability:** a Teacher of the Class or the Admin resets a Student's PIN (FR-24).
- **CAP-1:** the Admin can approve a Parent without a confirmed email after a warning, and can resend the confirmation email (FR-23); a confirmation link confirms on a button press, and a new link can be requested (FR-22).
- **Constraints:** the size of Tibetan text is 1.36 times the surrounding text (FR-18). An action that can't be undone asks first (FR-26). Stored files are private to the Class and are deleted with what they belong to (FR-20).
- **Non-goals:** "file attachments … inside homework content or a syllabus" becomes: no files inside the text, no file types other than PDF, no upload by Students or Parents.
- **Open Questions:** whether a Parent should see the Syllabus.

**`roles-and-permissions.md`**
- Teacher and Admin: add Sections and Section Files, and resetting a Student's PIN. Admin: resend a Parent's confirmation email, approve without it.
- Student: reads the Sections and files of a Class they're enrolled in; can turn on Homework Notifications. Parent: can turn on Homework Notifications; can't see the Syllabus.

**`homework-workflow.md`**
- Creating a one-off Homework notifies the Students it's assigned to and their Parents; the Saturday reminder and the Overdue notice (FR-21). Mark done, mark reviewed, archive, pause and end a series ask first (FR-26).

## 6. Non-Goals

- Notifications by email, and any notification to Teachers or the Admin. Changed 2026-10-06: push notifications about Homework to Students and Parents are built (FR-21); before that, all notifications to Parents were a non-goal.
- A New notification for weekly Homework, and notifications about anything other than Homework.
- A second Parent account per family, or more than one Parent per Student.
- Parents marking Homework Done or acting for the child in any way besides Session Leave and Deletion Requests.
- In-app messaging between Parents and Teachers.
- Parents editing the child's profile, nickname, or avatar.
- Changing the Parent Email, because the email is what links every Linked Child.
- Teachers approving Parents.
- Student registration without a Parent account.
- Images, tables, or embedded media in Homework Content or a Section's text (§4.6). Changed 2026-10-08: PDF files can be attached to a Section (FR-20); files inside the text, and files on a Homework, remain a non-goal.
- File types other than PDF, files over 1 MB, and uploads by Students or Parents.
- A Parent seeing the Syllabus, searching Sections, and archiving a Section without deleting it. Asked for and deferred (§10, Open Question 14).
- More than one Content Language per Homework or Syllabus. Mixed text is allowed, but one language is chosen and decides the font.
- A paid or hosted editor service. The editor runs in the Teacher's browser and the text is stored in the school's own database.

## 7. MVP Scope

**In scope:** FR-1 to FR-12, with all screens in German, English, and Tibetan. FR-13 to FR-16 were added on 2026-10-01 and are built; the Tibetan wording of their new labels is still to be supplied (§10, Open Question 7). FR-17 and FR-18 were added on 2026-10-03 and are built; FR-17's new labels are also still English under the Tibetan interface. FR-19 to FR-27 were added between 2026-10-03 and 2026-10-08 and are built; their Tibetan texts are drafts that haven't been reviewed (§10, Open Question 7), and FR-19 and FR-20 aren't on the live site until their two database changes are applied (§10, Open Question 13).

**Out of scope:** everything in §6.

**Go-live precondition:** Open Question 1 (GDPR) is resolved.

## 8. Constraints & Privacy

- The app isn't in use by real families yet, so there are no existing Students or teacher notes to migrate. Test data is reset at release.
- Same platform as today: a low-cost PWA on family phones, with no app-store install. It can be installed from the browser (FR-27).
- Must stay simple enough for non-technical parents to use without instructions. The Help page (FR-25) is there for those who want them.
- A Parent sees only their own Linked Children, and no other child's data beyond what the leaderboard already shows.
- The app now stores an adult's name and email per family. GDPR obligations are still open (§10, Open Question 1).
- No reason or medical detail is collected for Sick Leave.
- The app runs on the school's own domain, `sherab.app`, and sends its account emails (confirmation, password reset) from it through a mail service (issue #84). The setup is described in `docs/production-email.md`; whether every step is finished isn't recorded.
- The app stores files for the first time: Teachers' PDFs for a Syllabus Section, in the same hosted service as the database, inside its free allowance (`docs/deployment-and-costs.md`). Whether that service's backups include stored files isn't confirmed.
- Homework Notifications go through the push services of the browser makers (Apple, Google, Mozilla). No other third party receives them.

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
2. **Parent notifications**, such as a weekly overdue summary. Planned for a later stage; design them then. **Decided (product owner, 2026-10-06, issue #92):** push notifications for New, Due soon (Saturday morning), and Overdue (Parents only); see FR-21. Email notifications stay open.
3. What happens to a Parent account when all its Linked Children are deleted or leave the school?
4. **Planned Leave edge cases** (deferred): switching On leave → Coming → On leave; Sessions added or moved inside the Leave Notice Period; and whether changing the Leave Notice Period reclassifies earlier leave.
5. How does a Parent regain access after losing access to their email? Possibly with the Admin's help.
6. **Should a Parent see the Homework Content?** Today the Parent sees a Homework's title, due date, status, and reference links (FR-7), not the content the Teacher wrote. UJ-2 has Dolma talking to Tenzin about an overdue item, which the content would help with.
7. **Tibetan wording** for the labels added with §4.6 (Content, the language names, the formatting tools, and the new messages). They currently appear in English under the Tibetan interface. Owner: product owner. The same holds for what §4.9 to §4.14 added: the texts for Sections, Section Files, notifications, confirmation questions, and the Admin's Parent actions the Help guides, and the password button are in Tibetan, but as drafts written by the assistant (2026-10-06 and later) that no Tibetan speaker has reviewed.
8. **Title font in two places.** The Homework title is shown in the interface's font, not the Content Language's, in the page breadcrumb and inside the title field while the Teacher types (a limit of the interface components used). Accept, or fix?
9. **Should the Syllabus text be required**, as Homework Content is? Kept optional for now (FR-16).
10. **Existing Classes and Teams have no Tibetan or German name** until the Admin adds them with "Edit names" (FR-17); until then the English name is shown. Owner: Admin.
11. **Licence of the Atisha font** (FR-18). The font's own notice reads "Copyright (c) 2014 by Lobsang monlam. All rights reserved." and names no licence. Confirm with Monlam IT (monlamit.org) that it may be served from a website and kept in the code repository. Go-live precondition. Owner: product owner.
12. **Size of Tibetan text.** At the same font size Atisha looks slightly smaller than the Latin text beside it. Should it be scaled up? **Decided (product owner, 2026-10-03, issue #78):** yes, 1.5 times the size of English and German text; see FR-18. **Changed (product owner, 2026-10-05, issue #85):** 1.36 times.
13. **Syllabus Sections and files aren't live yet.** The two database changes behind FR-19 and FR-20 are built but not applied to the live database. Apply both, then deploy the app straight after: what a Teacher saves in the old app in between doesn't appear as a Section. It isn't confirmed that the live service lets the second change create the file storage by itself. Owner: product owner.
14. **Should a Parent see the Syllabus, its Sections, and its files?** The product owner said yes (2026-10-08) and deferred it. Search across Sections and archiving a Section were deferred with it.
15. **Notifications and installation on real phones.** Not yet checked on a real phone: that a notification arrives, the iPhone Home Screen app, the Saturday reminder against the running app, and the install offer itself (FR-21, FR-27). The same goes for a phone's file picker and how a phone opens a PDF (FR-20).
16. **May a Teacher reset their own child's PIN?** It's allowed today (FR-24): the rule that keeps a Teacher from deciding about their own child covers decisions, not sign-in details. Confirm, or block it.
17. **A signed-out visitor who opens a file link gets "not found"** (FR-20). That keeps outsiders from learning anything, but a Student whose sign-in expired sees the same page. Send signed-out visitors to the sign-in page instead?
18. **Who reset a PIN, and who approved a Parent without a confirmed email, isn't recorded** (FR-23, FR-24). Is a record needed?

