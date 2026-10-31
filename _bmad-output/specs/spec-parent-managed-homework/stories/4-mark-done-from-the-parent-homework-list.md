---
title: 'Mark done from the parent homework list'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '2709ed54e20664605a122bae975d90aebace4bd5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-parent-managed-homework/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/parent/homework` lists every child's open homework, but a parent can't mark any of it done there. For a parent-managed child, the parent has to open each child's page first.

**Approach:**
- Rows of parent-managed children get the existing Mark done button.
- Each row's title links to its story 3 detail page instead of the child's Homework tab.

This is SPEC CAP-2 on `/parent/homework`.

## Boundaries & Constraints

**Always:**
- **Which rows:** Mark done shows only on rows whose child is parent-managed. The load reads `profiles.parent_managed` for the children in view in one query, and each row carries `childManaged`.
- **The action:** a `markDone` action takes `instanceId` and `childId`, refuses a `childId` that isn't a UUID with `fail(400)`, and calls `markHomeworkDone({..., studentId: childId})`. RLS is the barrier, and a refusal gives story 2's 403 message.
- **After a mark:** the item drops out of the list on the next load, a success toast shows, and a refusal reloads the data (`onfailure={invalidateAll}`).
- **Reuse:** `MarkDoneForm` gets an optional hidden `childId` field. Without it, the form stays exactly as today.
- **Title link:** the row title goes to `/parent/children/[childId]/homework/[instanceId]`. The per-child "history" links to `?tab=homework` stay.
- **If the flag read fails:** treat every child as not managed (no button) and log it. The list still renders.

**Never:**
- No database or migration change.
- No change to student pages or to the child page (story 2) or the detail page (story 3).
- No "marked by" labels (story 5).
- No done or reviewed rows on this page.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Managed child's row | flag on | row shows Mark done | N/A |
| Unmanaged child's row | flag off | no Mark done | N/A |
| Two children, one managed | mixed | only that child's rows get the button | N/A |
| `?child=` filter | one child in view | flag read only for that child | N/A |
| Flags read fails | profiles error | no buttons; list renders; error logged | console.error |
| Mark done | managed child, open item | inserts the child's `done` row, recorded by the parent; toast; item gone after reload | N/A |
| Mark refused | 42501 (flag turned off meanwhile) | `fail(403)`, story 2 message; data reloaded | localized |
| Bad `childId` | missing or not a UUID | `fail(400)`, no insert | localized |
| Not signed in | action | redirect `/login` | N/A |
| Row title | any row | links to the detail page | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/parent/homework/+page.server.ts` (142 lines):
  - `loadChildOpen` builds `ParentHomeworkItem` (type at :13-29). Add `childManaged`.
  - `load` (:98-141): `inView` children, then add one `profiles.select('id, parent_managed').in('id', inView ids)`.
  - There is no `actions` export today. Add one.
- `src/routes/parent/homework/+page.svelte` (156 lines):
  - The row `<li>` is at :101-146.
  - The title `<a href={childHomeworkHref(...)}>` at :104-114 changes to the detail href, with `resolve('/parent/children/[id]/homework/[instanceId]', …)`.
  - Add `MarkDoneForm` with `pending` from `createPending()` (see `src/routes/parent/children/[id]/+page.svelte:90`), plus a toast like the child page `$effect`.
- `src/lib/components/MarkDoneForm.svelte:25-42` -- props `action`, `onfailure`. Add an optional `childId` that renders `<input type="hidden" name="childId">`.
- `src/lib/server/student-homework.ts:367` -- `markHomeworkDone({request, supabase, user, studentId?})` reads `instanceId` from the form. To read `childId` first, use `request.clone().formData()`.
- `src/routes/parent/children/[id]/+page.server.ts:845-852` -- `markDone` action pattern (session redirect, UUID check).
- `src/routes/parent/homework/page.server.spec.ts` -- mocks `loadStudentHomework` and `todayInBerlin`; `tableChain` fake (:46+). Extend it.
- `e2e/parent-managed-homework.e2e.ts` -- fixture with parents A/B and the child; `setManaged(on)` helper.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/MarkDoneForm.svelte` -- optional `childId` hidden field.
- [x] `src/routes/parent/homework/+page.server.ts` -- `childManaged` per row, the flags query, the `markDone` action.
- [x] `src/routes/parent/homework/+page.svelte` -- title link to the detail page; Mark done on managed rows (`action="?/markDone"`, `childId`, `onfailure={invalidateAll}`); success toast; hydration marker kept.
- [x] `src/routes/parent/homework/page.server.spec.ts` -- every load and action row of the matrix.
- [x] `e2e/parent-managed-homework.e2e.ts` -- with the flag on via `setManaged`, A opens `/parent/homework`, marks an open item done, it leaves the list; the flag reset at start and end.

