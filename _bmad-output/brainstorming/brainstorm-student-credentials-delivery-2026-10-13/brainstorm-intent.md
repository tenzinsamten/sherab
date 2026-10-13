# Intent: Student credentials delivery

## Problem

A newly registered student's username and code are visible only to the admin. After registering, the student sees a message that they will be approved but gets no way to log in. Parents or students therefore have to go to the admin to get the credentials.

## Goal

Nobody has to go to the admin for a student's credentials.

## Chosen behaviour

**At registration**

- The post-registration confirmation screen shows the student's username and code.
- An email with the same username and code is sent to the parent's email address. It includes a login link that goes straight to the login page.

**While approval is pending**

- The student can log in to their account immediately.
- A logged-in pending student sees only a pending approval message, nothing else. This mirrors the parent flow, where the parent can already log in while approval is pending.

**At approval**

- Approval enables the portal for the student.
- Approval sends no credentials.

**Any time after registration**

- A logged-in parent can see their child's username and code in their own account.
- A parent can reset their child's code themselves, without the admin.
- After a code reset, the copies on the confirmation screen and in the registration email are stale. The parent account view is the only always-current source of the credentials.

## Constraints and things left unchanged

- A student cannot register without a parent, so there is always a parent account and a parent email to deliver credentials to.
- The admin's view of usernames and codes stays the same.

## Open questions

- With the credentials email moved to registration, nothing yet tells the family that approval has happened. The spec must decide whether and how the family is told.
