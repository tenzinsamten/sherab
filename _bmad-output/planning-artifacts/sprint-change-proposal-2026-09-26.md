---
title: "Sprint Change Proposal — Per-class schedules (#48)"
created: 2026-09-26
status: approved
trigger: "_bmad-output/manual-verification-issues.md #48 (and #49)"
mode: batch
scope: moderate
---

# Sprint Change Proposal — Per-class schedules (#48)

## 1. Issue Summary

**Trigger:** manual verification of epic 6 after story 6-1 (class days & sessions) and #47
(month grid). Issue type: **new requirement from the stakeholder** (the user / school admin).

**Problem:** 6-1 gives every class a session on every class day the admin adds. A class cannot
choose its own weekdays, and nothing says until when it runs. The user's words (2026-09-26):

> "when you create or schedule a class, the start time, duration and till what date and which
> days in the week should be configurable."
>
> "Add class days is the days on which classes will happen and then each class can take a slot
> from it."
>
> "Usually it's just one [time], but I should be able to schedule extra classes if required."

**Evidence:** `supabase/migrations/0018_calendar.sql` triggers `create_sessions_for_class_day()`
and `create_sessions_for_class()` insert a session for every (class, class day) pair. #49 shows
the resulting confusion: saving a class default time showed nothing because no class days existed
in that month.

**Decisions taken in this session (user, 2026-09-26):**

- Admin class days **stay** as the school-wide pool of open days (Sunday usual; extra days such as
  a Friday or Saturday are added ad hoc). CAP-9 is unchanged.
- Each class has **one** schedule: weekdays, one start time + duration, start date, optional end
  date ("till what date"). Different times per weekday are not needed.
- **Extra sessions:** a class can get an additional one-off session on a class day outside its
  weekdays, with its own time.
- **Who:** the admin or any teacher of the class (same as today's class defaults).
- **Schedule changes:** sessions from today on are regenerated; past sessions are kept.

## 2. Impact Analysis

### Checklist summary

| Item | Status | Note |
|---|---|---|
| 1.1–1.3 Trigger, problem, evidence | [x] | See §1 |
| 2.1 Current epic (6) | [!] | Completable, needs one new story before 6-2 |
| 2.2 Epic-level change | [x] | Modify epic 6 scope (add story), no new epic |
| 2.3–2.4 Other epics | [N/A] | Epics 1–5 done and unaffected; the Parent PRD draft (2026-09-26) only reads sessions |
| 2.5 Order | [!] | New story must land before 6-2 (attendance references sessions) |
| 3.1 PRD / SPEC.md | [!] | CAP-10 intent + success change; CAP-9, CAP-11 unchanged |
| 3.2 Architecture | [N/A] | Spine has no calendar content; RLS pattern (`is_admin()` / `is_teacher_of_class()`) reused |
| 3.3 UX | [N/A] | UX docs predate the calendar; UI change is described in the story |
| 3.4 Other artifacts | [!] | `calendar.md`, `stories.yaml`, `epic-6-context.md` (stale cache), `deferred-work.md` entry resolved |
| 4.1 Direct adjustment | [x] | Viable — chosen |
| 4.2 Rollback | [N/A] | 6-1 and #47 stay; only session creation changes |
| 4.3 MVP review | [N/A] | MVP unaffected |

### Epic impact

Epic 6 (Calendar) gains story **6-4 Class schedules & extra sessions**, built **before** 6-2.
6-2 (attendance per session) and 6-3 (Coming / On leave) are unchanged in scope; they simply build
on sessions that now follow each class's schedule.

### Story impact

| Story | Status | Impact |
|---|---|---|
| 6-1 Class days & sessions | done | Stays done. Its "every class on every class day" rule is superseded by 6-4. |
| #47 Month grid | built (`acefca9`) | No change; chips follow whatever sessions exist. The "Class defaults" section is renamed and extended by 6-4. |
| **6-4 Class schedules & extra sessions** | **new** | See §4. |
| 6-2 Attendance per session | not built | Build after 6-4. No scope change. |
| 6-3 Coming / On leave | not built | No change. |

### Technical impact

- **Database (new migration 0019):** schedule columns on `classes` (weekdays, starts on, ends on),
  reusing `default_start_time` / `default_duration_minutes` as the schedule time; an
  `extra` flag (or equivalent) on `class_sessions`; the two 0018 triggers replaced by
  schedule matching; a security-definer function to set a schedule and regenerate future
  sessions; a function to add / remove an extra session. **0018 is live on the hosted
  database**, so the migration must convert existing data without losing a session.
- **App:** `/calendar` "Class defaults" becomes "Class schedules" (weekdays, time, duration,
  from, until); the admin class create form gets the same fields; the session dialog / day
  dialog gain "Add extra session" for the admin and the class's teachers.
- **Tests:** unit tests for schedule matching, RLS tests for who may set schedules / add extras,
  E2E rows for the new flows.

## 3. Recommended Approach

**Direct adjustment:** add one story (6-4) to epic 6 and amend the calendar spec.

- **Why:** the change is additive to 6-1's model (class days, sessions, overrides, cancellation
  and the month grid all stay). Only *which* sessions get created changes. Doing it before 6-2
  avoids backfilling attendance onto sessions that would later be regenerated.
