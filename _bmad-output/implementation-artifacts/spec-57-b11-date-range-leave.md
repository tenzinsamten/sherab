---
title: 'B11 — Date-range leave for parents (#57)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '67e06f3b093ea65960663812e036aa04ab3cbe21'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parents can only answer Coming / On leave one session at a time, so a known absence period (a trip, a family event) means answering every session separately (#57).

**Approach:** On the child page's Sessions tab, a parent picks a from/to period (and optionally one class) and sets all of the child's sessions in it to On leave — or back to Coming — in one go, after a preview. Each session is still classified Planned / Short-notice by the database exactly as single-session leave is today.

**Decisions (user, 2026-09-29):**
- The range covers the sessions that exist when the parent saves; the UI says how many it covered.
- The period starts today or later and spans at most 26 weeks (182 days).
- Undo is the same form with "Coming".
- All of the child's classes, or one picked class.
- A preview ("6 sessions: 4 Planned, 2 Short-notice, 1 skipped (already started)") is shown before saving.
- Sessions whose current answer is already the chosen one are left untouched (re-saving On leave would re-freeze a Planned session as Short-notice).

## Boundaries & Constraints

**Always:** Only the child's parent can preview or save (same rule as single-session leave: `is_parent_of`). Every write goes through `session_leave_history` and its existing BEFORE/AFTER INSERT triggers (actor/time stamp, enrolment/cancel/start/decided checks, frozen classification, streak recompute) — no trigger is changed or bypassed. Started, cancelled, decided and sick sessions are skipped and reported, never fail the whole save. Dates are Europe/Berlin. The migration stays local until the user says push.

**Never:** No change to existing tables, columns, triggers or policies. No stored "leave period" row; sessions created later are not affected. No new write path for non-parents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two-week leave | parent, today+10 → today+24, all classes, On leave | preview lists each session with Planned/Short-notice; save writes one On leave row per session; Sessions list shows On leave | N/A |
| One class | same, one class picked | only that class's sessions | N/A |
| Already on leave | a session already Planned On leave in range | skipped ("already on leave"), classification unchanged | N/A |
| Started / cancelled / decided | sessions in range that started, are cancelled or decided | skipped and counted in the preview | N/A |
| Undo | same range with Coming | sessions currently On leave get Coming; others untouched | N/A |
| Invalid range | from in the past, to before from, or > 182 days | nothing written; inline error on the date fields | 22023 hint `leave_range_invalid` |
| Not the parent | another parent, a teacher (not parent), a student | refused, nothing written | 42501 |
| Empty range | no sessions in the period | preview says 0 sessions; Save disabled | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0027_session_leave.sql` -- `session_leave_history` (133, append-only, parent-only insert policy via `is_parent_of` 159), BEFORE INSERT trigger (187), `classify_leave`, AFTER INSERT streak recompute (262), `preview_leave` RPC.
- `supabase/migrations/0028_sick_leave_decisions.sql` -- replaced BEFORE INSERT trigger (214): per-(session, student) advisory lock, `leave_decided` refusal. Reuse its error hints.
- `supabase/migrations/0026_schedule_interval.sql` -- sessions exist only for existing class days (61-99); `regenerate_class_sessions` removes future unmarked sessions (114).
- New `supabase/migrations/0030_leave_range.sql`:
  - `preview_leave_range(p_student uuid, p_from date, p_to date, p_class uuid default null)` — security definer, `set search_path = ''`, first statement checks `is_parent_of(p_student)` (else 42501); limits (from ≥ today Berlin, to ≥ from, to − from ≤ 182 → 22023 hint `leave_range_invalid`); returns `(session_id, day, class_id, class_name, outcome)` with outcome `planned | short_notice | already_on_leave | already_coming | started | cancelled | decided | sick`, for the student's enrolled classes (or `p_class`).
  - `set_leave_range(p_student, p_from, p_to, p_class, p_answer text)` — security invoker (RLS + existing trigger do all checks), `p_answer` in (`on_leave`, `coming`), same limits, inserts one history row per session whose outcome is planned/short_notice (skips the rest and those already at `p_answer`), returns the same shape with the frozen classification.
  - Revoke from public/anon, grant execute to authenticated.
- `src/routes/parent/children/[id]/+page.server.ts` -- leave list window `LEAVE_WINDOW_DAYS` (49), actions `preview` / `setLeave`, `leaveErrorMessage`. Add `previewLeaveRange` / `setLeaveRange` (validate ISO dates, optional class UUID among the child's classes, answer enum).
- `src/routes/parent/children/[id]/+page.svelte` -- Sessions tab: add a "Plan a leave period" card: `ix-date-input` from/to (`format="yyyy-MM-dd"`), `ix-select` class ("All classes" + child's classes), `ix-radio-group` On leave / Coming, Preview button → `ix-modal` with the summary and per-session list → Save. Form `novalidate`, errors via `ixFieldError`.
- `src/lib/ix-fields.ts` -- `ixValue`, `ixFieldError(errorId, describedBy)`.
- `src/lib/server/rls.spec.ts` -- existing leave RLS tests and parent fixtures to extend.
- Messages en/de/bo: `leave_range_*` keys.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0030_leave_range.sql` -- the two functions above
- [x] `src/lib/database.types.ts` (or the generated types file) -- regenerate with `npm run supabase:types`
- [x] `src/routes/parent/children/[id]/+page.server.ts` -- `previewLeaveRange`, `setLeaveRange` actions
- [x] `src/routes/parent/children/[id]/+page.svelte` -- "Plan a leave period" card with preview modal
- [x] `messages/*.json` -- `leave_range_*` keys (en/de; bo English placeholders)
- [x] `src/lib/server/rls.spec.ts` -- matrix rows at the database level (parent ok incl. a teacher who is also a parent, non-parent 42501, classifications, already-on-leave untouched, started/cancelled/decided skipped, limits, undo, streak recomputed)
- [x] `src/routes/parent/children/[id]/page.server.spec.ts` -- both actions' validation and error mapping
- [x] `e2e/` -- parent sets a two-week range, preview counts, save, Sessions list shows On leave; undo with Coming
- [x] `_bmad-output/manual-verification-issues.md` -- #57 "fixed, to verify"

