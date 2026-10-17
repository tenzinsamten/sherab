---
id: SPEC-navigation-latency
companions:
  - latency-findings.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Navigation Latency

## Why

A pain to solve. Users report that the app "gets slower" as they move around. A production HAR (#104) shows the per-page cost does not grow. Every click waits on the server: about 500 ms on `/calendar` and 100–370 ms elsewhere. That wait is made of serial round trips: an Auth check over the network on every load, queries run one after another, and per-row RLS calls. On top of this, an occasional multi-second stall is made worse by hover preloading, which once froze a click for about 9 s. Teachers, admins and parents feel it on every navigation, and parents feel it most. Cutting the serial round trips and bounding stalls makes navigation feel instant and removes the freezes.

## Capabilities

- **CAP-1**
  - **intent:** A navigation verifies the signed-in user locally against the project's ES256 signing key, with no network call to Supabase Auth.
  - **success:** On a warm isolate, a page-only navigation makes zero requests to Supabase Auth. Admin `/calendar` server wait drops from about 500 ms to under 350 ms in a production HAR.
- **CAP-2**
  - **intent:** A click is never held behind a stuck preload, and a Supabase call that does not answer fails within a bounded time instead of hanging.
  - **success:** Hovering a link does not run that page's server load; preloading starts only on tap or press. A Supabase call stubbed to never answer makes the load return its error state within 9 s (8 s timeout plus 1 s).
- **CAP-3**
  - **intent:** The root layout load runs its independent queries in one concurrent batch and reads only the profile columns it uses.
  - **success:** The layout load has no query that waits on another it does not depend on. A root-layout re-run takes under 200 ms in a production HAR, down from about 300 ms.
- **CAP-4**
  - **intent:** The student and parent calendar load in no more serial database round trips than the admin and teacher calendar.
  - **success:** For a parent with two linked children, the calendar load makes one concurrent batch of queries after the Auth check. The data shown is identical to today's.
- **CAP-5**
  - **intent:** `/admin/parents` lists every parent's children, whatever the number of parents, in one round trip.
  - **success:** With 1 000 seeded parents, each with a child, the page loads and lists every child.
- **CAP-6**
  - **intent:** RLS policies on the calendar, enrollment, leave and parent tables evaluate `auth.uid()` and the role helpers once per query, not once per row.
  - **success:** `EXPLAIN` on the calendar session query shows the helpers as an InitPlan. All existing RLS tests pass unchanged.

## Constraints

- Access semantics do not change. The same roles see the same rows before and after, and the existing RLS tests pass unchanged.
- `safeGetSession` keeps its `{ session, user }` return shape for its 78 callers.
- The RLS change ships as a new migration. Past migrations are not edited.
- The app runs on Cloudflare Workers, so no Node-only APIs. The JWKS is fetched at most once per isolate.
- The project signs JWTs with ECC P-256 (ES256). Verification relies on it; switching back to HS256 would bring back the Auth round trip.
- A sign-out or ban may take up to the token lifetime (1 h) to reach page loads. This is accepted; RLS still guards the data.
- Every Supabase server fetch has an 8 s timeout. App-wide preloading is `tap`.
- Before any commit: DB reset, then test, check and build all exit 0. `database.types.ts` stays hand-maintained.

## Non-goals

- No browser-side leak work (#104c–f). The HAR shows no growth, so those suspects are unconfirmed.
- No caching of page data across requests or users.
- No Supabase tier or region change, and no realtime.
- No pagination redesign of admin lists.
- No root-cause fix for the 12 s stall until the logs show its cause. CAP-2 only bounds it.

## Success signal

- In a fresh production HAR (admin, at least 20 navigations over at least 20 minutes), every `__data.json` server wait is under 350 ms, including `/calendar`. No click waits longer than the fetch timeout.
- A parent opening `/calendar` sees it render as fast as an admin does.

## Assumptions

- The baseline comes from one admin HAR. The student and parent paths are unmeasured and estimated to be slower.

## Open Questions

- What caused the 12 s stall: a token refresh, a pool wait or the network? This needs the Worker and Supabase logs for 05:00:04–05:00:17 UTC.
