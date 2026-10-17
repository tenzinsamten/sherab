# Latency findings

Baseline and code locations behind each capability. Full narrative: #104 in
`_bmad-output/manual-verification-issues.md`.

## Baseline (production HAR, admin login, 2026-10-17, 22 `__data.json` over ~22 min)

| Page (`__data.json`) | Server wait | Notes |
|---|---|---|
| `/calendar` | 479, 568, 577 ms | page load only (`invalidated=01`) |
| `/admin` | 369 ms | |
| `/requests` | 288, 299 ms | |
| `/admin/teachers` (layout re-run, `111` / `011`) | 276, 311 ms | root layout cost (#104b) |
| `/admin/classes`, `/teams`, `/teachers`, `/leaderboard` | 99–175 ms | |
| `/admin/parents` | 170–311 ms, once **12 380 ms** | 05:00:04 UTC; next click blocked 8 805 ms behind it |
| `/admin/teams` after ~17 min idle | 808 ms + new TLS | likely Worker cold start; not targeted |

No growth with session length. Download time ≈ 0–5 ms on every request.

## Code map

| CAP | Location | Today |
|---|---|---|
| CAP-1 | `src/hooks.server.ts:56-70` `safeGetSession` | `getSession()` then `getUser()` (network) on every call; 78 loads call it, incl. `src/routes/+layout.server.ts:20`, `src/routes/calendar/+page.server.ts:58` |
| CAP-2 | `src/app.html:18` | `data-sveltekit-preload-data="hover"` runs the full server load on hover |
| CAP-2 | Supabase server client (`fetch` option) | no timeout; a stalled call hangs until the Worker gives up |
| CAP-3 | `src/routes/+layout.server.ts:41`, `:82`, `:98-118` | `profiles select('*')`; `getCapabilities` after the profile read; admin `parents` and `deletion_requests` counts after the `Promise.all` |
| CAP-4 | `src/routes/calendar/+page.server.ts:77-99`, `:124-131`, `loadParentView :192-274` | admin/teacher batch is parallel; student adds 1 serial query, parent adds 3 (`linked_children` → `class_enrollments` → `session_leave_history`) |
| CAP-5 | `src/routes/admin/parents/+page.server.ts:44-46`, `:58-62` | children fetched after parents with `parent_id IN (<all ids>)` in the URL (~37 chars per UUID) |
| CAP-6 | migrations 0001 (`is_admin`), 0016 (`class_enrollments_select`), 0023 (`parents_select_own_or_admin`), 0025 (`class_sessions_select`), 0027:164-176 (`session_leave_history_select`) | bare `auth.uid()` and helper calls per row; `is_parent_in_class` is a nested policy path |

## Estimated savings (from code reading, not measured)

- CAP-1: 100–200 ms on every navigation (more where nested loads each call it).
- CAP-3: 100–200 ms per root-layout re-run.
- CAP-4: 250–450 ms on the parent calendar, one round trip on the student calendar.
- CAP-6: 20–100 ms on student and parent paths; ~1–5 ms for admin.

## 12 s stall: ranked causes (unconfirmed)

Not a long query: the default `statement_timeout` for `authenticated` is 8 s.
1. Concurrent access-token refresh by preload and click with the same refresh token.
2. PostgREST pool acquisition wait (up to 10 s, then `PGRST003`; the load logs `admin parents load: parents failed`).
3. Stalled Worker-to-Supabase connection (no fetch timeout).
4. DDL lock, unbounded query, Auth calls: low.

Tell apart with Cloudflare Worker and Supabase Auth/API/Postgres logs for 05:00:04–05:00:17 UTC.

## Minor, not in scope

`class_sessions_effective` (0027:65-86) computes `session_starts_at(s.id)` per row; harmless while no page selects `starts_at` over a wide range.
