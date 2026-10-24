---
title: 'Dashboard stays the current tab on its own pages (#125)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A role's Dashboard tab matches its exact path only (`src/lib/nav.ts`), so no bottom-nav or side-nav item is current on `/parent/children/[id]` (the parent's main page) or `/student/badges`.

**Approach:** A nav link can list extra paths it is also current on and below (`also`). The parent's Dashboard also covers `/parent/children`, the student's `/student/badges`; Dashboard stays exact otherwise (a teacher's or admin's class pages keep their own tabs). `/account` deliberately marks no tab: it is reached from the avatar menu (recorded in the code). Unit tests in `src/lib/nav.spec.ts`.

**Decisions (2026-10-24):** The user chose no tab on `/account`. On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `nav.ts`: `NavLink.also?: string[]`; `dashboard(href, also?)`; `isActive` checks `also` (on or below each path) before `exact`. Student: `[/student/badges]`; parent: `[/parent/children]`. Both navs (bottom and side) use `isActive`.
- `nav.spec.ts`: Dashboard current on `/parent/children/abc` and `/student/badges`, not on `/parent/childrenx` or `/student/classes`; no tab of any role current on `/account`.

## Review Triage Log

- `aria-current="page"` on an `also` match — low; rejected: same as the existing prefix matches (Classes reports "page" on every class page, #108); changing it would be an app-wide aria decision.
- `exact` doc no longer true — low, direct. Patched.
- `/account` note on the `also` field — low, direct. Patched (moved to `isActive`).
- `/account` check only on the bar, trivially true — low, direct. Patched (side nav too).
- Nested child route and `badgesx` boundary untested — low, direct. Patched.
- `also` lists may drift as pages are added — low; rejected (a new page would be reviewed with its tab).
- Test naming / one `it` for several roles — low; rejected (style).
- Branch name — false: the user asked for the remaining items on this branch.
