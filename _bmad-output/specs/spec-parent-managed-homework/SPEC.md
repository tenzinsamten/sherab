---
id: SPEC-parent-managed-homework
companions:
  - brownfield.md
  - ../../planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Parent-Managed Homework

## Why

Young students have no phone of their own. To mark homework done today, a parent logs into the child's account with the child's username and PIN, then logs back into their own. This is tedious. While the parent is signed in as the child, they also miss their own homework alerts: overdue pushes go only to parents, and pushes reach whichever account is signed in.

Older students with their own phones are well served and must keep sole control of their homework. The fix is that a parent can declare a child parent-managed and then complete that child's homework from the parent area, with their own login.

This reverses AD-12's rule that parents never write homework records. Architecture must amend AD-12 before stories start.

## Capabilities

- **CAP-1**
  - **intent:** Either linked parent turns "parent-managed" on or off for their child.
  - **success:**
    - Parent A switches it on in the child's overview, and both A and B see it on.
    - Switching it off hides the parent mark-done controls for both parents.
    - A parent not linked to the child, a teacher, an admin, or the student cannot change it.
- **CAP-2**
  - **intent:** A parent of a parent-managed child marks that child's open homework done from the parent area.
  - **success:**
    - A taps "Mark done" on an open item in the child's Homework tab or on `/parent/homework`. The item moves to Done for the parent and on the child's own `/student/homework`.
    - The item's homework alerts stop, and streaks and badges update as for a student's own mark.
    - The database refuses a parent's done mark when:
      - the flag is off;
      - the parent is not linked to the child;
      - no assigned row exists;
      - the status is `reviewed`;
      - `recorded_by` is not the caller.
- **CAP-3**
  - **intent:** A parent opens one homework item of their child and sees its full details and the class details, so the child can read it on the parent's phone.
  - **success:**
    - `/parent/children/[id]/homework/[instanceId]` shows everything the student detail page shows for that item.
    - It has a "Mark done" button when the child is parent-managed and the item is open.
    - The page returns 404 for a child the parent is not linked to, or for an item not assigned to that child.
- **CAP-4**
  - **intent:** Parents see who marked each done item.
  - **success:**
    - A done item shows "by you" to the parent who marked it, and the other parent's name to the other parent.
    - It shows the child's name when the child marked it.
    - A teacher's done mark shows no label.
    - Teacher and admin views are unchanged.

## Constraints

- The database enforces the parent write, not only the UI (AD-2). A parent may insert into `homework_status_history` only when all of these hold:
  - the status is `done`;
  - `is_parent_of(student_id)` holds and the child is parent-managed;
  - a prior `assigned` row exists for that instance and student;
  - `recorded_by = auth.uid()`.
- The flag is written only through a trusted function that checks `is_parent_of`. Profile update grants stay unchanged.
- AD-12's parent write exceptions extend to exactly these two things: the parent-managed flag, and `done` rows for a parent-managed child.
- Both linked parents have equal rights here through the shared helpers (`is_parent_of`, `linked_children`). There is no parallel read path.
- The student's own mark-done flow is unchanged. A parent-managed child can still mark done themselves.
- Status history stays append-only. There is no undo of done. A second done mark for the same item is not an error to the user.
- Notification logic is unchanged: once an item is done it is no longer open, so it stops alerting.
- All new text is localized in en, de, and bo.

## Non-goals

- Parents marking homework `reviewed`, or undoing done.
- A student-style "child view" or account switching inside the parent's login.
- Teachers, admins, or the student setting the parent-managed flag.
- Showing teachers who marked an item done.
- Disabling or changing the child's own login when the child is parent-managed.
- Setting the flag automatically by age, or at registration.

## Success signal

1. Parent A turns on parent-managed for a young child.
2. A opens that child's homework on A's own login, reads the full task with the child, and taps Mark done.
3. The item shows Done, "by you", for A, and the other parent's name for B. The child's student view shows it done. No alerts follow for that item. A received that day's overdue alerts for other items.
4. With the flag off, the button is gone and a direct insert is refused.

RLS tests cover each refusal for both A and B.

## Assumptions

- The flag is stored on the student's profile, defaults to off, and is writable only through the trusted function.
- Turning the flag off leaves done rows a parent already recorded unchanged.
