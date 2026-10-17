---
id: SPEC-class-day-admin
companions: []
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Class Day Admin

## Why

A pain to solve (#105). The admin can add class days and cancel or restore them, but cannot fix one. A day added on the wrong date, or a Sunday that has to move to Saturday for a holiday, today means cancelling it and adding another, which leaves a cancelled day behind. Parents' leave answers on that day are also lost. The admin needs to move a day and to delete one added by mistake, without touching anything already recorded.

## Capabilities

- **CAP-1**
  - **intent:** The admin moves a future class day to another future date that has no class day; its sessions (classes, times, overrides) and the leave answers on them move with it.
  - **success:** Moving Sunday 2026-11-08 to Saturday 2026-11-07 shows the same classes, times and parents' answers on 11-07, and 11-08 is empty. A move onto a date that already has a class day, onto today or the past, or of today's or a past day, is refused with a message, and nothing changes.
- **CAP-2**
  - **intent:** The admin deletes a future class day that nothing references; a day with attendance, leave answers or sick-leave decisions is refused with a pointer to Cancel day.
  - **success:** Deleting an untouched future day removes it and its sessions from every role's calendar. Deleting one where a parent has answered, or deleting today or a past day, is refused with a message, and the day stays.

## Constraints

- Only future days count (after today in Europe/Berlin, the calendar's clock). Today and past days stay fixed, so attendance, streaks and badges never shift.
- The rules (admin only, future only, free target date, untouched for delete) are enforced in the database, not only in the UI (AD-2). `class_days` has no delete policy today, and an RLS update policy alone can't express "future only".
- One class day per date (`class_days_day_unique`).
- The actions live in the existing day view, opened from the month grid, next to Cancel day / Restore day.
- All new text is localized in en, de and bo.

## Non-goals

- No list view of class days; the month grid stays the way to find a day.
- No editing of session times or classes here; that stays with the schedule and per-session overrides.
- No notification to parents or teachers about a moved or deleted day.
- No bulk move or delete, and no undo.

## Success signal

- In production, the admin moves a holiday Sunday to the Saturday before. Parents see their child's classes on Saturday with the answers they gave, and nothing shows on Sunday.
- A day added by mistake is deleted in one step, with no cancelled leftover.

## Assumptions

- Admin-only, as today. Teachers keep editing only their own sessions.