- **Effort:** one story, medium (one migration with data conversion, two UI forms, tests).
- **Risk:** medium — the migration runs against live hosted data; mitigated by a conversion
  that keeps every existing session and a test proving it.
- **Timeline:** 6-2 and 6-3 move back by one story.

## 4. Detailed Change Proposals

### 4.1 `specs/spec-class-tracker/SPEC.md` — CAP-10

```
OLD
- **CAP-10**
  - **intent:** Each class has a default start time and duration; every class day gets a session
    for the class with those defaults, and any teacher assigned to the class can change a single
    day's start time and duration or cancel that day.
  - **success:** Changing or cancelling one day leaves the default and all other days untouched,
    and the class's students see that day's actual start time and duration. See `calendar.md`.

NEW
- **CAP-10**
  - **intent:** Each class has a schedule — the weekdays it runs on, one start time and duration,
    a start date and an optional end date — set by the admin or any teacher assigned to the class.
    The class gets a session on every class day that matches its schedule, and may get extra
    one-off sessions on other class days. Any teacher assigned to the class can change a single
    session's start time and duration or cancel it.
  - **success:** A class only has sessions on class days matching its schedule or added as
    extras; changing the schedule regenerates sessions from today on and never touches past
    sessions; changing or cancelling one session leaves the schedule and all other sessions
    untouched, and the class's students see that session's actual start time and duration.
    See `calendar.md`.
```

Rationale: the stakeholder wants per-class weekdays, time, duration and end date; class days
remain the pool (CAP-9 unchanged, including "no session on an unmarked day").

### 4.2 `specs/spec-class-tracker/calendar.md` — Layers and Rules

```
OLD (Layers)
| Class default | Any teacher of the class | Default start time + duration | Applied to every class day unless overridden. |
| Session | Any teacher of the class | One class on one class day: start time, duration, cancelled flag | Exists only on a class day. Editing one session never changes the default or other sessions. |

NEW (Layers)
| Class schedule | Admin or any teacher of the class | Weekdays, one start time + duration, start date, optional end date | Picks the class's sessions from the admin's class days. Usually Sunday. |
| Extra session | Admin or any teacher of the class | One additional session of the class on a class day outside its schedule, with its own time | Only on an existing class day. |
| Session | Any teacher of the class | One class on one class day: start time, duration, cancelled flag | Exists only on a class day, from the schedule or as an extra. Editing one session never changes the schedule or other sessions. |
```

```
OLD (Rules, first bullet)
- A session is created for every class day, for every class, using that class's default start
  time and duration.

NEW (Rules)
- A class gets a session on a class day when the day's weekday is one of the class's weekdays and
  the day lies between the schedule's start date and (if set) end date. Extra sessions come on top.
- A new class starts with a Sunday, weekly, from-today schedule and no time set, until someone
  edits it *(assumption)*.
- Changing a schedule regenerates the class's sessions dated today or later: still-matching
  sessions keep their own time and cancellation, no-longer-matching ones are removed, missing
  ones are added. Sessions before today are never changed.
- Adding a class day creates sessions only for classes whose schedule matches that day.
```

