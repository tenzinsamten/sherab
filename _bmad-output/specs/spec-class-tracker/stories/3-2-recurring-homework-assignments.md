---
title: 'Recurring Homework Assignments'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c731f368e49bce93e86ef376a14929357bcfcd25'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3-1 only supports one-off homework — a teacher who wants a standing weekly assignment (e.g. "practice your lines every week") has to manually recreate it every single week, which nobody will actually do.

**Approach:** A teacher sets a weekly repeat cadence on an assignment; each period auto-generates a new `homework_instances` row via a scheduled `pg_cron` job calling a trusted SQL function — no manual re-creation, no client-facing insert path for recurring instances. Each generated instance carries fully independent Done/Reviewed status, exactly like a one-off assignment. Editing the series (title, reference link, due-date offset) or pausing/ending it only ever changes `homework_assignments`; already-generated instances are never mutated, so past instances are structurally untouchable by construction, not by policy.

## Boundaries & Constraints

**Always:** Recurring-instance generation runs only through the `pg_cron`-scheduled `SECURITY DEFINER` function's trusted connection — the existing RLS restriction (Story 3-1) that blocks direct client inserts into `homework_instances` for a recurring assignment stays exactly as-is; this story adds the trusted generator, never a client-side bypass. Editing a series never UPDATEs `homework_instances` — title/reference_link changes on `homework_assignments` are read fresh by every future display; `due_offset_days` changes only affect instances not yet generated, since `due_date` is computed once at generation time. `homework_instances_update_admin_or_assigned_teacher`'s existing unrestricted-column gap (deferred from Story 3-1) gets closed here via column-level `GRANT`/`REVOKE` (`archived_at`/`archived_by` only) — PostgREST enforces this independently of RLS's row-level check, no new policy logic needed. Recurring assignments are visually distinguishable from one-off ones (a repeat indicator) wherever assignments are listed.

**Never:** Do not build anything beyond weekly cadence — `recurrence_rule.frequency` only ever accepts `"weekly"` this story. Do not touch or regenerate any already-created `homework_instances` row for any reason (edit, pause, or end). Do not provision a hosted Supabase cron trigger or Edge Function — `pg_cron` runs inside the existing local Postgres instance, consistent with every prior story's "no production hosting" boundary.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teacher creates a recurring assignment | Weekly cadence, start date, due offset | `recurrence_rule` set on `homework_assignments`; no instance created yet (generator creates the first on its next run, not synchronously) | N/A |
| Generator runs | An active (not paused/ended), due recurring assignment with no instance yet for the current period | New `homework_instances` row created, with fresh `assigned` rows for the then-current approved roster | N/A |
| Generator runs again | Instance for the current period already exists | No duplicate row (`UNIQUE(assignment_id, period_start)` from Story 3-1 backstops this) | N/A |
| Teacher edits series title/link | Active recurring assignment | Every instance (past and future) displays the new title/link on next read — no instance row touched | N/A |
| Teacher edits due-date offset | Active recurring assignment | Already-generated instances keep their original `due_date`; only instances generated after the edit use the new offset | N/A |
| Teacher pauses/ends a series | Recurring assignment with already-generated future instances | Generator stops creating new rows; already-generated instances are left exactly as-is, fully valid and completable | N/A |
| Direct client insert into `homework_instances` for a recurring assignment | Bypassing the UI | RLS rejects it — unchanged from Story 3-1 | N/A |
| Direct client UPDATE of `due_date`/`period_start` on any instance | Bypassing the UI, admin or assigned teacher | Rejected at the column-privilege level, not just RLS | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0005_recurring_homework.sql` (new) -- enable `pg_cron` extension; `generate_recurring_homework_instances()` `SECURITY DEFINER` function: for every `homework_assignments` row with `recurrence_rule IS NOT NULL`, not paused, not past `ends_on`, and due for its next weekly period with no existing instance for that `period_start`, insert the instance (`due_date = period_start + due_offset_days`) plus `assigned` rows for the then-current approved roster (reusing Story 2-1/3-1's `role='student' and status='approved'` pattern) -- all inside the function body, run as its owner, exactly the "trusted connection" Story 3-1's RLS comment already anticipates. `cron.schedule(...)` calling this function on a sensible interval (e.g. daily) -- document the choice inline, per epic context's explicit instruction not to treat it as pre-decided. New `homework_assignments` UPDATE policy (`is_admin() or is_teacher_of_class(class_id)`, mirroring 3-1's instance policy) so title/reference_link/recurrence_rule edits are possible. Column-level `REVOKE UPDATE ON homework_instances FROM authenticated; GRANT UPDATE (archived_at, archived_by) ON homework_instances TO authenticated;` to close the deferred Story 3-1 gap.
- `src/routes/teacher/classes/[id]/homework/+page.server.ts` -- extend `createAssignment` to accept a recurrence toggle (weekly cadence + due offset), writing `recurrence_rule` instead of leaving it `NULL`; add `editSeries` (title/link/due-offset) and `pauseSeries`/`endSeries` actions, all plain UPDATEs on `homework_assignments` only.
- `src/routes/teacher/classes/[id]/homework/+page.svelte`, `src/routes/student/+page.svelte` -- add a small inline SVG repeat indicator (Lucide, matching `design-tokens.md`'s documented "general SVG icon library... never emoji" guidance) next to any recurring assignment's title -- first icon-library usage in this codebase; no existing badge/pill/chip CSS to reuse, so this also establishes that pattern minimally (a small inline flex row with the icon + "Weekly" label, not a new component system).
- `src/lib/server/rls.spec.ts` -- new "Story 3-2" describe block; call `generate_recurring_homework_instances()` directly via the existing `adminClient` (service-role) the same way other tests invoke trusted-path behavior, and assert on the resulting `homework_instances` rows. Cover every I/O matrix row plus the column-privilege UPDATE rejection.
- `messages/{en,de,bo}.json` -- new keys for the recurrence toggle, series-edit form, and pause/end actions.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0005_recurring_homework.sql` -- generator function + pg_cron schedule + `homework_assignments` UPDATE policy + column-privilege fix, per Code Map
- [x] `src/routes/teacher/classes/[id]/homework/**` -- recurrence toggle on create, series edit/pause/end actions
- [x] Repeat indicator on recurring assignments, teacher and student views
- [x] Paraglide messages, all three locales
- [x] `rls.spec.ts` -- cover every I/O matrix row plus the column-privilege fix

