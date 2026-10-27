---
id: SPEC-second-parent
companions:
  - brownfield.md
  - ../../planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Second Parent

## Why

Both parents need to see their children's information, because one parent cannot always keep up with homework, attendance, and leave. Today a student links to exactly one parent account (one email, `profiles.parent_id`, AD-10), following the parent-role PRD's "one Parent account per family" (§6). This spec reverses that decision. Architecture must amend AD-10 (how links are stored) and AD-12 (parent write exceptions) before stories start.

## Capabilities

- **CAP-1**
  - **intent:** A parent linked to a child invites a second parent for that child by entering their email address, sees the pending invite, and can cancel it.
  - **success:** Parent A opens their child's page, enters B's email address, and sees "Invite pending" for B. Cancelling removes it. The app refuses an invite for a child A is not linked to, for a child who already has two parents, for A's own email, and for a second pending invite. The refusal never reveals whether the email has an account.
- **CAP-2**
  - **intent:** The invited person becomes a linked parent of the child once they hold an approved parent account with the invited email and accept the invite within 30 days.
  - **success:** B registers as a parent with the invited email, the admin approves B through the existing approval flow, and B sees the invite on `/parent`. After B accepts, the child appears on B's landing page. An approved parent with a different email never sees the invite. An invite that has expired, been cancelled, or whose inviter is no longer linked cannot be accepted.
- **CAP-3**
  - **intent:** Both linked parents have identical parent access to the child, and neither parent's access depends on the other.
  - **success:** A and B each see the same homework, attendance, badges, progress, calendar, and leave for the child. Each can mark session leave (AD-13) and request deletion of the child's account (AD-9), and each receives homework push notifications (#92). A pending deletion request shows on both parents' child page with who requested it, and the second parent's own request gets an "already requested" message. Neither parent sees any other child. Removing B's link leaves A's access unchanged.
- **CAP-4**
  - **intent:** The admin sees both parents of each student, who invited each one and when, and can remove a parent link.
  - **success:** The admin's student page lists both parents with inviter and date. Removing B's link removes B's access to that child immediately and leaves A unchanged. Removing a student's last link is refused. An admin who is a parent of the child cannot remove its links.
- **CAP-5**
  - **intent:** `/join` refuses to register a child that the registering parent was already invited to, and points them to the invite.
  - **success:** B, with a pending or accepted invite for "Tenzin", tries to register "tenzin " at `/join`. The app refuses and points B to the invite. Registering a different name succeeds.
- **CAP-6**
  - **intent:** Teachers and the admin see both linked parents as the child's contacts, and which parent set each leave or sick answer.
  - **success:** The teacher's student view lists A's and B's email addresses. A leave answer set by B shows B's name.

## Constraints

- At most two linked parents per student, and at least one while the student exists. The database enforces both, not only the UI (AD-2). The limits hold under concurrency: two accepts, an accept and a new invite, or two removals at the same time never yield three links or zero.
- One pending invite per child. A pending invite does not use a parent slot, and it expires after 30 days. Accepting re-checks everything in one step: the invite is pending and unexpired, the inviter is still linked, the student still exists, and the child has fewer than two links.
- Removing the inviter's link, or rejecting or deleting the student, cancels the child's pending invite.
- Only trusted paths set and store links. RLS never matches on email text (AD-10 carried over). The invitee reads and accepts invites only through a trusted server-side function, which compares the email address trimmed and case-insensitive against the invitee's current profile email.
- AD-12's parent write exceptions extend to one thing: a linked parent creates and cancels invites for their own approved child. Parents never write links directly.
- Only the admin removes links. Parents cannot remove themselves or the other parent.
- Removing a parent's link leaves that parent's pending deletion request for the admin to decide. The remaining parent still sees it, and the removed parent does not.
- Deleting a student through an approved deletion (AD-9) removes all of their links. A parent account with active links cannot be rejected, revoked, or deleted. The admin removes its links first, through the same audited removal, which never removes a student's last link.
- Every parent check covers both parents through the shared helpers (`is_parent_of`, `linked_children`). No code reads `profiles.parent_id` for a parent lookup. `brownfield.md` lists the known direct readers (AD-12: no parallel read path).
- Leave rules (AD-13 cutoffs, final sick rejections, frozen classification) apply per student and session, whichever parent writes. B cannot re-submit Sick after A's Sick was rejected. The history records which parent set each answer.
- Migration copies each non-null `parent_id` into one link and stops before changing anything if a row would break the new rules. It leaves students without a parent (service-role fixtures) untouched. Existing parents see the same data before and after.
- The app sends no invite email. The inviting parent tells the other parent to register with that email address.
- All new text is localized in en, de, and bo.

## Non-goals

- More than two parents per student (guardians, grandparents).
- Different permission levels between the two parents.
- Linking without an invite from the linked parent: no admin-initiated linking, no self-requested linking, no second guardian email on the registration form.
- Merging duplicate student accounts. CAP-5 prevents new duplicates only.
- Parents removing a link.
- Restricting one parent's access for custody or safeguarding reasons, beyond the admin removing a link.

## Success signal

Parent A invites B's email address. B registers, the admin approves B, and B accepts. B then logs in and sees the child's homework, attendance, and badges, marks leave for next Sunday, and receives the next homework push notification. A still sees everything, including B's leave answer, and the admin's student page shows B, invited by A, with the date. A third invite is refused. A parent with a different email never sees the invite. After the admin removes B, B sees nothing and A is unaffected. RLS tests cover each of these for both A and B.

## Assumptions

- Linking needs the invitee's explicit acceptance, not an email match, so a mistyped email cannot expose a child to a stranger.
- Invites are only for approved children.
- A parent the admin removed cannot be re-invited for that child, so a re-invite cannot undo the admin's removal.
- `guardian_email` stays the registration-time display copy. Contact lists come from the links.
- Session leave is one shared answer per session, and the latest change by either parent wins.