**Acceptance Criteria:**
- Given the existing `/parent/homework` tests and `e2e/parent-mobile.e2e.ts`, when they run, then they pass (the title link change may need their expected href updated).
- Given a student page using `MarkDoneForm` without `childId`, when it renders, then there is no `childId` field.

## Implementation Notes

- The row link's accessible name (`parent_homework_row_label`, en/de/bo) said "open on {name}'s Homework tab"; it now says it opens the homework details, since the link goes to the detail page.
- `src/lib/components/MarkDoneForm.render.spec.ts` (new) covers the "no `childId` field without the prop" criterion.
- E2E: the fixture gains a third open item (`MH list`). That gave story 3's test a second Mark done button on the Homework tab, exposing a missing navigation wait after its second title click; it now waits for the detail URL.
- `action="?/markDone"` drops `?child=` only without JavaScript (with it, the reload keeps the current URL).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | verification-gap, blind | No test that a refused mark reloads `/parent/homework` (`onfailure={invalidateAll}`) | medium (gap) | Matrix row "Mark refused … data reloaded"; no spec or e2e touches `onfailure`; the fixture's `setManaged` makes it cheap | patch: e2e step |
| 2 | blind | The success toast doesn't check `form.action === 'markDone'` | low | The child page checks it (`+page.svelte:181`); direct correction | patch |
| 3 | blind | The eslint-disable reason above the list no longer fits the title link | low | The title now uses `detailHref`; direct correction | patch |
| 4 | blind | `openList` waits for `networkidle` | low | Redundant next to `data-hydrated`; a flake source; deletion | patch |
| 5 | edge-case | Siblings sharing one instance share the `done:${instanceId}` pending key, so both rows spin | low | `MarkDoneForm.svelte:51`; fix is a key change | patch: include `childId` in the key |
| 6 | blind, edge-case | Without JS the post drops `?child=` | low | `MarkDoneForm` confirms through an AlertDialog, so the flow needs JS | rejected |
| 7 | edge-case | The action skips the load's approval gate | false | The RLS branch uses `is_parent_managing` → `is_parent_of` → `is_parent()`, which requires an approved parent | rejected |
| 8 | edge-case | A stale row adds a second `done` row | low | Already in `deferred-work.md`; status display is unaffected (story 2 #7) | rejected |
| 9 | blind | The action trusts the form's `childId`; RLS only | low | The spec makes RLS the barrier; a foreign `childId` is refused by `is_parent_managing` | rejected |
| 10 | blind | Focus returns to the heading after a mark | low | Same as the child page; a UX tweak with added logic | rejected |
| 11 | blind | e2e doesn't check parent B, or two children in the UI | low | Unit tests cover `childManaged` per row; B covered in story 2/3 e2e | rejected |
| 12 | blind | Sibling row marking is untested | low | Rows are keyed by `childId:instanceId`; the insert uses the posted child | rejected |
| 13 | blind | A missing profile row is undocumented | low | Falls to not-managed, the safe default | rejected |
| 14 | blind | The page reading `action` isn't tested | low | Covered once #2 is fixed and the e2e toast passes | rejected |
| 15 | edge-case | The toast doesn't name the child | low | Wording choice; the row disappears from the named child's group | rejected |

## Verification

**Commands:**
- `npx supabase db reset` -- expected: exit 0.
- `npm test` -- expected: exit 0.
- `npm run check` -- expected: exit 0.
- `npm run build` -- expected: exit 0.
- `npx playwright test e2e/parent-managed-homework.e2e.ts` -- expected: pass (the environment has blocked browser launch before; report rather than retry endlessly).
