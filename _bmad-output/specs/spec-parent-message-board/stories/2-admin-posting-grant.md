---
title: 'Admin posting grant'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '676f68e5b18c4a2d67c87fac0180841cfe18eebf'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-message-board/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1 added `parents.can_post_board`, but admins have no way to set it, so no parent can post on the board yet.

**Approach:** On `/admin/parents`, each approved parent's row shows whether they can post on the board, with a button that turns posting on or off. This is SPEC CAP-4. The existing admin-only RLS on `parents` is the barrier.

## Boundaries & Constraints

**Always:**
- **Load:** the load reads `can_post_board` with the existing `PARENT_COLUMNS` select, and each parent item carries `canPostBoard`.
- **Who gets the control:** only rows with `status = 'approved'` show it:
  - a badge that reads "Can post on the board" or "Can't post on the board";
  - one button, "Allow board posts" or "Stop board posts", that posts the opposite value.

  Pending and rejected rows show neither.
- **Action:** `setBoardPosting` reads `parentId` and `on` (`'true'`/`'false'`).
  - Not signed in: `fail(401)` with the existing `requests_error_not_signed_in` message.
  - `parentId` not a UUID, or `on` not one of the two values: `fail(400)`, no update.
  - It updates `parents.can_post_board` where `id = parentId`, with `.select('id')`.
  - The policy refuses non-admins silently, with 0 rows. So 0 rows returned, or any error, gives `fail(403)` with a localized "couldn't change board posting" message.
- **Success:** a toast that names the parent and says whether posting is on or off. The row updates on reload.
- **Pending UI:** the button follows the page's pending pattern (`createPending`, spinner, `aria-busy`, disabled while busy), keyed per parent.
- **Accessible name:** the button's label names the parent.
- **Text:** new strings go in `parents_board_*` keys in en, de and bo.

**Never:**
- No database or migration change.
- No change to the existing remove-link behaviour.
- No board page or navigation (story 3).
- No confirmation dialog: the change is easy to reverse.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Approved, off | `can_post_board` false | "Can't post" badge; "Allow board posts" | N/A |
| Approved, on | true | "Can post" badge; "Stop board posts" | N/A |
| Pending or rejected | any | no badge, no button | N/A |
| Turn on | admin, `on=true` | flag true; success toast | N/A |
| Turn off | admin, `on=false` | flag false; success toast; posts kept | N/A |
| Bad input | non-UUID `parentId`, or `on=maybe` | `fail(400)`, no update | localized |
| Refused | 0 rows returned, or an error | `fail(403)` | localized |
| Not signed in | no session | `fail(401)` | localized |

</frozen-after-approval>

## Code Map

- `src/routes/admin/parents/+page.server.ts`:
  - `ParentRow` (:12), `PARENT_COLUMNS` (:64), the parents mapping (:146-153), and `actions` (:163).
  - Copy the `removeParentLink` action (:169-193) for its session, UUID and `fail` shape. `UUID_PATTERN` is at :7.
- `src/routes/admin/parents/+page.svelte`:
  - the status cell (:128-140) gets the badge and the form;
  - `pending` / `createPending` (:32), and the success toast `$effect` (:36-43);
  - copy the remove form's markup pattern (:177-210).
- `src/routes/parent/children/[id]/+page.svelte:555-590` -- the existing on/off toggle pattern (hidden `on` value, outline vs default variant).
- `src/routes/admin/parents/page.server.spec.ts`, `page.render.spec.ts` -- extend their fakes with `can_post_board`, plus the action's update chain.
- `messages/{en,de,bo}.json` -- `parents_*` keys live together. Add the new keys next to them.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/admin/parents/+page.server.ts` -- `canPostBoard` in the load; the `setBoardPosting` action.
- [x] `src/routes/admin/parents/+page.svelte` -- the badge and toggle for approved rows; the toast.
- [x] `messages/{en,de,bo}.json` -- the `parents_board_*` keys.
- [x] `src/routes/admin/parents/page.server.spec.ts` -- every action and load row of the matrix.
- [x] `src/routes/admin/parents/page.render.spec.ts` -- the control appears only on approved rows, with the right label for each state.

**Acceptance Criteria:**
- Given the existing admin parents tests, when they run, then they pass, with fixtures extended only by `can_post_board`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge-case | The action grants posting to pending or rejected parents through a hand-built POST | medium | The update filters only by `id`; the approved-only rule is in the template only | patch: `.eq('status','approved')` |
| 2 | verification-gap, blind | The success toast is untested | medium (gap) | A server-side render never runs `$effect`; no e2e test covers the flow | patch: e2e test |
| 3 | blind | Tibetan accessible names put the name after the verb with no separator | low | Direct wording fix; the success strings put the name first | patch |
| 4 | blind | The 401 test doesn't check the message | low | One assert | patch |
| 5 | blind, edge-case | A rejected-then-re-approved parent keeps a hidden grant | low | Rejecting normally deletes the `parents` row (AD-4); a rejected row stays only when user deletion fails; rare | rejected |
| 6 | blind, edge-case | The toast shows an empty name if the parent vanished on reload | low | Needs a concurrent delete; the fix adds a branch | rejected |
| 7 | blind, edge-case | A DB error reports 403, not 500 | low | The frozen spec says any error gives 403 | rejected |
| 8 | edge-case | A stale page sets a value it already has, and the toast claims a change | low | The resulting state is the one the admin asked for | rejected |
| 9 | blind | Pending UI, logging and `data-on` untested; thin bad-input cases | low | Shared pattern tested elsewhere; three bad-input cases present | rejected |
| 10 | blind | The card layout has no sub-label for the board control | low | The badge text names the board | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
