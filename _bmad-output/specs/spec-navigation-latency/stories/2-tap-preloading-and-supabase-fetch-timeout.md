---
title: 'Tap preloading and Supabase fetch timeout'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
baseline_commit: '02a9abfb8e351ca7fc46bbf705ac9d7af0d2902a'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-navigation-latency/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `data-sveltekit-preload-data="hover"` (`src/app.html:18`) runs a page's full server load on hover, and a click that follows waits behind it. Supabase calls have no timeout, so one stalled call held a click for 8.8 s and a load for 12.4 s (SPEC CAP-2, #104g).

**Approach:** Preload on `tap` app-wide, and give every Supabase fetch made from the server an 8 s `AbortSignal` timeout. This covers the request-scoped client, the service-role client and the raw Admin API helper. A timed-out call then surfaces as the load's or action's normal error state instead of hanging. Decisions (user, 2026-10-17): 8 s, and `tap` everywhere.

Renegotiated after review (user, 2026-10-17):
- Only the request-scoped client gets the timeout. The service-role client and the raw Admin API helper keep no timeout, because an aborted Admin write can still land and leave a student approved with an unseen PIN.
- A stalled token refresh may still take up to ~30 s, because auth-js retries it. This is accepted and documented; capping it would sign the user out.

</frozen-after-approval>

## Implementation Notes

- New `src/lib/supabase/fetch-timeout.ts`: `fetchWithTimeout(ms = 8000)` wraps `fetch` with `AbortSignal.timeout`, combined with any caller signal through `AbortSignal.any` (both available on Workers at compat date 2026-09-13 and in Node 22).
- Wired in as `global.fetch` on `createSupabaseServerClient` (`server.ts`) only. `admin.ts` is unchanged, per the renegotiated intent.
- `src/app.html`: `data-sveltekit-preload-data` changes from `hover` to `tap`, and `data-sveltekit-preload-code="hover"` keeps the JS-chunk preload on hover. No other element sets its own preload attribute, and no code calls `preloadData`.
- The wrapper also honours a `Request` input's own signal, and logs `supabase fetch timed out after <ms> ms: <url without query>` on a timeout.
- Upload size is capped at 1 MB (`syllabus-files.ts`), so 8 s does not cut off normal uploads.
- supabase-js turns an aborted fetch into a returned `{ error }` for PostgREST and Storage, and auth-js into a retryable fetch error, so loads reach their existing `loadError` paths.
- Tests: `src/lib/supabase/fetch-timeout.spec.ts` covers the 8 s default, pass-through, the abort on timeout, the timeout log, a `Request`'s own signal, and the caller's own signal.

## Review Triage Log

Blind Hunter (the only layer on the oneshot route):

| # | Finding | Verdict | Evidence / route |
|---|---|---|---|
| 1 | A timed-out Admin API call throws a 500 out of `approve` (no try/catch at `requests/+page.server.ts:322`) | medium | Real when the helper had the timeout. Resolved by the user's decision: the Admin helper has no timeout, as before |
| 2 | An aborted Admin write can still land, leaving a student approved with an unseen PIN on retry | medium | Real: on retry `needsCredentials` is false, so no PIN is generated. HALT → user: no timeout on the service-role client or the Admin helper |
| 3 | A stalled token refresh retries for up to 30 s (8 s per try) | medium | Real: `_refreshAccessToken` retries `AuthRetryableFetchError` while the backoff fits in `AUTO_REFRESH_TICK_DURATION_MS`. HALT → user: accept and document (comment in `fetch-timeout.ts`, intent) |
| 4 | The cap is per call, with no request-wide budget | false | The intent bounds each Supabase call; loads measured at 100–600 ms make few calls. A request-wide deadline would not shorten the refresh backoff either |
| 5 | A `Request` input's own signal is overridden | low | Real but unreached (supabase-js passes strings); one-line fix → patched |
| 6 | Timeouts are not logged | low | Real; needed to confirm #104g in production. Small fix → patched (`console.warn`, URL without query) |
| 7 | The "defaults to 8 s" test checks the constant, not the default | low | Real but negligible; a fake-timer test adds complexity → rejected |
| 8 | No test of the client wiring or the end-to-end error path | low | The wiring is one option line, checked by type-check and the diff; the end-to-end path needs a stalled server → rejected |
| 9 | `tap` also drops hover code preloading | low | Real perf regression; one attribute → patched (`data-sveltekit-preload-code="hover"`) |
| 10 | The browser client has no timeout | false | `src/lib/supabase/client.ts` is never imported (#104 investigation) |
| 11 | `fetchWithTimeout()` is built per call or per client | low | Cosmetic; moot now that the only use is one client factory → rejected |
