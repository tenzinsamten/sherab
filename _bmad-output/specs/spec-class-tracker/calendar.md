# Calendar: Class Days, Sessions, Attendance Intent

Detail behind CAP-9, CAP-10, CAP-11, and the calendar's effect on CAP-2 (attendance) and CAP-4 (streaks).

## Layers

| Layer | Owner | Holds | Rule |
|---|---|---|---|
| Class day | Admin | A date on which classes happen, school-wide | Several classes can run on one class day. |
| Class schedule | Admin or any teacher of the class | Weekdays, one start time + duration, start date, optional end date | Picks the class's sessions from the admin's class days. Usually Sunday. |
| Extra session | Admin or any teacher of the class | One additional session of the class on a class day outside its schedule, with its own time | Only on an existing class day. |
| Session | Any teacher of the class | One class on one class day: start time, duration, cancelled flag | Exists only on a class day, from the schedule or as an extra. Editing one session never changes the schedule or other sessions. |
| Attendance intent | Parent (per linked child, per session) | Coming / On leave / Sick / not answered | Sessions of classes the child is enrolled in. The student sees it read-only. |
| Attendance | Any teacher of the class | Present / absent for a session | Marked against a scheduled, non-cancelled session. |

## Rules

- A class gets a session on a class day when the day's weekday is one of the class's weekdays and the day lies between the schedule's start date and (if set) end date. Extra sessions come on top.
- A new class starts with a Sunday, weekly, from-today schedule and no time set, until someone edits it *(assumption)*.
- Changing a schedule regenerates the class's sessions dated today or later: still-matching sessions keep their own time and cancellation, no-longer-matching ones are removed, missing ones are added. Sessions before today are never changed.
- Adding a class day creates sessions only for classes whose schedule matches that day.
- Per-session start time and duration are overrides; they never change the schedule or other sessions.
- Admin removing a class day cancels every session on that day *(assumption)*.
- Times are Munich local time (Europe/Berlin) *(assumption)*.
- A student enrolled in several classes sees each class's sessions; overlapping times are not blocked (warning is an open question).

## Attendance intent

- Set by the parent only; the student sees it read-only.
- States: **Coming**, **On leave**, **Sick**, **not answered** (default, treated as expected). Sick carries a decision: pending, approved, or rejected.
- Coming and On leave can be changed until the session starts. Sick can be set until the end of the day after the session.
- Visible to: the class's teachers, the admin, and the parent in full; classmates and the student's team see nickname + state, with Sick shown as On leave. No reason or medical detail is collected.
- Sick is decided by any teacher of that session's class, or the admin as backup. Undecided after 2 weeks: approved automatically.
- Set per session; date-range leave is an open question.
- Planned Leave: On leave set at least the leave notice period before the session starts (admin-configurable, default 2 weeks). Later On leave is short-notice leave. Before saving, the parent sees which it will be.

## Attendance and streaks

- Attendance is marked per scheduled session, replacing marks against a free-chosen weekly date.
- A week with no non-cancelled session for the class is a holiday: it does not consume streak grace.
- A missed session with Planned Leave or approved Sick leave does not consume grace. Short-notice leave, rejected Sick leave, and unannounced absence each consume one grace week. Pending Sick leave does not protect; the week is recalculated when it is decided.
- Streaks stay weekly: attending any session of a week qualifies that week *(assumption)*.
