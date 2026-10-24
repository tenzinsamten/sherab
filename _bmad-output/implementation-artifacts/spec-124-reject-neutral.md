---
title: 'Reject buttons are a neutral outline (#124)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On `/requests` the Reject buttons are red (`variant="destructive"`) and their confirm dialogs have a red confirm button, while `component-specs.md` and the UX DESIGN.md ask for a neutral outline: rejecting a registration is not a destructive data action.

**Approach:** Reject for self-registrations, parent accounts, Sick leave and class join requests uses `variant="outline"`, and its confirm question drops `destructive` (neutral confirm button). Actions that erase data stay red: approving a deletion request (button and question), "Clear rejected" and the decided-parents clear. Approve buttons are unchanged. A render test pins that pending Reject buttons are outline, not destructive.

**Decisions (2026-10-24):** Sick leave and class join Reject included with the review's three named buttons, by the same rule (no data is erased). On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `requests/+page.svelte`: Reject → `variant="outline"` for registrations (`:488`), parent accounts (`:852`), Sick leave and class join (`decision === 'approved' ? 'default' : 'outline'`); `{ destructive: true }` / `{ destructive: decision === 'rejected' }` dropped from their four confirm questions. Unchanged (red): deletion Approve (button `:714`, question `:222`), "Clear rejected" (`:958`), the decided-parents clear (`:1108`).
- "Neutral confirm button" read as: not red. Without `destructive`, `ConfirmDialog` uses its default (primary) confirm, as for Approve; Cancel stays the outline. An outline confirm beside an outline Cancel would hide the dialog's action.
- Test: `page.render.spec.ts` renders all five Reject kinds as admin, finds them by `m.requests_reject()`, expects exactly 5 outline (no `bg-destructive`), and the deletion Approve red.

## Review Triage Log

- Reject confirm is primary, not neutral — low; rejected as a defect: "neutral" means not red (documented above); the row buttons, which the spec's accidental-reject concern is about, are distinct (primary Approve, outline Reject).
- Join and parent Reject untested — low, direct. Patched (all five kinds rendered).
- `>= 2` too loose — low, direct. Patched (exactly 5).
- Regex hardcodes "Reject", empty-tag fallback — low, direct. Patched (`m.requests_reject()`, exact label, non-null match).
- "Only deleting data is red" not pinned — low, direct. Patched (deletion Approve stays `bg-destructive`).
- Dialog side untested — low; rejected (`ConfirmDialog` maps the flag; the flags are removed in plain sight in the diff).
- Other screens' red actions (unenroll, delete team/class, remove teacher) — false as an inconsistency: each removes data or access; the rule is applied as stated.
- Dark-mode outline border — false: dark mode is opt-in via `.dark`, which the app never sets.
