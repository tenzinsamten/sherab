---
title: 'Manual-verification B6: admin Parents list'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '50ea5c810ab155011bb3ff20ae4ce3fc2992528b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin area shows no parent information (#52). Parents appear only while pending on `/requests`. Decided: a new admin Parents list page.

**Approach:** A read-only `/admin/parents` page, in the admin menu, listing every parent with name, email, status and their linked children.

## Boundaries & Constraints

**Always:**
- **Route and guard:** `/admin/parents`, under the existing admin layout guard.
- **Nav:** admin menu entry "Parents" after Teachers.
- **Data:**
  - `parents` (every row: `pending`/`approved`; rejected rows are deleted at rejection, so they never appear), joined to `profiles!parents_id_fkey (display_name, email, email_confirmed_at)`. This is the same shape as `/requests` `PARENT_COLUMNS`; reuse or share it.
  - Linked children: `profiles` where `parent_id` is in the listed parent ids, with name (`display_name`, else `registration_name`) and `status`.
  - Admin RLS already allows all these reads; no migration.
- **Columns:**
  - Name (`display_name`, else email).
  - Email.
  - Status as a pill: Approved / Pending, plus "Email not confirmed" when `email_confirmed_at` is null.
  - Children: a comma-separated list of names, each with a muted "(pending)" or "(rejected)" when not approved, or "—" when there are none.
- **Order:** pending parents first, then by name. A header counter shows the total, like the other admin lists.
- **Read-only:** no approve or reject here (that stays on `/requests`); a short line links to `/requests` when any parent is pending.
- **Empty and error states:** no parents → the `ix-empty-state` pattern of the other admin lists; a read error → the page's error banner.
- **i18n:** new strings in en, de and bo.

**Never:**
- Writes of any kind.
- Showing parents to teachers.
- A migration.
- Changing `/requests`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Approved parent, 2 children | one approved, one pending child | row: name, email, Approved, "Anna, Pema (pending)" | N/A |
| Pending parent | unconfirmed email, no children | listed first; Pending + Email not confirmed; children "—" | N/A |
| Dual-role | a teacher who is also an approved parent | listed like any parent | N/A |
| No parents | empty table | empty state | N/A |
| Read failure | parents query errors | error banner, no table | banner |
| Non-admin | teacher opens /admin/parents | refused by the admin guard (as other admin pages) | guard |
| Nav | admin | menu shows Parents | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/admin/+layout.server.ts` -- the admin guard (reuse).
- `src/routes/admin/teachers/+page.server.ts`, `+page.svelte` -- list page pattern (header counter, table, empty state, error handling).
- `src/routes/requests/+page.server.ts:44-58` -- `PARENT_COLUMNS` and `toParent` (name fallback, email, `emailConfirmedAt`); share or copy the shape.
- `supabase/migrations/0023_parents.sql:30-58` -- `parents` table and admin select policy; `0024` `profiles.parent_id`.
- `src/routes/+layout.svelte:91-101` -- admin nav.
- `src/routes/admin/page.server.spec.ts` / teachers spec -- fake-supabase test patterns.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/admin/parents/+page.server.ts` (+ `page.server.spec.ts`) -- parents, children, ordering, errors.
- [x] `src/routes/admin/parents/+page.svelte` -- table, pills, children list, empty and error states, the link to `/requests`.
- [x] `src/routes/+layout.svelte` -- the admin Parents nav item.
- [x] `messages/{en,de,bo}.json`.

**Acceptance Criteria:**
- Given an approved parent with an approved and a pending child, when the admin opens Parents, then the row shows the parent's name, email, Approved, and both children with the pending one marked.
- `npm run supabase:reset`, `npm test`, `npm run check` and `npm run build` pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Note: the frozen Data rule's premise "rejected rows are deleted at rejection, so they never appear" is wrong. `requests` `rejectParent` keeps a `rejected` row for dual-role logins and when `deleteUser` fails. The only reading of the intent ("every parent with their status") is to show Rejected, so it's routed as a patch, not a spec change.

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | edge ×2, blind | Rejected parent rows exist but show as Pending (also missorted; misleading comment) | medium | patch | `requests/+page.server.ts` rejectParent sets `status: 'rejected'` for non-parent-only logins and on a delete failure. |
| 2 | vgap | The parent and child select strings are unasserted (dropping the `!parents_id_fkey` hint breaks the real query with PGRST201) | medium | patch | The fake's `select` ignores its argument; rows are cast `as unknown`. |
| 3 | edge, blind | "1 parent accounts waiting" | low | patch | A direct rewording. |
| 4 | blind | The children query doesn't filter `role = 'student'` | low | patch | A one-line filter. |
| 5 | blind | Query errors aren't logged | low | patch | A direct `console.error`. |
| 6 | edge | The counter shows 0 beside the error banner | low | patch | A direct template condition. |
| 7 | blind | The children comma separator may lose its space | low | patch | An explicit `{', '}`. |
| 8 | vgap, blind | No rendered or e2e check of markers, pills, the pending link, the nav item | medium | defer | Node-only vitest; admin e2e journey doesn't exist. |
| 9 | edge, blind | Empty child name or null profiles embed renders blank | low | reject | `display_name` falls back to the email at sign-up (0023); the FK makes the embed non-null for admin reads. |
| 10 | edge, blind | No paging past 1000 parents; `.in()` URL length | low | reject | School scale (one parent per family). |
| 11 | blind | bo strings are English | false | reject | Project convention. |
| 12 | blind | The query shape is copied from /requests instead of shared | low | reject | The spec forbade changing /requests; +page.server.ts can't export helpers. |
| 13 | blind | The section label isn't numbered like other admin kickers | low | reject | Cosmetic. |
| 14 | blind | The unconfirmed pill reuses a Requests-owned string | low | reject | Same meaning; coupling is acceptable. |
| 15 | blind | The pending link is unstyled | low | reject | Cosmetic. |
| 16 | edge | `localeCompare` without the app locale | low | reject | Names sort the same for en/de; negligible. |

## Verification

**Commands:**
- `npm run supabase:reset`, `npm test`, `npm run check`, `npm run build` -- expected: pass.
