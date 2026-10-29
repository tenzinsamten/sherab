---
title: 'spec-second-parent CAP-6: teachers see both parents and who set each leave answer'
type: 'feature'
created: '2026-10-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '35db8576e1fd67031bddce6f915c4e74005d638f'
context:
  - '{project-root}/_bmad-output/specs/spec-second-parent/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A child can have two parents, but a teacher sees neither of them as a contact. No teacher or admin view says which parent set a leave or sick answer (SPEC CAP-6). Teachers cannot read parent `profiles` rows, so this needs the trusted function that spine AD-12 planned.

**Approach:**
- Add `student_parent_contacts()`, following AD-12.
- Show both active parents (name and email) to the child's teachers on the teacher class page.
- Label leave and sick answers in the teacher and admin lists with their setter, through `actor_display_name` (AD-13).

## Boundaries & Constraints

**Always:**
- **Migration `0059_student_parent_contacts.sql`:**
  - **Function `student_parent_contacts(p_student_ids uuid[])`:**
    - Returns `(student_id, parent_id, display_name, email)` for the active links only, ordered by student and slot.
    - It is `security definer`, `stable`, `search_path = ''`, with EXECUTE for `authenticated` only.
    - It returns rows only for students the caller may see: a teacher of the student (the same checks as `actor_display_name`, 0055), the admin, or the student's linked parent (`is_parent_of`). Other ids are silently left out.
    - Email comes from `profiles.email`.
    - Decision (agent): it takes an array, so a class roster needs one call, not one per student. AD-12 names it per student.
  - **`sick_leave_queue`** also returns `answered_by_name`, the result of `actor_display_name(student, answered_by)`.
    - A change of return type needs `drop function` and then `create`. Keep its grants and its behaviour otherwise.
- **Teacher class page (`/teacher/classes/[id]`):** the per-student panel lists the child's parents (name and email, the email as a `mailto:` link). With no active parent row, it shows a muted "No parent contact".
- **"Set by {name}" (the existing `leave_set_by` key):** shown on each leave or sick answer in:
  - the teacher class page's upcoming-leave card;
  - `/requests`'s sick queue;
  - `/requests`'s upcoming On-leave list.

  Decision (human, 2026-10-29): only these lists. The roster's attendance badge is unchanged. Answers whose name resolves to null show no label (as in story 2). Names resolve once per distinct (student, actor), with the story-2 `actorLabels` helper moved into a shared module.
- **The admin:**
  - Contacts are already on `/admin/parents` (CAP-4), so there is no new admin contact view.
  - Setter names come through `/requests`, which the admin sees.
- **Text and types:** all new text in en, de and bo. Function and RPC changes go into `database.types.ts` by hand.

**Never:**
- No new `profiles` or `student_parents` SELECT policy (AD-12).
- No parent contact for removed links.
- No contact shown to other students' teachers or to parents of other children.
- No change to the attendance badge, the parent pages or `/join`.
- Never run `supabase:types`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two parents | A and B linked; the class teacher opens the class page | The child's panel lists A's and B's names and emails | — |
| One parent | Only A linked | Lists A only | — |
| Removed parent | B's link was removed | Lists A only | — |
| Other teacher | A teacher of another class calls the function with the child's id | No rows for that child | — |
| Parent caller | A calls it for their own child and for another child | Rows for their own child only | — |
| Admin caller | The admin calls it | Rows for any student | — |
| Leave setter | B marks a session on leave | The upcoming-leave card and `/requests` show "Set by {B}" | — |
| Sick setter | B reports sick | The sick queue row shows "Set by {B}" for the teacher and the admin | — |
| Unknown name | The setter has no display name | No label | — |

</frozen-after-approval>

## Code Map

- `ARCHITECTURE-SPINE.md:136-137` (AD-12) and `:147` (AD-13).
- `supabase/migrations/0055_second_parent_reads.sql:41-74`: `actor_display_name`.
  - Copy its caller checks (`is_teacher_of_student`, the teacher of `profiles.class_id`, the admin), adding `is_parent_of`.
  - Teacher tests are at `rls.spec.ts:17968-17990`.
- `supabase/migrations/0054_student_parents.sql:868+`: the latest `sick_leave_queue`. It uses `distinct on`. Copy its body verbatim and add the column.
- `src/routes/teacher/classes/[id]/+page.server.ts:131-174`:
  - The leave select is at :141; add `answered_by` to it.
  - Call the contacts function once with the roster ids.
- `src/routes/teacher/classes/[id]/+page.svelte`:
  - The per-student panel is at :459-515 (`skills-panel-{id}` :493). Put the contacts there.
  - The upcoming-leave card is at :424-450.
- `src/lib/server/leave.ts`:
  - `loadSickLeave` (:111) maps the new column.
  - `loadUpcomingLeave` (:149, select :178-180) adds `answered_by`.
  - Both are used by `src/routes/requests/+page.server.ts:155,178`.
