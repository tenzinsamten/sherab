---
title: 'Class schedules & extra sessions'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_revision: 'bed8ebc7a28db93ba37037fc777404ba0f15397b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-class-tracker/calendar.md'
  - '{project-root}/_bmad-output/specs/spec-class-tracker/stories/6-1-class-days-sessions.md'
warnings: ['oversized']
deferred:
  - summary: >-
      No test puts a class day on today's Berlin date, so the regeneration cutoff (day >= today) is unverified at its boundary.
    evidence: |-
      Story 6-4 rls.spec scenarios use only past (1901-1999) and far-future (3000+) years; class days are unique school-wide and persist between runs, so a today-dated fixture needs its own strategy.
    location: >-
      supabase/migrations/0019_class_schedules.sql regenerate_class_sessions
    severity: low
  - summary: >-
      Schedule regeneration hard-deletes non-matching sessions from today on without regard to rows that will reference sessions (attendance in 6-2, leave in 6-3).
    evidence: |-
      Safe now because nothing references class_sessions yet (Design Notes). When 6-2 adds attendance, regeneration must keep or refuse to delete sessions with dependent rows, including today's already-held session.
    location: >-
      supabase/migrations/0019_class_schedules.sql regenerate_class_sessions
    severity: medium
  - summary: >-
      The RLS/DB suites skip silently without a local Supabase and there is no CI, so trigger, regeneration and function authorization are only checked on developer machines.
    evidence: |-
      Every story block in src/lib/server/rls.spec.ts is describe.skipIf(!reachable); the repo has no .github workflow. Pre-existing, repo-wide (also deferred in 6-1 VG4).
    location: >-
      src/lib/server/rls.spec.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 6-1 gives every class a session on every admin class day, so a class cannot choose its weekdays, say until when it runs, or hold an occasional extra session (SPEC CAP-10 as amended 2026-09-26, `planning-artifacts/sprint-change-proposal-2026-09-26.md`).

**Approach:** Each class gets one schedule — ISO weekdays, one start time + duration, a start date and an optional end date — set by the admin or any teacher of the class (also when the admin creates a class). Sessions are created only on admin class days matching the schedule; an extra one-off session can be added for a class on any other class day. Changing a schedule regenerates the class's sessions dated today (Berlin) or later.

## Boundaries & Constraints

**Always:** Admin class days stay the only days a session can exist on (CAP-9). A session matches when `extract(isodow from day)` is in the class's weekdays and `starts_on <= day` and (`ends_on` is null or `day <= ends_on`); cancelled class days count as class days. The schedule time reuses `classes.default_start_time` / `default_duration_minutes`; per-session overrides and cancel work as in 6-1. Regeneration touches only sessions whose class day is today (Berlin, `(now() at time zone 'Europe/Berlin')::date`) or later: still-matching sessions keep overrides and cancel flag, non-matching non-extra sessions are removed, missing matching ones are inserted; extra sessions are never removed by regeneration. One session per class per class day (existing unique constraint). New class default schedule: Sunday only, starts today (Berlin), no end, time unset. The migration keeps every existing session and derives each existing class's schedule from it (weekdays = distinct isodow of the class days it has sessions on, else Sunday; `starts_on` = earliest such day, else today; no end). Authorization only through SECURITY DEFINER functions checking `is_admin() or is_teacher_of_class()`; no new client insert/delete grants on `class_sessions`. Munich wall-clock dates/times. Paraglide en/de/bo; WCAG 2.2 AA; iX components as in #47.

**Never:** No attendance, streak or leave changes (6-2, 6-3). No per-weekday times. No sessions on days that are not class days. No hard delete of past sessions or of class days. No change to CAP-9 class-day rules or the month-grid behaviour beyond what this story names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Schedule match | Class Sun+Wed, 10:00/90, 2026-10-01..2026-12-20; class days Sun 10-04, Wed 10-07, Sat 10-10, Sun 12-27 | Sessions on 10-04 and 10-07 only | N/A |
| New class | Admin creates class, form Sun, 10:00/90, from today | Sessions on future Sunday class days from today; none before | Invalid form → inline error, class not created |
| Add class day | Admin adds Wed 10-14 | Sessions only for classes whose schedule includes Wed and covers 10-14 | N/A |
| Schedule edit | Today 10-20; Sun → Sat | Sessions before 10-20 unchanged; future Sunday non-extra sessions removed; future Saturday class days get sessions; a still-matching future session keeps its override and cancel | N/A |
| Extra session | Sun-only class; Sat class day 10-10, 14:00/60 | Session on 10-10 at 14:00, marked extra, kept by later schedule edits | Class already has a session that day → error in dialog |
| Invalid schedule | No weekday, until before from, duration outside 15–480, bad time | Nothing saved | Inline validation per field |
| Other teacher / student | Not a teacher of the class | Cannot set schedule or add extra | Denied (42501) → generic error |
| Migration | Class with sessions on Sundays (some cancelled) | Weekdays {Sun}, starts_on = earliest session day, no end; session count and every session's overrides/cancel unchanged | Migration aborts if counts differ |

