---
title: '#51 Class schedules repeating every 1-4 weeks'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'b07b3f845c5371e18113a655059f513f734a94ec'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A class schedule is weekly only (weekdays + from/until), so a class that meets every other week has to be set up as separate classes (issue #51).

**Approach:** Add one "repeat every N weeks" setting (1, 2, 3 or 4) per class. A class day matches when its weekday is in the schedule, it lies within from/until, and its ISO week is a whole multiple of N weeks after the ISO week of the start date. Default 1, so every existing class behaves as today.

## Boundaries & Constraints

**Always:**
- One interval per class; it applies to all its weekdays (Sun+Wed every 2 weeks = both in on-weeks, neither in off-weeks).
- The pattern is fixed to the calendar, anchored on the Monday week of `schedule_starts_on`. A cancelled class day or holiday in an on-week loses that session; it never shifts later weeks.
- Streaks count only weeks in which one of the student's classes has a (non-cancelled, marked) session; off weeks neither count nor break a streak. This is already the 0021 rule and must stay so.
- Changing the interval regenerates sessions like any other schedule change (from today on; past, marked and extra sessions kept).
- Admin (create form + calendar) and the class's teachers (calendar) set it, like the rest of the schedule.

**Never:**
- No per-weekday interval, no "every N days/months", no interval > 4.
- Don't touch existing workaround classes or migrate data; don't change the streak function.
- Don't push the migration to the hosted DB (user step).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fortnightly | Sun, every 2, from Sun W0 | Sessions W0, W2, W4; none W1, W3 | N/A |
| Mid-week start | Sun+Wed, every 2, from Wed of W0 | Wed W0, Sun W0, Wed/Sun W2; nothing in W1 | N/A |
| Weekly default | no interval given / existing class | Same sessions as before | N/A |
| Cancelled on-week | W2 day cancelled | W2 lost, W4 still on | N/A |
| Invalid form value | interval "5", "0", "x" | Inline error on the Repeats field | nothing saved |
| Invalid RPC value | p_interval_weeks 5 | 22023 | generic toast |

</frozen-after-approval>

## Code Map

- The working tree also holds uncommitted story 7-3 changes (parent routes, `0025_parent_reads.sql`, messages, `rls.spec.ts` 7-3 block, `database.types.ts`). They are not this work: leave them as they are, and never run `supabase db reset` (use `migration up`).
- `supabase/migrations/0019_class_schedules.sql` -- schedule columns, `class_schedule_matches(date, smallint[], date, date)`, `create_sessions_for_class_day()`, `create_sessions_for_class()`, trigger `classes_regenerate_sessions` (AFTER UPDATE OF the 3 schedule columns), `set_class_schedule(uuid, smallint[], time, integer, date, date)` + grants/comments. Copy their bodies.
- `supabase/migrations/0021_attendance_per_session.sql` -- latest `regenerate_class_sessions()` (keeps sessions with marks); `compute_student_streak()` session-week rule (read-only, unchanged).
- `src/lib/server/calendar.ts:107-205` -- `ScheduleInput`, `ScheduleField`, `ScheduleFormValues`, `scheduleFormValues`, `parseScheduleInput`, `scheduleErrorMessages`.
- `src/lib/components/ScheduleFields.svelte` -- shared schedule fields (admin create + calendar).
- `src/routes/admin/classes/+page.server.ts:72-110` + `+page.svelte:28-44` -- create action inserts schedule columns; default schedule object.
- `src/routes/calendar/+page.server.ts:20-95,197-221` -- `ClassSchedule` load and `setClassSchedule` RPC call; `+page.svelte:441` passes schedule props.
- `src/lib/supabase/database.types.ts` -- hand-edit `classes` Row/Insert/Update and `set_class_schedule` Args (file also has uncommitted 7-3 edits; keep them).
- `messages/{en,de,bo}.json` -- `calendar_schedule_*` keys, `calendar_schedules_intro`.
- Tests: `src/lib/server/calendar.spec.ts` (parse), `src/routes/admin/classes/page.server.spec.ts:144`, `src/routes/calendar/page.server.spec.ts`, `src/lib/server/rls.spec.ts` 6-4 block (5815, `setSchedule` helper 5926) and 6-2 block (6281, helpers `sundays`, `createClass`, `teacherMark`, `homeworkDone`, `readStreak`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0026_schedule_interval.sql` -- add `classes.schedule_interval_weeks smallint not null default 1 check (between 1 and 4)`; new 5-arg `class_schedule_matches(..., p_interval_weeks)`; recreate the two create-session functions and `regenerate_class_sessions()` (0021 body) on it; recreate trigger `classes_regenerate_sessions` including the new column; drop 6-arg `set_class_schedule` and create a 7-arg one with `p_interval_weeks integer default 1` (validate 1-4, 22023) + grants/comment; drop the 4-arg matcher -- DB is the source of truth.
- [x] `src/lib/supabase/database.types.ts` -- add the column and RPC arg.
- [x] `src/lib/server/calendar.ts` -- `intervalWeeks` in values/input/field; empty = 1, `1-4` only, else 'invalid'; message `calendar_error_interval_invalid`.
- [x] `src/lib/components/ScheduleFields.svelte` -- `intervalWeeks` prop (default 1) and a "Repeats" `<select name="intervalWeeks">` with Every week / Every 2 / 3 / 4 weeks, with error wiring like the other fields.
- [x] `src/routes/admin/classes/+page.{server.ts,svelte}`, `src/routes/calendar/+page.{server.ts,svelte}` -- pass the interval through insert, load, RPC and props.
- [x] `messages/{en,de,bo}.json` -- label, 4 options, error; mention the repeat in `calendar_schedules_intro`.
- [x] Tests -- parse cases; admin create and calendar action pass the interval; RLS: fortnightly matching (matrix rows 1, 2, 4), interval edit regenerates, RPC rejects 5, streak across a fortnightly class's off weeks stays unbroken.

**Acceptance Criteria:**
- Given a class Sun every 2 weeks from W0 whose student qualifies in W0, W2 and W4, when the streak is computed, then it is 3 (off weeks W1, W3 neither break nor count).
- Given an existing class after the migration, then its interval is 1 and its sessions are unchanged.
- Given a weekly class switched to every 2 weeks, when saved, then future off-week sessions without marks are removed and past ones stay.

## Design Notes

Match rule (added to the weekday/from/until checks):
```sql
((date_trunc('week', p_day::timestamp)::date
  - date_trunc('week', p_starts_on::timestamp)::date) / 7) % p_interval_weeks = 0
```
Anchoring on the start date's week (not the date) keeps a Sun+Wed schedule starting on a Wednesday in step. `p_day >= p_starts_on` already guarantees a non-negative difference.

## Verification

**Commands:**
- `npx supabase migration up` -- applies 0026 locally without a reset.
- `npm test` -- all unit + RLS tests pass.
- `npm run check` and `npx eslint` on touched files -- no new errors.

## Implementation Notes

- `0026_schedule_interval.sql` applied locally with `npx supabase migration up` (not pushed to hosted). The 5-arg matcher guards `p_interval_weeks` with `greatest(coalesce(..,1),1)` so a NULL/0 can never divide by zero; the column check and RPC validation keep it at 1-4 anyway.
- `set_class_schedule` is 7-arg with `p_interval_weeks integer default 1` (last), so a 6-arg named call still works and means weekly.
- "Repeats" select sits first in the schedule grid of `ScheduleFields.svelte`; `bo.json` uses the English strings like its neighbouring `calendar_*` keys.
- Full `npm test`: all new/changed tests pass; 33 older RLS tests (Stories 1-1..5-1) fail on `classes_name_unique_idx` because fixed-name fixtures ("Class A", "Story 5-1 ...") from earlier runs remain in the local DB (no reset allowed). Unrelated to this change.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | verification-gap + blind | Calendar `load` mapping of `schedule_interval_weeks` → `intervalWeeks` is untested; a regression would silently save fortnightly classes as weekly | medium | No spec calls `load` (grep `classSchedules`). patch: add a load test; drop the dead `?? 1` (column is not null) |
| 2 | edge-case | Failed admin create echoing an invalid interval selects no option | low | Only reachable by tampering with a `<select>`; browser falls back to the first option; rejected |
| 3 | blind | `p_interval_weeks default 1` silently resets a class to weekly for callers that omit it | low | Every app caller passes it; old code during a deploy only meets weekly classes (all intervals are 1 before the new UI exists); rejected |
| 4 | blind | Editing "From" shifts which weeks are on | false | Frozen intent: the pattern is anchored on the week of the start date |
| 5 | blind | Sun+Mon every 2 weeks pairs Mon with the following Sun (ISO weeks run Mon-Sun) | low | Real but follows the frozen anchor (Monday week of start date), same weeks the month grid shows; rare; rejected, surfaced to user |
| 6 | blind | Interval change removes future off-week sessions with overrides/cancel flag | low | Pre-existing 6-4 regeneration rule for any schedule change (marked and extra sessions kept); rejected |
| 7 | blind | Matcher coalesces NULL/0 interval to 1 | false | Column is not null with a 1-4 check and the RPC validates; no caller can pass a bad value |
| 8 | blind | No test for explicit NULL interval to the RPC | low | patch: add null to the 22023 test |
| 9 | blind | No test that the column check rejects 5 on direct writes | low | patch: add a service-role update expecting 23514 |
| 10 | blind | No component test for the Repeats select | low | No component test harness in the repo; rejected |
| 11 | blind | `bo.json` new keys in English | false | Repo convention: other `calendar_*` keys in bo.json are English |
| 12 | blind | Error text "Choose every 1, 2, 3 or 4 weeks." reads "every 1 weeks" | low | patch: "Choose every week or every 2, 3 or 4 weeks." (en, bo) |
| 13 | blind | Regex rejects "02" / "2.0" | false | Input is a `<select>` sending 1-4 only |
