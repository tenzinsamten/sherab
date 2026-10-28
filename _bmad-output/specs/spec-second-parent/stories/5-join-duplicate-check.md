---
title: 'Story 5: Join duplicate check'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd83096a53e98b5dd177683b6c47645cb2cd0f5d4'
context:
  - '{project-root}/_bmad-output/specs/spec-second-parent/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parent B can have a live invite for Tenzin, or a link to Tenzin, and still register "tenzin " again at `/join`. The current duplicate check only looks at children B registered (`registered_by_parent_id`). This creates a second student record for the same child (SPEC CAP-5).

**Approach:** Follow spine AD-11 and AD-16. The sign-up trigger refuses with hint `already_invited`. The `/join` pre-check `student_registration_state()` returns `invited` for the same cases. `/join` shows one message that points the parent to the invite.

## Boundaries & Constraints

**Always:**
- **Migration `0058_join_already_invited.sql`.** It redefines `handle_new_user()` and `student_registration_state()`:
  - Start from their latest definitions (0054). Copy them verbatim and add only the new check.
  - Keep every existing grant, trigger binding and refusal unchanged.
- **The check.** The registering parent is the approved parent that `handle_new_user` already matches by the guardian email. The check applies when that parent has either of these for a student whose `lower(btrim(registration_name))` equals the new name:
  - a live invite (`parent_invite_is_live`, `invited_email` = that parent's `lower(btrim(email))`);
  - an active or removed `student_parents` link.
- **In `handle_new_user`:**
  - The check runs after the existing `parents` row lock and before the profile insert.
  - It raises with hint `already_invited`, using the same errcode family as the trigger's other refusals.
- **In `student_registration_state`:**
  - It returns `'invited'` for the same cases.
  - The existing answers (`approved` / `pending` / `rejected` / not found) take precedence when they apply.
- **`/join`:** maps `'invited'` to a new message `join_error_already_invited`, in the pre-check and in the re-check after a failed `createUser`. The message tells the person to sign in as the parent and accept the invite under "Invites" on the parent page.
- **`StudentRegistrationState`** in `parent-registration.ts` gains `'invited'`.
- **Text:** all new text in en, de and bo.

**Never:**
- No refusal or message reveals more than today's found / not-found for that parent's email. No answer depends on whether the invited email has an account.
- No merging or cleanup of existing duplicates (SPEC:59).
- No change to the invite functions, link removal, or `/parent` pages.
- Never run `supabase:types`, and never use `emailHasLogin`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live invite | B has a live invite for "Tenzin"; registers "tenzin " with B's email | Refused at the pre-check with the already-invited message; no student is created | `invited` |
| Accepted | B accepted the invite (active link to Tenzin); registers "TENZIN" | Refused, same message | `invited` |
| Removed link | B's link to Tenzin was removed; registers "Tenzin" | Refused, same message | `invited` |
| Different name | B has an invite for "Tenzin"; registers "Pema" | Succeeds as today | — |
| Not live | B's invite for Tenzin is expired or cancelled, and B has no link | Succeeds as today | — |
| Other parent | C (no invite or link) registers "Tenzin" with C's email | Succeeds as today | — |
| Trigger backstop | The pre-check passes, then the invite exists at insert time (race) or the trigger is called directly | The trigger refuses; `/join` re-checks and shows the already-invited message | hint `already_invited` |
| Own child | B registered Tenzin before | Today's duplicate message, unchanged | `pending` / `approved` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0054_student_parents.sql`:
  - `handle_new_user()` :351-498. Parent match :413-424, `parents` lock :426-437, the no-parent refusal :448-451 (copy its errcode style), profile insert :460-482, slot-1 link :485-488. It is a deferred constraint trigger (0020:117).
  - `student_registration_state()` :692-719 is service-role only (0042:120-121). Keep its grants.
- `supabase/migrations/0056_parent_invites.sql`:
  - `parent_invite_is_live` :97-114. Its grants allow only service_role; the trigger runs as definer.
  - Name-check pattern in `accept_parent_invite` :414-433.
- `src/routes/(auth)/join/+page.server.ts`: `duplicateMessage()` :29-33, the pre-check :154, the re-check after a failed `createUser` :187-198. The Postgres hint does not reach TS, so `invited` from the state function is the only signal.
- `src/lib/server/parent-registration.ts`: the `StudentRegistrationState` union :72-78 and its wrapper :89-103.
- Messages: `join_*` keys (en.json :521-564). Next to `join_error_duplicate` :547, add `join_error_already_invited`.
- `database.types.ts`: update the `student_registration_state` return type by hand, if it is typed there.
- Tests:
  - `src/routes/(auth)/join/page.server.spec.ts`: mocks :4-35, the #98 cases :291-404, the race re-check :370-400.
  - `src/lib/server/rls.spec.ts`: `signUpStudent` :653, `createApprovedParent` :594, `stateOf` :821. Story-3 invite helpers are in the block at :18087. Add a story-5 block at the end.
  - e2e: `e2e/class-join.e2e.ts:424`, a /join duplicate test that checks the toast. `e2e/parent-invite.e2e.ts` has the user and invite fixtures.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0058_join_already_invited.sql` -- the check in both functions -- AD-11, AD-16.
- [x] `src/lib/server/parent-registration.ts` (and `database.types.ts` if needed) -- the `'invited'` state.
- [x] `src/routes/(auth)/join/+page.server.ts` and `page.server.spec.ts` -- map `invited` in the pre-check and the re-check.
- [x] `messages/{en,de,bo}.json` -- `join_error_already_invited`.
- [x] `src/lib/server/rls.spec.ts` -- one test per matrix row, through `stateOf` and `signUpStudent`.
- [x] `e2e/join-already-invited.e2e.ts` -- A invites B for a child; registering the same name with B's email at /join shows the already-invited message; a different name succeeds.

**Acceptance Criteria:**
- Given any refusal or success above, when the same request is made with an email that has an invite and one that has none, then nothing in the response says whether the invited email has an account.
- Given a reset database, when the existing #98 and 7-1/7-2 /join tests run, then they pass unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | verification-gap | The `studentRegistrationState` wrapper's allow-list is never unit-tested with `'invited'`; only Playwright would catch a regression | medium | Pre-verified: `parent-registration.spec.ts:113` lists four answers; the join spec mocks the wrapper and rls.spec bypasses it. Without the entry, `/join` shows the generic error | patch |
| 2 | blind | The already-invited message tells a linked or removed parent to "accept the invite", which they can't do | medium | True: the frozen rows Accepted and Removed link get the same message. Direct correction: wording that still points at the invite but fits all three cases | patch |
| 3 | blind | The message says "parent page"; the existing invite text says "start page" | low | True (`invite_intro`). Folded into #2's wording | patch |
| 4 | blind, edge | The lock comment says the check is serialized against invites; `create_parent_invite` / `accept_parent_invite` don't take the registering parent's `parents` row | low | True, so the comment overstates it. In the race a duplicate can be created, but accept then refuses it with `duplicate_child_name` (0056), so no third link appears. Direct correction: fix the comment. Adding a lock is new locking for a microsecond window | patch (comment) |
| 5 | blind | The trigger check also applies to service-role (`app_metadata`) students | low | No app path creates students that way (grep: only teachers, `admin/teachers/+page.server.ts:86`); fixtures only. Direct correction: say so in the migration header | patch (comment) |
| 6 | blind | Badly wrapped doc comment in `parent-registration.ts`, which doesn't say `'invited'` covers removed links | low | True; direct correction | patch |
| 7 | blind | A removed link blocks the parent from registering a same-name child for good | low | Required by spine AD-11 ("an active link, or a removed link") and the frozen Removed-link row | reject |
| 8 | blind, edge | Invites are matched on `profiles.email`, not the confirmed `auth.users` email that `list_my_parent_invites` uses | low | `handle_new_user` already matches the parent by `profiles.email` (0054:414-419), and parents have no email-change path, so the two can't differ in-app | reject |
| 9 | blind | No index supports the name lookup | low | One school's students; a reordered query is more than a direct correction | reject |
| 10 | blind | The trigger and the state function copy the rule and differ on own children | low | The state function's first `coalesce` branch answers for own children, so both give the same result. A shared helper is new surface | reject |
| 11 | blind | The RLS refusal tests only assert an error, not the hint | low | GoTrue hides the hint (implementation note); the Different name and Not live rows show the same fixture succeeds without the rule | reject |
| 12 | blind | The "No account leak" test never runs the new code; names B is linked to can be probed by email | false | The test shows an invite to an email with no account changes nothing, which is the criterion. Per (email, name) found / not-found is today's disclosure shape, extended by AD-11 itself | reject |
| 13 | blind | The story-5 RLS block doesn't clean up | low | Same as the other RLS blocks; the local database is reset | reject |
| 14 | blind | The e2e hardcodes the English message and covers only the live-invite case | low | Same as the other e2e files; the unit and RLS tests cover the other rows. The text is updated with #2 | reject |
| 15 | blind | Nothing records whether `database.types.ts` needs a change | false | Checked: the function returns `string` there (implementation report) | reject |
| 16 | edge | The e2e cleanup misses a stray student if the test regresses | low | Only after a failing assertion; the reset cleans up | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0, 0058 applies.
- `npm run test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/join-already-invited.e2e.ts e2e/class-join.e2e.ts` -- expected: pass.