- `actorLabels`: in `src/routes/parent/children/[id]/+page.server.ts:367-395`. Move it to `src/lib/server/actor-labels.ts` and reuse it on the parent page too.
- Messages:
  - Reuse `leave_set_by`. The roster page uses the `roster_*` prefix, so add the new key there (`roster_parents_*`).
- Tests:
  - `teacher/classes/[id]/page.server.spec.ts`: the leave block is at :394-500.
  - `page.render.spec.ts`.
  - `requests/page.server.spec.ts`: the sick block is at :504+, with the mocks at :24.
  - `rls.spec.ts`: the story-2 block :17789 has `twoParentFamily` and a teacher in setup :17870-17889. Add a CAP-6 block at the end; the file ends with the story-5 block at :18867-19115.
  - e2e: `e2e/teacher.e2e.ts`. The parent inserts leave at :182-203.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0059_student_parent_contacts.sql` -- the function and the `sick_leave_queue` column -- AD-12, AD-13.
- [x] `src/lib/supabase/database.types.ts` -- the function and the new column.
- [x] `src/lib/server/actor-labels.ts` -- move `actorLabels`, and update the parent child page import.
- [x] `src/routes/teacher/classes/[id]/+page.server.ts`, `+page.svelte` and specs -- contacts and the setter on upcoming leave.
- [x] `src/lib/server/leave.ts`, `src/routes/requests/+page.server.ts`, `+page.svelte` and specs -- the setter on the sick queue and the On-leave list.
- [x] `messages/{en,de,bo}.json` -- the new keys.
- [x] `src/lib/server/rls.spec.ts` -- one test per matrix row.
- [x] `e2e/teacher-parent-contacts.e2e.ts` -- the teacher sees A's and B's emails in the child's panel, and B's leave shows "Set by {B}".

**Acceptance Criteria:**
- Given an unchanged parent child page, when the existing story-2 tests run after the `actorLabels` move, then they pass unchanged.
- Given a reset database, when `/requests` loads for the admin, then the sick queue still loads in one call (`sick_leave_queue`).

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | verification-gap, blind, edge | A failed `student_parent_contacts` read shows "No parent contact" in every panel, and it flags the whole page as failed | medium | True: `parentContacts` is `{}` on error and `contactsError` is folded into `loadError`. It tells the teacher a child has no parent. Direct correction: a separate `contactsError`, with a load-error line in the panel instead of the empty state | patch |
| 2 | verification-gap, blind | Nothing tests the "No parent contact" state or a contact with no display name | medium | Pre-verified: the panel renders only after a click, and the e2e has only two named parents | patch |
| 3 | verification-gap | A failed `actor_display_name` on the class page and in `loadUpcomingLeave` is untested | medium | Pre-verified: every fake returns `error: null` | patch |
| 4 | blind | Missing RLS callers: the student for themself, and a teacher with own-class and other-class ids mixed | low | The spec's caller list excludes the student; neither case is tested. One test each | patch |
| 5 | blind, edge | The e2e cleanup deletes the class day by date, which can hit a day another test uses | low | True: `class_days.delete().eq('day', …)`. Direct correction: delete by the created row's id, and only when this test created it | patch |
| 6 | blind | `SickQueueRow.answered_by_name` is optional but the RPC type has it as required | low | True; direct correction | patch |
| 7 | blind | A stale `ActorLabel` doc comment stays on the parent page after the move | low | True; direct deletion | patch |
| 8 | blind, edge | `loadUpcomingLeave` sends one `actor_display_name` call per distinct (student, actor) | low | Bounded by children with upcoming leave at one school (tens); the frozen rule is "once per distinct (student, actor)". A batched RPC is new surface | reject |
| 9 | blind | A teacher or admin who is also the parent sees "Set by {own name}", not "Set by you" | low | Rare (staff who are parents of a pupil). The frozen rule names `leave_set_by` only; adds a parameter and a branch | reject |
| 10 | edge | Answers set by a teacher, admin or student get no label | false | Only `is_parent_of` may insert `session_leave_history` (AD-13, 0027:159) | reject |
| 11 | blind, edge | Emails go into `mailto:` unencoded | low | Parent emails pass sign-up validation; a `?` or `&` in one is not realistic. Encoding `@` changes the link | reject |
| 12 | blind | The e2e does not cover `/requests` | low | The `/requests` labels have server and render tests; the frozen e2e task names the class page | reject |
| 13 | blind | Contacts include parents who are no longer approved | false | Links are only created for approved parents (sign-up, accept), and `guard_parent_with_links` stops rejecting a linked parent | reject |
| 14 | blind, edge | The Sick RLS tests share today's session, which could be cancelled | low | Each test has its own child; nothing cancels today's day in the suite | reject |
| 15 | blind | No cleanup in the CAP-6 RLS block | low | Same as the other blocks; the local database is reset | reject |
| 16 | edge | The roster's per-session leave answers carry no setter | false | Matches the human decision: lists only, and the roster badge stays unchanged | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0, 0059 applies.
- `npm run test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/teacher-parent-contacts.e2e.ts e2e/teacher.e2e.ts` -- expected: pass.