</intent-contract>

## Code Map

- `supabase/migrations/0018_calendar.sql` -- read-only precedent. `set_class_default` (38–66) = SECURITY DEFINER + `is_admin() or is_teacher_of_class()` + 42501/P0002 errors to mirror; triggers `create_sessions_for_class_day` / `create_sessions_for_class` (172–216) are what 0019 replaces; `class_sessions` (113–151) unique `(class_id, class_day_id)`, update grants on override/cancel columns only; view `class_sessions_effective` (222–247) needs an `extra` column added (recreate view).
- `supabase/migrations/0019_class_schedules.sql` -- new. Next free number (last is 0018).
- `src/lib/server/calendar.ts` -- `parseTimeInput` (84), `parseDurationInput` (92), `isIsoDate` (26), `shapeSession` (165), `CalendarSession` type; add schedule parsing (weekdays 1–7, from/until) and carry `extra` through shaping.
- `src/lib/berlin-date.ts:17` -- `todayInBerlin()` for the form's default "from".
- `src/routes/calendar/+page.server.ts` -- load selects classes for `canEdit` (60–77, `classDefaults`); action `setClassDefault` (174–198, returns `action: 'defaultSaved'`) becomes a schedule action; add an extra-session action. Keep `updateSession` / `setSessionCancelled` / class-day actions unchanged.
- `src/routes/calendar/+page.svelte` -- defaults section (~390–430) becomes "Class schedules"; success-toast map and "keep dialog open on `defaultSaved`" rule (~181–190); `onDateClick` (216) and `dayCellContent` (331) currently open the day dialog for admin only; day modal (~567+) is where "Add extra session" goes; `eventContent` / session dialog show an "Extra" label.
- `src/lib/calendar-events.ts` -- carries `CalendarSession` into chips; no logic change expected beyond the new field.
- `src/routes/admin/classes/+page.server.ts:56–100` -- `create` action inserts via `insertClassWithUniqueCode`; after insert, set the schedule through the new RPC. `+page.svelte` -- create form.
- `src/lib/supabase/database.types.ts` -- hand-merge new columns / functions (6-1 note: keep hand-typed columns).
- `src/lib/server/rls.spec.ts:5118` -- Story 6-1 block. Its "new class gets sessions on existing days" and class-day tests assume every class matches every day; update them to set schedules, then append a Story 6-4 block after it.
- `src/routes/calendar/page.server.spec.ts` -- tests `setClassDefault`; update for the new actions.
- `e2e/fixtures.ts:120–200` -- classes are inserted with the service role before class days (196) on a random year's Oct 4/11/18; with schedule matching, set each fixture class's schedule columns directly (service role, before inserting class days) to include those dates' weekday, or no sessions appear.
- `messages/{en,de,bo}.json` -- `calendar_*` keys; replace `calendar_defaults_*` wording with schedule wording, add weekday labels, extra-session strings, schedule errors.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- read-only; the "class created mid-year gets sessions on every past class day" entry is resolved by `starts_on`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0019_class_schedules.sql` -- `classes.schedule_weekdays smallint[]` (non-empty, values 1–7), `schedule_starts_on date`, `schedule_ends_on date` (check `>= starts_on`); `class_sessions.extra boolean not null default false`; backfill per Always, wrapped in a count check that raises if `class_sessions` count changes; replace both 0018 triggers with schedule matching; `set_class_schedule(class_id, weekdays, start_time, duration, starts_on, ends_on)` SECURITY DEFINER with validation + future regeneration; `add_extra_session(class_id, class_day_id, start_time, duration)` SECURITY DEFINER (error if the class already has a session that day); recreate `class_sessions_effective` with `extra`; grants mirroring 0018 -- the schedule model.
- [x] `src/lib/supabase/database.types.ts` -- add columns, view column and functions -- typed client.
- [x] `src/lib/server/calendar.ts` + `.spec.ts` -- schedule input parsing/validation and `extra` in `CalendarSession`; unit-test the Invalid-schedule row -- pure validation.
- [x] `src/routes/calendar/+page.server.ts` + `page.server.spec.ts` -- load schedule fields; `setClassSchedule` action (replaces `setClassDefault`) and `addExtraSession` action with server validation and error mapping -- server contract.
- [x] `src/routes/calendar/+page.svelte` -- "Class schedules" section (weekday checkboxes Mon–Sun, time, duration, from, until); day dialog for admin and for teachers on class days showing "Add extra session" (class select limited to editable classes without a session that day, time, duration); "Extra" label in session dialog/chip -- UI.
- [x] `src/routes/admin/classes/+page.server.ts` + `+page.svelte` -- schedule fields on create (default Sunday, from today) -- schedule at creation.
- [x] `messages/{en,de,bo}.json` -- new and renamed keys.
- [x] `src/lib/server/rls.spec.ts` -- adapt 6-1 block; Story 6-4 block covering matrix rows Schedule match, Add class day, Schedule edit, Extra session, Other teacher / student, and the backfill rule -- DB behaviour.
- [x] `e2e/fixtures.ts` + `e2e/calendar.e2e.ts` -- fixtures set schedules; add E2E for editing a schedule in the UI and adding an extra session from the day dialog -- UI rows.

**Acceptance Criteria:**
- Given a class scheduled Sun+Wed until 2026-12-20, when any role that can see it opens October–December 2026, then its chips appear only on Sunday and Wednesday class days up to that date.
- Given a teacher of the class, when they save a new schedule on `/calendar`, then the month grid reloads showing future sessions per the new schedule and past sessions unchanged.
- Given the admin clicks a Saturday class day, when they add an extra session for a Sunday-only class, then its chip appears on that Saturday.

## Spec Change Log

## Review Triage Log

### 2026-09-26 — Review pass
- verdicts: 39 findings — high 0, medium 10, low 28, false 1, maybe-false 0
- findings:
  - `medium` `patch` IA1 "keeps past ones" checked at row level only; saving a schedule time changes how past non-overridden sessions display — fixed (P1): set_class_schedule freezes the old time/duration onto past NULL-override sessions before changing the class time; rls.spec asserts a past session keeps 10:00/90.
  - `medium` `patch` IA2 schedule at creation only tested with fakes; create is non-atomic — fixed (P2): schedule columns written in the class insert, follow-up RPC and scheduleFailed removed; unit + new E2E create test.
  - `low` `patch` IA3 extras allowed wider than the UI (past, cancelled days) — cancelled days refused (P3); past days stay allowed (6-1 decision: past sessions editable).
  - `false` `reject` IA4 regeneration trigger fires on any direct write to schedule columns — only the admin can UPDATE classes (RLS), and firing on every write is the intended guarantee.
  - `medium` `defer` IA5 DB behaviour tested only in rls.spec, which skips without local Supabase; no CI — pre-existing repo-wide pattern; deferred.
  - `medium` `defer` IA6 design relies on 6-2 coming later (deletes sessions nothing references yet) — deferred: 6-2 must stop regeneration deleting sessions with dependent rows.
  - `medium` `patch` BH1 saving a schedule silently changes past sessions' displayed time — same root cause as IA1, fixed by P1.
  - `medium` `defer` BH2 regeneration deletes today's session and ignores dependent rows — "from today on" is the stated intent (today stays in scope); dependent-row part deferred with IA6.
  - `low` `reject` BH3 backfill gives every class the union of all class-day weekdays — this is the approved backfill rule (sprint-change-proposal-2026-09-26); flagged to the user as a post-deploy check, not a code defect.
  - `medium` `patch` BH4 class create not atomic; scheduleFailed path untested — fixed by P2 (flag and toast removed).
  - `low` `reject` BH5 setClassSchedule 400 vs 403, no classId check, error not tied to the form — only reachable with crafted requests; the app-wide error toast still shows.
  - `low` `reject` BH6 invalid weekday / missing start date get generic messages — weekday 'invalid' needs a crafted POST; empty From shows a date error, acceptable wording.
  - `low` `patch` BH7 extra session on a cancelled class day — fixed (P3): add_extra_session raises 22023, form hidden on cancelled days; rls.spec asserts.
  - `low` `reject` BH8 extra flag never clears when the day later matches — extras are never removed by design; the pill is accurate about how it was created.
  - `low` `reject` BH9 set_class_default still granted — reachable only via a crafted RPC by a teacher of that class; its write is already authorised.
  - `low` `reject` BH10 ScheduleFields imports a type from $lib/server — type-only import, erased at build; same pattern accepted in #47 review.
  - `low` `reject` BH11 missing tests (teacher extra submit/duplicate error in dialog, dayId missing, schedule kept on duplicate name) — duplicate path covered in rls.spec; UI variants are edge cases. Admin create E2E added under VG3.
  - `low` `patch` BH12 backfill test can fail on leftover class days in the same random year — fixed: schedule bounded to sun1..sun2.
  - `low` `reject` BH13 hand-written types miss class_schedule_matches — the client never calls it.
  - `low` `patch` BH14 weekday checkboxes lack aria-invalid — fixed via an attachment setting aria-invalid/aria-describedby (plain attributes re-ticked boxes; E2E caught it).
  - `low` `patch` BH15 empty name hides schedule errors on create — fixed: both validated and returned together; unit test.
  - `low` `patch` VG1 Until date round-trip through load/form untested — fixed: E2E asserts Until shows and survives failed and weekday-only saves.
  - `low` `patch` VG2 scheduleFailed path untested — superseded by P2 (flag removed).
  - `low` `patch` VG3 admin create form defaults never rendered in a test — fixed: new E2E (defaults Sun + today, create, toast, stored schedule, cleanup).
  - `low` `defer` VG4 regeneration cutoff never tested on today's date — deferred as filed (needs a fixture strategy for today-dated class days).
  - `low` `reject` VG-o1 weekday 'invalid' maps to "Pick at least one weekday" — crafted POST only.
  - `medium` `defer` VG-o2 rls suites skip without local Supabase, no CI — same as IA5; deferred.
  - `low` `patch` EC1 add_extra_session on a cancelled class day — P3.
  - `low` `patch` EC2 day dialog offers extra session on a cancelled day — P3.
  - `medium` `patch` EC3 create with past From yields no past sessions — fixed by P2 (insert trigger matches from From).
  - `low` `reject` EC4 concurrent class-day insert vs schedule change — admin-only, rare; same call as 6-1 EC7.
  - `low` `patch` EC5 empty name + invalid schedule need two submits — same as BH15, fixed.
  - `low` `reject` EC6 setClassSchedule error not attributed / 400 for 42501 — same as BH5.
  - `low` `reject` EC7 addExtraSession with empty dayId shows no error — crafted request only.
  - `low` `reject` EC8 setClassSchedule sends empty classId to the DB — crafted request only; DB rejects it.
  - `low` `reject` EC9 schedule change deletes today's already-held session — within the stated intent ("from today on"); dependent-row risk deferred (IA6).
  - `low` `reject` EC10 set_class_default left granted — same as BH9.
  - `medium` `patch` EC11 claim: admin creating a class with past From expects sessions from that date — fixed by P2.
  - `low` `patch` EC12 claim: extras allowed on cancelled days — P3; matching days only possible when the scheduled session was regenerated away, which is consistent.

## Auto Run Result

**Summary:** Classes now have one schedule (ISO weekdays, one start time + duration, from, optional until), set on `/calendar` ("Class schedules") by the admin or the class's teachers and on the admin create-class form. Sessions exist only on admin class days matching the schedule; extra one-off sessions can be added on other class days (not cancelled ones). Changing a schedule regenerates sessions from today (Berlin); past sessions keep their time. Migration 0019 derives existing classes' schedules from their sessions and aborts if any session changes.

**Files changed:**
- `supabase/migrations/0019_class_schedules.sql` -- schedule columns, `extra`, matching triggers, regeneration trigger, `set_class_schedule` (with past-session freeze), `add_extra_session`, view, backfill + integrity check.
- `src/lib/supabase/database.types.ts` -- new columns and functions.
- `src/lib/server/calendar.ts` + `.spec.ts` -- schedule parsing/validation, error messages, `extra` in sessions.
- `src/lib/components/ScheduleFields.svelte` -- shared schedule fields (weekday checkboxes with error state).
- `src/lib/pending.svelte.ts` -- `{ reset: false }` option.
- `src/routes/calendar/+page.server.ts` + `page.server.spec.ts` -- schedule load, `setClassSchedule`, `addExtraSession`.
- `src/routes/calendar/+page.svelte` -- "Class schedules" section, teacher day dialog on class days, "Add extra session", "Extra" label.
- `src/routes/admin/classes/+page.server.ts` + `+page.svelte` + `page.server.spec.ts` -- schedule on create (atomic insert).
- `src/lib/calendar-events.spec.ts` -- `extra` field.
- `src/lib/server/rls.spec.ts` -- 6-1 block adapted; Story 6-4 block.
- `e2e/fixtures.ts`, `e2e/calendar.e2e.ts` -- schedules in fixtures; schedule edit, extra session, teacher day dialog, create-class tests.
- `messages/{en,de,bo}.json` -- schedule and extra-session strings (bo in English, as for other recent keys).

**Review findings:** 39 findings (high 0, medium 10, low 28, false 1). Patched entries: P1 past-session freeze (medium), P2 atomic create with schedule (medium), P3 no extras on cancelled days (low), weekday aria-invalid (low), name + schedule errors together (low), and tests for Until round-trip, admin create E2E, deterministic backfill test. Deferred: 3 (see frontmatter `deferred`). Rejected: 17, each with its reason in the triage log.

**Follow-up review recommended:** true -- two medium entries were patched (patched counts: high 0, medium 2, low 3 plus test gaps). Unverified risk: the post-review `set_class_schedule` freeze logic and the new atomic create insert path were not seen by an independent reviewer; in particular the freeze's interaction with a schedule change that clears the time (NULL) and with extra sessions.

**Verification:**
- `npx supabase migration up` / local re-apply of the final 0019 in one transaction (no reset): session count unchanged (54043), integrity checks passed.
- `npm run check`: 0 errors, 0 warnings.
- `npx eslint` / `npx prettier --check` on changed files: clean.
- `npm test`: 247 passed, 33 failed — every failure is `classes_name_unique_idx` in the Story 1-1 … 5-1 RLS blocks (fixed class names colliding with rows left by earlier local runs); all Story 6-1 and 6-4 tests and unit tests pass. One earlier run hit a rare `classes_code_key` collision in the 6-1 block (pre-existing 4-hex code); two reruns passed.
- `npm run test:e2e`: 19 passed.

**Residual risks:**
- Backfill gives each existing class the weekdays of all class days it had sessions on (6-1 gave every class every day), so a one-off class day on another weekday becomes a weekly slot for every class until schedules are edited. Admins should review schedules after deploying.
- Regeneration deletes non-matching sessions from today on; before 6-2 adds attendance this must respect dependent rows (deferred).
- 0019 is applied locally only; it must be pushed to the hosted database before this code runs there.
- Local re-apply dropped the `extra` flag on extra sessions left from earlier local test runs (test data only).

## Design Notes

Regeneration lives inside `set_class_schedule` (one transaction, SECURITY DEFINER) so no client ever needs insert/delete on `class_sessions`. Deleting non-matching future sessions is safe now because nothing references sessions yet (6-2 adds attendance). Example of the matching predicate:

```sql
extract(isodow from d.day)::smallint = any (c.schedule_weekdays)
  and d.day >= c.schedule_starts_on
  and (c.schedule_ends_on is null or d.day <= c.schedule_ends_on)
```

## Verification

**Commands:**
- `npx supabase migration up` -- expected: 0019 applies to the running local stack (count check passes). Never run `supabase db reset` / `npm run supabase:reset`: it wipes the local database.
- `npm test` -- expected: pass incl. new unit and RLS blocks (known local-data failures excepted only if unrelated).
- `npm run check` -- expected: 0 errors.
- `npx eslint` / `npx prettier --check` on changed files -- expected: clean.
- `npm run test:e2e` -- expected: all pass.

**Manual checks (if no CLI):**
- As admin and as a teacher: edit a schedule, add an extra session, create a class with a schedule; past sessions stay.
