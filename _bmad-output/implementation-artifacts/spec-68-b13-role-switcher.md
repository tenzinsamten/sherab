---
title: 'B13 — Role switcher for logins with more than one role (#68)'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: 'cf7b8423572c40ebdacb1ae48876cbf1f55e9328'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A teacher or admin who is also an approved parent has no in-app way to reach the parent view; the menu, home and /calendar always show the staff role (#68).

**Approach:** Show the roles a login holds in the header avatar menu and let the user pick the active one; the side menu, home link, `/` redirect and /calendar follow the active role. No migration; access rules don't change.

**Decisions (user, 2026-09-29):**
- Switcher only in this build; creating a dual-role login from the app is B14.
- Roles appear in the avatar menu with a check on the active role; only shown when the login holds more than one role.
- The side menu shows only the active role's items.
- The choice is remembered in an `active_role` cookie, always checked against the roles the login really holds, and never used to grant access.
- `/parent/**` makes Parent active; `/teacher/**` and `/admin/**` make the staff role active; the cookie decides only on shared routes (`/calendar`, `/requests`, `/leaderboard`, `/account`, …).
- Parent is listed only when the login's `parents` row is approved.
- `/calendar` uses the active role, so a teacher-parent with Parent active gets the parent (children) view.

## Boundaries & Constraints

**Always:** Route guards and RLS stay on real capabilities (`profiles.role`, approved `parents` row), never on the cookie. A forged or stale cookie value is ignored. Logins with one role see no change at all (no switcher, same menu, same home). Labels via paraglide.

**Never:** No migration, no change to RLS or to who can open which route. No way to create dual-role logins here (B14). Don't edit `_bmad-output/manual-verification-issues.md` (the user has uncommitted rows there).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single role | teacher only, or parent only | no role items in the avatar menu; everything as before | N/A |
| Teacher-parent default | approved parent row + teacher, no cookie | Teacher active: teacher menu, `/` → /teacher | N/A |
| Switch to Parent | picks Parent in the avatar menu | cookie set; lands on /parent; parent menu; check on Parent | N/A |
| Remembered | reload / new visit to `/` | Parent still active; `/` → /parent | N/A |
| Shared route | /calendar with Parent active | parent calendar (children's sessions + leave answers) | N/A |
| URL wins | Parent active, opens /teacher/classes/… | Teacher becomes active for that page (menu matches) | N/A |
| Forged cookie | `active_role=admin` on a teacher-parent | ignored; staff/Parent resolution as if absent | N/A |
| Pending parent | teacher whose parents row is pending | Parent not listed; no switcher | N/A |
| Admin-parent | admin + approved parent | Admin / Parent listed, same behaviour | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/server/capabilities.ts:23` -- `getCapabilities` (profile role + approved `parents` row).
- `src/lib/role-home.ts` -- `roleHome(role)`; used by the `/` redirect (`src/routes/+page.server.ts`) and `homeHref`.
- `src/routes/+layout.server.ts` -- root load (profile, capabilities, counts); return `roles` and `activeRole`.
- `src/routes/+layout.svelte:73-128` -- `navItems` per `profile.role`, `homeHref`; header avatar menu (`ix-avatar` / dropdown from B2 #64): add a role group (`ix-dropdown-item` with a check icon on the active one) shown only when `roles.length > 1`.
- `src/routes/parent/+layout.server.ts` -- parent guard (capabilities); unchanged.
- `src/routes/calendar/+page.server.ts:104` -- parent view keyed on `role === 'parent'` → use the active role (still requiring the parent capability).
- `src/lib/menu*` -- existing menu-cookie pattern to follow for `active_role` (path `/`, `sameSite=lax`, `httpOnly`, long max-age).
- New `src/lib/server/roles.ts` -- `heldRoles(profile, capabilities)` (staff/student role plus `parent` if approved), `activeRole(held, cookie, pathname)` (URL prefix wins; else a valid cookie; else the staff role). Unit-tested.
- New `src/routes/role/+server.ts` (POST) or a form action -- validate the requested role against `heldRoles`, set the cookie, redirect to `roleHome(role)`; ignore/403 an unheld role.
- `src/lib/server/rls.spec.ts` `dualRole` fixture -- how a teacher-parent is made (service-role SQL); reuse in e2e fixtures.
- Messages en/de/bo: `role_switch_label`, `role_name_admin`, `role_name_teacher`, `role_name_parent`, `role_name_student`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/server/roles.ts` + `roles.spec.ts` -- `heldRoles`, `activeRole` (forged cookie ignored, URL prefix wins, pending parent excluded)
- [x] `src/routes/+layout.server.ts` -- return `roles`, `activeRole`
- [x] `src/routes/role/+server.ts` (or action) -- validated switch + cookie + redirect
- [x] `src/routes/+layout.svelte` -- nav/home by `activeRole`; avatar-menu role group when `roles.length > 1`
- [x] `src/routes/+page.server.ts` -- `/` redirect by active role
- [x] `src/routes/calendar/+page.server.ts` -- parent view when Parent is active (and held)
- [x] `messages/*.json` -- role labels
- [x] layout / calendar server specs -- active role cases
- [x] `e2e/` -- teacher-parent fixture: switch to Parent → parent menu, /calendar parent view, persists over reload; /teacher URL switches back; single-role parent/teacher see no switcher

**Acceptance Criteria:**
- Given any single-role login, when any page loads, then menu, home and redirects are exactly as before B13 and existing tests pass unchanged.
- Given a teacher-parent, when they request a route their capabilities don't allow, then access is refused exactly as before, whatever the cookie says.

## Implementation Notes

- Cookie `active_role` (httpOnly, path `/`, sameSite lax, 1 year) is set only by `POST /role` (`src/routes/role/+server.ts`) after checking the requested role against `heldRoles(getCapabilities())`; an unheld/unknown role is a 403 and sets nothing. The switch is a hidden native form in `+layout.svelte` (full page load, like sign-out).
- `src/lib/server/roles.ts`: `heldRoles` (profile role first, `parent` added only for an approved row and never twice), `roleForPath` (first path segment `admin|teacher|student|parent`), `activeRole` (held URL role > held cookie role > primary role).
- Root layout reads the caller's own `parents` row only for non-parent profiles (a plain `.eq('id')` read, first row). It reads `url` (delocalized, so `/de/parent/...` counts) **only when the login holds >1 role**, so single-role logins keep a layout load that does not re-run on every client navigation. A failed parents read is a `loadError`.
- The pending-requests badge count is still computed from `profiles.role`; with Parent active the parent menu simply has no Requests item.
- `/requests` and `/account` still key on `profiles.role` (spec only moves `/calendar`, home and `/`). The URL-wins rule is per page and does not update the cookie.
- de labels: Lehrkraft / Elternteil / Schüler:in; bo falls back to English like other untranslated bo keys.

## Spec Change Log

## Review Triage Log

Pass 1 (blind = B, verification-gap = V, edge-case = E):

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | E3 + B8: `active_role` survives sign-out (1 year), so the next login on a shared browser inherits the choice | medium | `logout/+server.ts` doesn't delete it | patch |
| 2 | B1: clicking the checked role is a no-op when the URL decided it, so the cookie keeps the other role | medium | `switchRole` compares against the page's role, not the cookie | patch |
| 3 | E4 + B2 + V-other: `POST /role` redirects to an unprefixed path; with paraglide's `url` strategy first, a `/de` user drops to the base locale | medium | `redirect(303, roleHome(role))` without `localizeHref` | patch |
| 4 | E5 + E8 + B5 + V2: the layout reads `parents` its own way; a failed read sets the global `loadError` for single-role logins (against the AC) and isn't tested; two code paths decide the held roles | medium | new query in `+layout.server.ts`; `getCapabilities` elsewhere | patch (reuse `getCapabilities`; on failure fall back to the profile role without the global error; test it) |
| 5 | E6 + B6: `deLocalizeUrl(url)` makes the root load depend on the full URL, so multi-role logins reload it on every query change | low | direct: derive from `url.pathname` only | patch |
| 6 | V1: `/` redirect by active role has no unit test | medium | only e2e covers it | patch |
| 7 | E1 + E2 + B3: `POST /role` returns 500 for a non-form body and 403 "Role not held" when the capability read fails; no signed-out / failed-read tests | low | direct | patch |
| 8 | B4 (comment) + B10 + B11: `roles.ts` doc lists /requests and /account as following the active role; "No role anywhere (#62)" comment is stale; comments disagree on student-parents | low | behaviour follows the intent (only /calendar, home, `/`); fix the comments | patch |
| 9 | B4: /requests and /account still use the staff role | false | intent moves only /calendar, home and `/`; Requests isn't in the parent menu, reaching it by URL shows the staff page as before | rejected |
| 10 | B7: pending count still computed with Parent active | low | cheap; the badge returns when switching back | rejected |
| 11 | E7: parents approval revoked after render → bare 403 page on switch | low | rare; access is still correctly refused | rejected |
| 12 | B9: bo labels English | low | existing practice | rejected |
| 13 | B12: switcher needs JS and redirects to the role's home | false | iX menus need JS; the matrix says "lands on /parent" | rejected |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm test` -- expected: all pass
- `npm run check` -- expected: 0 errors
- `npm run build` -- expected: exit 0
- `npm run supabase:reset` then `npm run test:e2e` -- expected: all pass