**Acceptance Criteria:**
- Given a weekly recurring assignment already generated for the current period, when the generator runs again before the next period, then no duplicate instance is created.
- Given a recurring series with two already-generated instances, when the teacher edits the series title, then both instances display the new title on next read without either row being written to.
- Given an instance already marked Done by a student, when the generator runs for a later period of the same series, then the earlier instance's Done status is completely unaffected by the new instance's creation.

## Implementation Notes

## Spec Change Log

None yet.

## Review Triage Log

Reviewed by blind-hunter, edge-case-hunter, and verification-gap against the diff since `c731f368e49bce93e86ef376a14929357bcfcd25`.

| # | Verdict | Route | Finding | Evidence |
|---|---------|-------|---------|----------|
| 1 | high | patch | `homework_assignments_update_admin_or_assigned_teacher` has no column-level restriction, unlike the matching `homework_instances` GRANT/REVOKE added in the same migration. | Confirmed at `supabase/migrations/0005_recurring_homework.sql:105-108`: a teacher-of-class UPDATE can rewrite `class_id`/`created_by`/`skill_area`/`recurrence_rule`/`recurrence_start_date`/`due_offset_days` together (satisfying the shape CHECK), converting a one-off assignment into recurring after creation — contradicting the migration's own comment that these fields are "never written by any action after creation." |
| 2 | high | patch | `homework_assignments_recurrence_shape` CHECK enforces `due_offset_days >= 0` but no upper bound. | Confirmed at lines 74-80. A direct-API value far above 365 makes `period + due_offset_days` raise a date-out-of-range error inside `generate_recurring_homework_instances()`, an uncaught exception that rolls back the whole scheduled run for every recurring assignment, not just the offending one. |
| 3 | medium | patch | Generator's `if not exists(...) then insert` is a check-then-act race. | Confirmed at lines 174-217: two overlapping invocations (overlapping cron runs, or a manual RPC call overlapping the schedule) can both pass the `not exists` check for the same `(assignment_id, period_start)`; the second's unique-violation is uncaught and rolls back the entire function call, including every other assignment processed in that invocation. |
| 4 | high | patch | The catch-up `while` loop has no iteration cap; combined with `startDate` having only format validation (`isValidDate`, no lower bound) in `+page.server.ts:290-295`, and the roster-wide `assigned` insert per period having no batching. | Confirmed: a start date far in the past (mistaken entry, or reachable via finding #1's unrestricted UPDATE) makes a single generator invocation synchronously backfill an unbounded number of periods/roster inserts in one transaction — a different outcome than the UI's framing ("the first instance appears once the schedule generates it"), with no safety valve. |
| 5 | medium | patch | `pauseSeries`/`endSeries` never check whether the UPDATE matched a row, unlike `editSeries` and `markDone`/`markReviewed` in the same file, which read-first specifically to catch scope mismatches. | Confirmed at `+page.server.ts:658-730`: both only check `updateError`, always returning `{success:true}`; the diff's own RLS test proves Supabase returns `error:null, data:[]` when the row is filtered out by `.eq('class_id',...)`/`.not('recurrence_rule','is',null)` — a stale `assignmentId` shows a false "paused"/"ended" success banner. |
| 6 | medium | patch | `endSeries` unconditionally sets `ends_on = today` with no check against the current value. | Confirmed at lines 694-730. A second `?/endSeries` submission after a series is already ended moves `ends_on` forward, re-opening the window for periods between the old and new `ends_on` to generate on the next run — reviving a series believed permanently ended. |
| 7 | low | patch | `homework_error_invalid_due_offset` doesn't mention the real upper bound (365, `MAX_DUE_OFFSET_DAYS`), and neither due-offset `<input type="number">` sets `max="365"`. | Confirmed: error string at `messages/en.json`/`de.json`/`bo.json` omits the bound; both inputs in `+page.svelte` (create form line ~178-187, edit form line ~286-295) have `min="0"` but no `max`. |
| 8 | low | patch | `seriesStatusLabel()` and the pause/end-buttons visibility guard in `+page.svelte` independently re-implement the same "is this series inactive" check. | Confirmed at lines 26-33 and 302 — same condition written twice; a future third state or a changed ended-date comparison would need both updated with nothing enforcing that. |
| 9 | low | patch | `homework_col_title`/`homework_col_skill` i18n keys are no longer referenced after the table-to-card-list redesign. | Confirmed via the removed `<th>` usages in the diff and no re-addition elsewhere in `+page.svelte`. |
| 10 | low | patch | The "column-privilege fix" RLS test (`rls.spec.ts:790-839`) only exercises `teacherA.client`; the I/O matrix's own row says this must be rejected for "admin or assigned teacher." | Confirmed no equivalent `admin.client` assertion exists in that test, though the underlying column GRANT/REVOKE applies to the `authenticated` role broadly (so admin should already be blocked) — a real coverage gap for a documented row, trivial to close. |
| 11 | — | defer | `messages/bo.json`'s new keys are verbatim English copies, not Tibetan translations, unlike `de.json`'s real German. | Confirmed by diff comparison. Real, but the correct fix is an actual Tibetan translation, which this automated pass should not fabricate for a live product — flagged for the human/dev. |
| 12 | — | defer | `rls.spec.ts` exercises the DB layer directly, never the SvelteKit form actions (`createAssignment` weekly branch, `editSeries`, `pauseSeries`, `endSeries`) themselves. | Real gap, but matches this codebase's established, already-precedented convention (per this review's own finding on load-function coverage) of relying on RLS-layer tests + human walkthrough for this route rather than new action-level test scaffolding that doesn't exist anywhere else in the repo. |
| 13 | false | reject | No test for editing a series that is already paused/ended. | `editSeries` only ever writes `title`/`reference_link`/`due_offset_days`, none of which affect or depend on paused/ended state; a `due_offset_days` edit is a no-op for a series that will never generate again, so no incorrect effect occurs. |
| 14 | low | reject | Generator creates an instance with zero `assigned` rows when the class currently has no approved students, unlike the one-off path's explicit `homework_error_no_students` rejection. | Harm is cosmetic (an empty-but-valid instance), and a correct fix requires a product decision (skip forever vs. retry) disproportionate to the harm. |
| — | — | out of scope | `sprint-status.yaml` says `3-2-recurring-homework-assignments: in-progress` while this spec's frontmatter says `in-review`. | `sprint-status.yaml` is refreshed by `bmad-sprint-planning`, not by this build workflow; not part of this story's Code Map. |

Patches (#1-10) applied directly to the working tree in this pass (no live step-03 subagent to re-engage). #11 and #12 recorded in `deferred-work.md`.

## Verification

**Commands:**
- `npm run check` -- expected: 0 errors, 0 warnings
- `npx eslint src` -- expected: clean
- `npm run test` -- expected: all tests pass, including new live-Supabase RLS cases (requires `npm run supabase:start` first)
