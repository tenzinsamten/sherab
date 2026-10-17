---
title: 'Local JWT verification with getClaims'
type: 'refactor'
created: '2026-10-17'
status: 'done'
baseline_commit: 'aaead570a3cca98611046d229e65914c108624e8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/latency-findings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `safeGetSession` calls `auth.getUser()` on every call. That is a network round trip to Supabase Auth (~100–200 ms) before any query, and it runs more than once per request when a layout and a page both call it (SPEC CAP-1, #104a).

**Approach:** Verify the access token locally with `auth.getClaims()` against the project's ES256 key (the JWKS is cached per Worker isolate by auth-js), build the returned `user` from the verified claims, and memoise the result so one request verifies once.

## Boundaries & Constraints

**Always:**
- Keep the `{ session, user }` return shape. `user` exposes `id` (from `sub`) and `email`, plus `app_metadata` and `user_metadata` from the claims. Narrow the `App.Locals` type to these fields, so `npm run check` flags any caller that reads anything else.
- A missing, expired, forged or unverifiable token gives `{ session: null, user: null }`, exactly as a failed `getUser()` does today.
- Memoise per request (one promise per `event`), never across requests or users.
- Use only Workers-compatible APIs. The JWKS cache is auth-js's module-level `GLOBAL_JWKS` (10 min TTL), so no cache of our own.
- Accepted (user, 2026-10-17): a sign-out or ban reaches page loads only when the access token expires (at most 1 h). RLS still guards the data.
- Decided (user, 2026-10-17): a PIN reset (#88) follows the same rule. Devices that are already signed in can keep working for up to 1 h, and the reset dialog says so. `pin_reset_confirm` changes in en, de and bo:
  - en: "Give {name} a new PIN? Their current PIN stops working immediately. Devices where they are already signed in stay signed in for up to an hour."
  - de: "{name} eine neue PIN geben? Die bisherige PIN funktioniert sofort nicht mehr. Auf Geräten, auf denen {name} bereits angemeldet ist, bleibt die Anmeldung noch bis zu einer Stunde bestehen."
  - bo: the same meaning, in the style of the existing `pin_reset_*` strings.

**Never:**
- No change to `handleUnapprovedStudent`, its `tokenClaims` helper, RLS or any caller's logic.
- No HS256 fallback code of our own (auth-js already falls back to `getUser()` for HS tokens, which is what local `supabase start` issues).
- No caching of the result outside the request.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid ES256 session | cookie session, valid token | `{ session, user: { id: sub, email, … } }`, no `/auth/v1/user` call | N/A |
| No session | no auth cookie | `{ session: null, user: null }`, `getClaims` not called | N/A |
| Bad token | expired, tampered signature or unknown `kid` | `{ session: null, user: null }` | `getClaims` error swallowed, as today |
| Called twice in one request | layout and page both call it | the second call returns the same result, verifying once | N/A |

</frozen-after-approval>

## Code Map

- `src/hooks.server.ts:49-68` -- `safeGetSession`, today `getSession()` then `getUser()`. Replace the body here. Extract it into an exported factory (e.g. `createSafeGetSession(supabase)`) so it can be unit-tested.
- `src/app.d.ts` -- `Locals.safeGetSession` returns `User`. Narrow it to the claim-backed shape.
- `node_modules/@supabase/auth-js` 2.116 -- `getClaims(jwt?)`: with no `jwt` it calls `getSession()` itself (and refreshes if needed); it verifies with `crypto.subtle` against a JWKS cached in `GLOBAL_JWKS`; for HS tokens it falls back to `getUser()`. Returns `{ data: { claims }, error }`.
- Callers (64 files, about 120 uses) read only `user.id` and `user.email` (checked with grep). `signup-duplicate.ts` uses a `User` from `signUp`, not from `safeGetSession`, so leave it alone.
- `src/hooks.server.spec.ts` -- existing mock pattern (`locals.supabase.auth.getSession`). Add `safeGetSession` tests here.
- Route specs (`layout.server.spec.ts`, `calendar/page.server.spec.ts` and others) mock `safeGetSession` as `{ user: { id } }`. They are unaffected, so don't touch them.
- `src/lib/server/student-pin.spec.ts:355-357` -- the comment says safeGetSession asks `getUser()`. The assertion (Supabase Auth refuses the old session) stays; only the comment changes.
- `src/lib/server/student-pin.ts:76` -- the comment says "signed out on all devices". Reword it: the refresh is refused, and page loads follow at token expiry.
- `messages/en.json:618`, `messages/de.json:618`, `messages/bo.json:618` -- `pin_reset_confirm`, shown by `src/lib/components/EnrollmentPanel.svelte:130` in the reset confirm dialog. No test asserts this text.

## Tasks & Acceptance

**Execution:**
- [x] `src/hooks.server.ts` -- Move `safeGetSession` into an exported factory that calls `getSession()`, then `getClaims()` (passing the session's access token), maps the claims to `user`, and memoises the promise. Wire it into `handleSupabase`. -- Removes the Auth round trip; one verification per request.
- [x] `src/app.d.ts` -- Narrow the `user` type to `{ id; email?; app_metadata; user_metadata }`. -- The compiler then enforces the claim-backed shape.
- [x] `src/hooks.server.spec.ts` -- Unit tests for the four I/O rows, with `getClaims` and `getUser` mocked. Assert that `getUser` is never called on the valid path and `getClaims` runs once over two calls. -- Locks in the behaviour.
- [x] `src/lib/server/student-pin.spec.ts`, `src/lib/server/student-pin.ts` -- Update the comments at :355-357 and :76. -- Keeps them honest about what page loads check.
- [x] `messages/en.json`, `messages/de.json`, `messages/bo.json` -- Set `pin_reset_confirm` to the decided text. -- Teachers know old devices can stay signed in for up to 1 h.

**Acceptance Criteria:**
- Given a signed-in admin on a warm Worker, when they open `/calendar`, then the request makes no call to `/auth/v1/user`.
- Given the full suite, when `npm run test` runs after `supabase db reset`, then every existing test passes, including the PIN reset and RLS specs.
- Given a teacher clicking Reset PIN, when the confirm dialog opens, then it states that already-signed-in devices stay signed in for up to an hour, in the current language.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap):

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | `getSession()` outside the `try`; a throw is memoised for the whole request | low | Real: `hooks.server.ts` awaits it before the `try`. The old code also 500'd on a throw, but the fix is moving one line | patch |
| 2 | Memo goes stale after an in-request auth change (`changePassword`, `reset-password`) | low | Real but harmless: the old access token stays valid, fresh cookies are set, and no browser Supabase client reads `PageData.session`. Fix adds API (a reset hook) | reject |
| 3 | `session.user` is the unverified cookie object (`+layout.svelte:84`, `requests/+page.server.ts:129`, `parent`, `account`) | low | Pre-existing: the old code returned the same cookie `session` next to `getUser()`. RLS still scopes the queries to the token's `sub` | defer |
| 4 | `account_password_success` (en/de/bo) still says other devices "have been signed out" | medium | Real, caused by this change: `signOut({ scope: 'others' })` now reaches page loads only at token expiry. Same rule as the approved PIN copy | patch |
| 5 | `reset-password` sign-out of other sessions is no longer immediate | false | Covered by the accepted rule (sign-out reaches page loads within 1 h). There is no copy on that page claiming otherwise | reject |
| 6 | HS256 / no-`kid` fallback brings the Auth call back; local stack is HS256 | false | The production key is ES256 (user, 2026-10-17). The local fallback is expected and in the spec's Never list | reject |
| 7 | "No call to Supabase Auth" comment ignores the JWKS refetch (cold isolate, 10 min TTL) and token refresh | low | Real overstatement in the `hooks.server.ts` doc comment; the fix is a comment correction | patch |
| 8 | "RLS still guards the data" overstates: a revoked but unexpired token still passes RLS | low | Real: PostgREST trusts the signed JWT until `exp`. Fix: reword the comments in `hooks.server.ts` and `student-pin.ts` | patch |
| 9 | "Up to an hour" is hard-coded but follows `jwt_expiry` | low | Real but unlikely to drift (3600 is the hosted default too). Fix adds config plumbing | reject |
| 10 | No test drives `createSafeGetSession` with a real local client and token | medium | Verification-gap, pre-verified: only mocked `getClaims` is tested. The "no network call" half can't run locally (HS256) and needs the production HAR | patch |
| 11 | PIN test doesn't show that the old session stays signed in for up to 1 h | false | Locally `getClaims` falls back to `getUser()`, which is refused after a reset, so that contract can only be observed on ES256 (production) | reject |
| 12 | No test that `handleSupabase` installs a fresh instance per request | low | The code visibly creates one per request; the fix adds a test of wiring. Unlikely to regress | reject |
| 13 | `class-syllabus.spec.ts`, `syllabus-files.spec.ts` still cast fixtures to `User` | low | Real; the fix is a direct type correction in two spec files | patch |
| 14 | Claims not checked for `role === 'authenticated'` / `aud` | false | Anon and service-role tokens carry no `sub`, so the `sub` check rejects them. The old `getUser()` accepted the same user tokens | reject |
| 15 | en/de copy "stops working immediately" then "stay signed in" reads as a contradiction | low | The user approved this exact text (frozen). The fix would edit the spec | reject |
| 16 | bo copy should be checked for "up to" vs "for" an hour | low | `སྡོད་སྲིད` ("may stay") carries "up to". Already flagged for a native-speaker check | reject |
| 17 | Local behaviour (signed out at once) differs from the copy (up to 1 h) | low | Dev-only; production is ES256. Fix adds complexity | reject |

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: exit 0
- `npm run test` -- expected: exit 0
- `npm run check` -- expected: exit 0, no type errors from the narrowed `user`
- `npm run build` -- expected: exit 0

**Manual checks:**
- After deploy, in a HAR of 10 navigations: no `auth/v1/user` requests from the Worker, and `/calendar` server wait under 350 ms. Worker logs or Supabase Auth logs show the absence of `/user` calls.
