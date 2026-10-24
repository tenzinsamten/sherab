---
title: 'Empty states point to the next step (#126 C)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four empty states end without a next step: a student with no class (dashboard and My homework) is not pointed to My classes, where joining lives since #113; a parent with no linked child is not pointed to how joining works; a teacher's empty roster does not offer the class code to share.

**Approach:** `EmptyState` gets an optional action (`children`, under the text). Student, no class (not after a failed load): "Join a class" (`nav_join`) as an outline link to `/student/classes`, on the dashboard and in My homework's To do empty state. Parent, no child: "How joining works" (`home_join_heading`) to `/help?role=parent` (the parents' guide explains joining). Teacher, empty roster: a line "Share the class code so your students can ask to join." (new `roster_empty_body` in en, de, bo; Tibetan: the assistant's draft) and the class code with its copy button (`CopyField`).

**Decisions (2026-10-24):** The user split #126 and built this part (C) first; the teacher tiles with a "to review" count (A) and the student Overdue filter (B) are deferred. On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `empty-state.svelte`: `children?: Snippet` rendered in `Empty.Content`.
- `student/+page.svelte`, `student/homework/+page.svelte`, `parent/+page.svelte`, `teacher/classes/[id]/+page.svelte`: the four actions; `Button` (with `href`) and `CopyField` imported where missing.
- Tests: render specs for the student dashboard (link, none after a failed load), My homework (link in the To do empty state), the class page (line, label, copy field). The parent page has no render spec; its link is covered by review and the manual check.
- Review fixes: German `roster_empty_body` "…damit deine Schüler:innen den Beitritt anfragen können." (the file's style and "ask to join"); the class page test asserts the code inside the copy field; My homework test also asserts no link in Done and after a failed load; message text escaped in the test patterns.

## Review Triage Log

- Parent empty state untested — low; rejected (no parent render spec exists; a one-link addition; manual check listed).
- Button reuses `home_join_heading` — low; rejected (same meaning, already translated in three languages).
- Empty roster while join requests wait — low, real; rejected here: the class page does not load requests and the Requests tab shows its own count; worth a separate item if wanted.
- Test did not check the code's value — low, direct. Patched.
- German off style and meaning — low, direct. Patched.
- My homework guards untested — low, direct. Patched.
- Dashboard and My homework lay the button out differently — low; rejected (each follows its own card's pattern: muted line vs EmptyState).
- `EmptyState` children slot untested on its own — low; rejected (`{#if children}` guards `Empty.Content`; callers without children render as before).
- Unescaped message in RegExp — low, direct. Patched.
- Tibetan unreviewed — false as a defect: listed as the assistant's draft here and in the issue log.
