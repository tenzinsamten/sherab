# Roles & Permissions

Detail behind CAP-1, CAP-2, CAP-7. The kernel states the intents; this holds the full matrix.

## Roles

| Role | Who | Core need |
|---|---|---|
| Admin / head organizer | Runs the school | Full visibility across all classes and teachers |
| Teacher | Volunteer, usually one per class/age group | Update their assigned classes' students, assign & review homework |
| Student | Kids attending | Register, see own streak/badges/team leaderboard, mark homework done |

Parent view is a deferred future phase — no separate parent login in v1; any parent involvement is informal, through the student's own device/account.

## Teacher accounts

- Created only by the admin — no teacher self-registration.
- A teacher account is verified by the admin before it becomes active.
- Admin assigns each verified teacher to one or more classes.
- Class ↔ teacher is many-to-many: a class can have multiple teachers, and one teacher can be assigned to multiple classes.

## Student registration

1. Student self-registers with name + class code.
2. Account starts **Pending**: not active, not visible on any roster or leaderboard, cannot log progress. It appears in the teacher/admin approval queue immediately, flagged "unverified" until step 3 completes.
3. Registration includes a consent step (parental/guardian consent for a minor's data being processed) and a guardian email address, which must be confirmed via Supabase's own confirmation email before the registration is approvable — both required before it goes to the teacher for approval.
4. Any teacher assigned to that class can approve/reject the pending registration, once the guardian has confirmed their email. Rejecting an unconfirmed registration is always available — only approval waits on confirmation.
5. Admin can also approve/reject for any class, as backup (teacher unavailable, or registration looks suspicious).
6. Rejected/unrecognized entries should be easy to clear out.
7. Once approved, the student picks a nickname/avatar for day-to-day use.

## Visibility scoping

- Visibility follows the **class**, not an individual teacher: every teacher assigned to a class sees and can edit that class's full roster, statuses, and homework.
- A teacher cannot see a class they are not assigned to.
- Only the admin has cross-class visibility: all teachers, all students, overall homework completion across every class.

## Admin responsibilities

- Creates and manages teacher accounts; assigns teachers to classes.
- Backup approver for pending student registrations, for any class.
- Cross-class visibility (the only role with this).
- Reviews and actions data-deletion requests (human approval step before erasure).
- Possible future addition: a structured onboarding flow with materials for new teachers (not committed for v1).
