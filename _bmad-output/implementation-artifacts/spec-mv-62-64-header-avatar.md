---
title: 'Manual-verification B2: header avatar menu; no role in toolbar'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '0f16321e21cc0d55a12e5786327dad0c6793c4f5'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The header shows the user's role next to "Sherab" (#62). My account and Sign out sit at the bottom of the side menu (#64).

**Approach:**
- Remove the role from the header.
- An iX avatar at the header's right end opens a menu with My account and Sign out.
- The side menu loses its bottom Account and Sign out items.

## Boundaries & Constraints

**Always:**
- **Header:** `ix-application-header` gets no `name-suffix`, so the role is never shown.
- **Avatar:** `<ix-avatar>` in the `ix-application-header-avatar` slot.
  - It shows the display name (`username`); initials are the fallback.
  - Its dropdown items, in order: My account (`/account`), Sign out.
  - Sign out still posts the existing `/logout` form.
- **Role switcher:** out of scope; split into its own task (a dropdown of all the user's roles, #68).
- **Decision 1 — language placement:** the language dropdown moves to the header's default (right-hand) slot, next to the avatar. On small screens iX folds it into the header's "more" menu (two taps), which the user accepted.
- **Signed-out header:** unchanged (language only, no avatar).
- **Accessibility:** the avatar has an accessible name (e.g. "Account menu for <name>").
- **i18n:** new strings in en, de and bo, reusing `nav_account` and `nav_sign_out`.

**Never:**
- Showing the role anywhere in the header.
- Any role switcher (split out as #68).
- Any change to the authorization rules.
- Removing the language choice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teacher | teacher | header "Sherab" only; avatar menu: My account, Sign out | N/A |
| Parent / student / admin | each primary role | the same avatar menu; no role shown | N/A |
| Sign out | pick Sign out in the avatar menu | posts `/logout`, lands signed out | N/A |
| Signed out | no session | header with language only, no avatar | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/+layout.svelte`:
  - `:132-164` `headerItems` snippet: the language dropdown in `slot="ix-application-header-avatar"`.
  - `:168-174` signed-in header with `name-suffix={data.profile.role}` (#62).
  - `:176-200` side menu: bottom Account `:188-195` and Sign out `:197-199` (remove); `:201` the logout form (keep).
- iX: `ix-avatar` props `username`, `initials`, `extra`, `tooltipText`, child `ix-dropdown-item`s; header slots `default`, `secondary`, `ix-application-header-avatar` (`node_modules/@siemens/ix/dist/types/components/{avatar,application-header}`).

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/+layout.svelte` -- remove `name-suffix`; add the avatar menu; move the language picker to the default slot (decision 1); drop the side-menu bottom items.
- [x] `messages/{en,de,bo}.json` -- the avatar aria-label.

**Acceptance Criteria:**
- Given any signed-in user, then the header shows "Sherab" with no role, and My account and Sign out work from the avatar.
- `npm test`, `npm run check` and `npm run build` pass.

## Implementation Notes

- The implementation subagent stalled (no progress for 600s) after most of the work was done; the lead session finished it: build failure fixed (a snippet can't pass a dynamic `slot`, so the language items are a snippet rendered inside two `ix-dropdown-button`s with static slots), then format, lint and checks.
- `src/lib/initials.ts` (+ spec): up to two initials from the display name (whole code points).
- `src/lib/ix.ts` `avatarLabel` action: iX drops a host `aria-label` when `initials` are shown, so the action sets the accessible name on the avatar's internal button.
- The avatar name falls back to the e-mail when there's no display name.
- 35 rls.spec failures on the first test run were stale local data (known, deferred-work.md); after `supabase:reset`, 612/612 passed.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind, edge | An empty name gives the label "Account menu for " | low | patch | `userName` falls back to `''`; now uses `nav_account` when empty. |
| 2 | blind, edge | `initials` splits decomposed accents and ZWJ emoji; locale-dependent upper case; ß becomes SS (3 letters) | low | patch | `Array.from` is per code point; now `Intl.Segmenter` graphemes, `toUpperCase()`, and a growing upper case keeps the original; tests added. |
| 3 | blind, edge | `avatarLabel` has no destroy, keeps a stale button reference, and is a silent no-op if the button is missing | low | patch | Now re-queries the button on each write, falls back to the host `aria-label`, and has a `destroy` guard. |
| 4 | edge | The `goto()` promise is ignored | low | patch | `void goto(...)`. |
| 5 | vgap, blind | No browser test of the header (no role; avatar menu order; My account and Sign out work; signed-out header) | medium | defer | Node-only vitest; the one e2e is calendar; same deferral as the other parent-page e2e items. |
| 6 | edge, blind | The language dropdown inside iX's small-screen overflow menu is unverified (nested dropdown may not open) | maybe-false (medium) | defer | Needs a phone-width browser check; decision 1 accepted the overflow placement. |
| 7 | blind, edge, vgap-other | `/account` has no active state after the side-menu item was removed | low | reject | The page heading shows where you are; a checked dropdown item would be misleading. |
| 8 | blind | bo string is English | false | reject | Project convention for new bo strings. |
| 9 | blind | The #34 CSS comment assumes the secondary nav variables still apply | low | reject | Comment-only; the variables are harmless if unused. |
| 10 | blind | The language dropdown markup is duplicated | low | reject | Two adjacent copies in one file, forced by the static-slot rule. |
| 11 | blind | The e-mail fallback shows the full address | low | reject | Every role has a display name; the fallback is rare. |

## Verification

**Commands:**
- `npm test`, `npm run check`, `npm run build` -- expected: pass, 0 errors.

**Manual checks:**
- Desktop and phone width: avatar menu and language picker placement.