**Acceptance Criteria:**
- Given a parent with two children, when they set a range on one child, then the other child's sessions are unchanged.
- Given the migration, when the DB is reset, then it applies cleanly after 0029 and no existing test changes.

## Implementation Notes

- `preview_leave_range` takes a fifth, optional `p_answer text default 'on_leave'`: the Coming (undo) preview needs to know which sessions would change. The four-argument call in the Code Map still works.
- Outcomes are relative to the chosen answer. On leave: `planned` / `short_notice` (would change), `already_on_leave` (untouched). Coming: `coming` (currently On leave, would change), `already_coming` (Coming or never answered, untouched). `coming` is one outcome beyond the Code Map list, needed for the undo preview. Skips for both, in the trigger's order: `decided` > `cancelled` > `started` > `sick`. `skipped` = refused at save time for any other reason (unlisted 22023 hint, or P0002 for a session deleted mid-save).
- `set_leave_range` checks `is_parent_of` first (42501 before any input error), then loops over the preview. Per changing row it takes the trigger's per-(session, student) advisory lock, re-reads the latest answer (an answer saved since the preview is reported as `sick` / `already_on_leave` / `already_coming` and left alone), and inserts inside its own exception block: 22023 hints leave_started / leave_cancelled / leave_decided map to their outcome, any other 22023 and P0002 to `skipped`. Only 42501 aborts the save.
- Limit: "26 weeks" = 182 days including both dates, so `to - from <= 181` (SQL, `LEAVE_RANGE_MAX_DAYS`, copy).
- `src/lib/supabase/database.types.ts` is hand-curated (narrowed unions, helper exports), so `npm run supabase:types` would have rewritten ~2700 lines and dropped exported types; the two functions and a `LeaveRangeOutcome` type were added by hand instead.

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | B4 + E1: `set_leave_range` decides from the preview snapshot, so an answer saved in between (another tab, the other parent) is overwritten: a fresh Sick becomes On leave, or a Planned is re-frozen as Short-notice | medium | the loop inserts from the snapshot outcome; the trigger's per-(session, student) lock is taken only at insert and doesn't re-check the latest answer | patch |
| 2 | V1: the class chosen in the dialog isn't proven to reach the save | medium | e2e child has one class; unit tests post the action directly | patch |
| 3 | B12 + E5: `rangeClasses` built from the teacher-listing data, so a failed teacher lookup hides the card with no error | medium | `rangeClasses` derived from `details.teachers` | patch |
| 4 | B1 + E3 + V-other: an unlisted 22023 hint (e.g. `leave_not_enrolled`) is reported as "already started" | low | `case v_hint … else 'started'` | patch |
| 5 | B2 + E2: header says a refused row never fails the save, but only 22023 is caught | low | P0002 (session deleted mid-save) aborts all; 42501 aborting is correct. Fix: skip P0002 too, correct the comment | patch |
| 6 | E6: range saves can reach 26 weeks but the Sessions list shows 12 | low | `LEAVE_WINDOW_DAYS` 84 vs 182; the preview lists them and a Coming range undoes them; direct fix: say so in the preview/toast | patch |
| 7 | B7 + E14: the save result is thrown away; skipped-at-save sessions and the covered count are not reported | low | toast reads only `changed` | patch |
| 8 | B6: "26 weeks" allows 183 inclusive days | low | `to - from > 182`; direct fix to 26 weeks inclusive | patch |
| 9 | B8: "1 sessions" | low | hard-coded plural; rephrase | patch |
| 10 | B10: answer validated before the parent check | low | a non-parent learns "invalid" instead of 42501; direct reorder | patch |
| 11 | B11 + E7 + E8: date error shown twice (page + modal) and stale after closing | low | inline error not gated on `!rangeOpen`; not cleared on close | patch |
| 12 | E4: skip reasons ordered differently from the trigger | low | direct reorder to match `trg_session_leave_before_insert` | patch |
| 13 | E11 + E12: test helpers ignore returned errors | low | direct fix | patch |
| 14 | B3: `classify_leave` can return NULL → outcome NULL | false | `session_starts_at` coalesces to 00:00 (0027:50), so it is NULL only for a session that doesn't exist | rejected |
| 15 | V2: the mid-save refusal path is untested | low | needs two concurrent transactions; partly covered once #1 re-checks inside the loop | defer |
| 16 | B9: bo strings are English | low | existing bo practice | rejected |
| 17 | E9 + E10: tests can flake across Berlin midnight | low | only for runs within a minute of midnight | rejected |
| 18 | E13: e2e cleanup of class days | low | same accepted pattern as other e2e fixtures (B8b triage #12) | rejected |
| 19 | B13: e2e lacks the empty / Save-disabled states | low | covered at DB level ("Empty range" rls test); UI state is a simple disabled binding | rejected |
| 20 | V-other: e2e not in the gate | low | already deferred (B8b) | rejected (carried) |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0 (0030 applies)
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
