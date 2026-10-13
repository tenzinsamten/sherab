# Roles & Permissions

Detail behind CAP-1, CAP-2, CAP-7, CAP-12, CAP-13, CAP-15. The kernel states the intents; this holds the full matrix.

## Roles

| Role | Who | Core need |
|---|---|---|
| Admin / head organizer | Runs the school | Full visibility across all classes and teachers |
| Teacher | Volunteer, usually one per class/age group | Update their assigned classes' students, assign & review homework |
| Student | Kids attending | Register, see own streak/badges/team leaderboard, mark homework done |
| Parent | One adult per family | See each child's homework and record; keep the child's username and PIN; set leave; request deletion |

One login may hold a teacher or admin role and the parent role. The parent role needs its own admin approval; the user switches roles in the app.

## Teacher accounts

- Created only by the admin — no teacher self-registration.
- A teacher account is verified by the admin before it becomes active.
- Admin assigns each verified teacher to one or more classes.
- Class ↔ teacher is many-to-many: a class can have multiple teachers, and one teacher can be assigned to multiple classes.

## Parent accounts

1. Parent self-registers with email + password and confirms the email. The account starts **Pending** and sees no student data.
2. Only the admin approves or rejects, by recognizing the family; approval waits for email confirmation, rejection does not. Teachers never see parent registrations.
3. A rejected parent may register again with the same email. An email already used by a Pending or approved parent is refused.
4. One parent account per family; each student has exactly one parent.
5. Linked child: a student whose guardian email equals the parent's email.
6. My Profile, like the teacher's: edit display name, change password, existing forgot-password flow. The email is read-only.

## Student registration

0. The parent registers and is approved first (see Parent accounts).
1. Student self-registers with name + class code.
2. Account starts **Pending**: not visible on any roster or leaderboard, cannot log progress. The student gets a username and PIN at once (see Student credentials) and can log in, but sees only a pending-approval message. It appears in the teacher/admin approval queue immediately, flagged "unverified" until step 3 completes.
3. Registration includes a consent step (parental/guardian consent for a minor's data being processed) and a guardian email address, which must belong to an approved parent. If not, registration stops: "No parent account found. Check the email is correct, or ask your parent to register first." A pending or unconfirmed parent counts as not found. No confirmation email is sent, since the parent's email is already confirmed. Siblings may share the email, even while several are pending.
4. Any teacher assigned to that class can approve/reject the pending registration. Teacher approval remains the guard against a false registration using a known parent email. The "no parent account found" message reveals whether an email belongs to a parent; accepted risk for an internal school app.
5. Admin can also approve/reject for any class, as backup (teacher unavailable, or registration looks suspicious). Approval opens the portal for the student and sends the family nothing.
6. Rejected/unrecognized entries should be easy to clear out. Until cleared, a rejected student can log in and sees only the not-accepted page.
7. Once approved, the student picks a nickname/avatar for day-to-day use.
8. A student can request a guardian email correction; the admin approves it. The new email must belong to an approved parent, and the student moves to that parent.

## Student credentials (CAP-15)

The PIN is the student's login secret; the class code only joins a class.

| Moment | Where the family gets username and PIN |
|---|---|
| Registration | Confirmation screen, and an email to the parent's address with a link to the login page |
| Pending | Parent's account |
| Approval | Nothing is sent; the pending message is gone at the student's next visit and the parent's child card no longer shows "Waiting for approval" |
| Any time later | Parent's account, the only always-current source |

- A parent can reset a linked child's PIN without the admin or a teacher. The old PIN stops working at once and the student is signed out everywhere.
- After any reset, the confirmation screen and the registration email are stale.
- The link in the email opens the login page; it does not log anyone in.
- A teacher's or the admin's PIN reset for approved students stays as it is. At approval the approver sees the username and a note that the family already has the PIN; a registration that got no credentials gets them at approval, shown once to the approver.
- A rejected student can log in and sees only that the registration was not accepted, with sign-out.
- Built so far (#100): credentials at registration, the confirmation screen, login while pending. Not built yet: the email to the parent, the parent's view and the parent's PIN reset. Until then, a family that loses the PIN before approval gets a new one only after approval, by Reset PIN.

## Parent view (CAP-13)

- Landing page: one summary card per linked child with name, every enrolled class, open homework count, and overdue count (overdue highlighted). A pending child shows "Waiting for approval", the username and PIN, and no other details. Open homework = not Done and not archived.
- Child details: homework (open, overdue, Done, Reviewed) with due dates and reference links; attendance history; skill status per area with history; teacher notes; streak and badges; team and leaderboard as the child sees them; upcoming sessions with actual times and the child's leave answers; the class's teachers.
- Every child card gives the child's username and current PIN and lets the parent reset the PIN (CAP-15).
- Read-only, with three exceptions: setting attendance intent (see `calendar.md`), resetting a linked child's PIN, and submitting a deletion request (CAP-8, into the admin queue; the parent account remains after deletion).
- Teacher notes are written for the parent: the teacher-side notes field reads "Visible to the student's parent", and teachers should not name other children.
- A parent sees no other student's personal data beyond what the leaderboard shows the child.

## Visibility scoping

- Visibility follows the **class**, not an individual teacher: every teacher assigned to a class sees and can edit that class's full roster, statuses, and homework.
- A teacher cannot see a class they are not assigned to.
- Only the admin has cross-class visibility: all teachers, all students, overall homework completion across every class.
- A parent sees only their own linked children.

## Admin responsibilities

- Creates and manages teacher accounts; assigns teachers to classes.
- Sole approver of parent accounts; approves guardian email corrections.
- Backup approver for pending student registrations, for any class.
- Cross-class visibility (the only role with this).
- Reviews and actions data-deletion requests from students or parents (human approval step before erasure).
- Possible future addition: a structured onboarding flow with materials for new teachers (not committed for v1).