The remaining rules (per-session overrides, cancelling a class day cancels its sessions, Munich
time, several classes per student) stay as they are.

### 4.3 `specs/spec-class-tracker/stories.yaml` — new story 6-4, order note on 6-2

Insert after the 6-1 entry:

```yaml
- id: "6-4"
  title: Class schedules & extra sessions
  description: >-
    Each class has a schedule — weekdays (usually Sunday), one start time
    and duration, a start date and an optional end date — set by the admin
    or any teacher of the class, also when the admin creates a class. A
    class gets a session only on the admin's class days that match its
    schedule; the admin or a class teacher can add an extra session for
    the class on any other class day. Changing a schedule regenerates
    sessions from today on and keeps past ones. See SPEC.md CAP-9, CAP-10
    and calendar.md. Build before 6-2.
  spec_checkpoint: true
  done_checkpoint: true
  invoke_dev_with: >-
    Replaces 0018's create_sessions_for_class_day() /
    create_sessions_for_class() "every class on every class day" with
    schedule matching; reuse classes.default_start_time /
    default_duration_minutes as the schedule time rather than a parallel
    table unless justified. 0018 is live on hosted: the migration must
    keep every existing session — existing classes get weekdays = the
    weekdays of the class days they have sessions on, start date = their
    earliest session, no end date — prove it with a test. Regeneration
    touches only sessions dated today (Berlin) or later; a still-matching
    future session keeps its override and cancellation. Extras only on an
    existing class day (CAP-9). Keep is_admin()/is_teacher_of_class()
    RLS and security-definer writes. UI: /calendar "Class defaults" →
    "Class schedules"; schedule fields on the admin class create form;
    "Add extra session" for admin and the class's teachers. Paraglide
    en/de/bo. Resolves the deferred-work entry "A class created mid-year
    gets sessions on every past class day".
```

In the 6-2 entry description, append: `Build after 6-4.`

Rationale: id 6-4 avoids renumbering 6-2/6-3, which are referenced from the 6-1 story, the
epic-6 context, `deferred-work.md` and the spec memlog; build order is stated explicitly instead.

### 4.4 `implementation-artifacts/epic-6-context.md` — refresh

The cached epic context lists 6-1..6-3 and "6-1 is the foundation". Delete it so the next
`bmad-build` of 6-4 recompiles it from the updated spec (the compile step regenerates it when
missing).

### 4.5 `manual-verification-issues.md` — #48 / #49 status

Mark #48 "planned (story 6-4, sprint-change-proposal-2026-09-26)" and #49 "explained — no class
days in that month; resolved by 6-4's schedules".

## 5. Implementation Handoff

**Scope: Moderate** — backlog reorganization (new story, build order) plus a normal build.

| Step | Who / skill | Deliverable |
|---|---|---|
| 1. Apply §4.1–4.5 | this workflow, after approval | Updated spec, stories.yaml, logs |
| 2. Build 6-4 | `bmad-build` with `spec_folder = specs/spec-class-tracker`, story `6-4` | Story spec (planning + approval), migration 0019, UI, tests, review |
| 3. Push 0019 | user | Hosted database migrated (after local verification) |
| 4. Continue | `bmad-build` 6-2, then 6-3 | Attendance per session, Coming / On leave |

**Success criteria for 6-4:**

- A class set to Sunday + Wednesday, 10:00, 90 min, until 2026-12-20 has sessions exactly on the
  admin's class days that are Sundays or Wednesdays up to that date.
- An extra Saturday session can be added on a Saturday class day and shows on the calendar.
- Editing a schedule changes future sessions only; past sessions and their data are unchanged.
- After the migration, every session that existed before still exists with the same time and
  cancellation state.
- A teacher can set schedules and add extras only for classes they teach.
