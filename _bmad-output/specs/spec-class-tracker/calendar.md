# Calendar: Class Days, Sessions, Attendance Intent

Detail behind CAP-9, CAP-10, CAP-11, and the calendar's effect on CAP-2 (attendance) and CAP-4 (streaks).

## Layers

| Layer | Owner | Holds | Rule |
|---|---|---|---|
| Class day | Admin | A date on which classes happen, school-wide | Several classes can run on one class day. |
| Class default | Any teacher of the class | Default start time + duration | Applied to every class day unless overridden. |
| Session | Any teacher of the class | One class on one class day: start time, duration, cancelled flag | Exists only on a class day. Editing one session never changes the default or other sessions. |
| Attendance intent | Student (own, per session) | Coming / On leave / not answered | Only for upcoming sessions of classes the student is enrolled in. |
| Attendance | Any teacher of the class | Present / absent for a session | Marked against a scheduled, non-cancelled session. |

## Rules

- A session is created for every class day, for every class, using that class's default start time and duration.
- Per-day start time and duration are overrides; they never change the class default or other days.
- Admin removing a class day cancels every session on that day *(assumption)*.
- Times are Munich local time (Europe/Berlin) *(assumption)*.
- A student enrolled in several classes sees each class's sessions; overlapping times are not blocked (warning is an open question).

## Attendance intent

- States: **Coming**, **On leave**, **not answered** (default, treated as expected).
- Visible to: that class's teachers, classmates, and the student's team. Shows nickname + state only; no reason is collected for leave *(assumption)*.
- Set per session; date-range leave is an open question.
- Counts for streak protection only when set before the session's start time *(assumption)*.

## Attendance and streaks

- Attendance is marked per scheduled session, replacing marks against a free-chosen weekly date.
- A week with no non-cancelled session for the class is a holiday: it does not consume streak grace.
- A session the student missed with an announced leave does not consume grace.
- Streaks stay weekly: attending any session of a week qualifies that week *(assumption)*.
