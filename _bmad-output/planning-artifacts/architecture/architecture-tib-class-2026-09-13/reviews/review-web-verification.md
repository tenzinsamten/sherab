---
type: review
reviews: '../ARCHITECTURE-SPINE.md'
reviewer: web-verification-check
purpose: 'Verify every committed technical decision in the spine was web-researched / reality-checked, not asserted from training data'
date: '2026-09-13'
---

# Web Verification Review — Class Tracker Architecture Spine

## Verdict

The spine's technology choices are **substantially real and currently fit for purpose** — SvelteKit, Supabase, `@vite-pwa/sveltekit`, `svelte-i18n`, and Cloudflare Pages all still exist, are current, and the memlog shows genuine web research (not just training-data assertion) behind most of them — but three research gaps could bite in practice: `svelte-i18n` is nearly two years stale, `@vite-pwa/sveltekit`'s declared peer range does not yet cover the SvelteKit 3 line that is already at release-candidate stage, and a real Supabase free-tier risk the memlog itself surfaced (7-day auto-pause) was never threaded into the spine's rules or Deferred section.

## Per-technology check

| Technology | Still exists / current? | Fits stated purpose? | Memlog research quality |
| --- | --- | --- | --- |
| SvelteKit | Yes. Stable line is 2.70.3 (published 2026-08-18 per npm registry); SvelteKit 3 is in RC (`3.0.0-next.27`), not yet stable. | Yes — smaller client bundle than Next.js is directionally confirmed by multiple independent 2026 sources (exact numbers vary 30–70% smaller depending on source; the memlog's "42KB vs 120KB" is a specific instance of a broadly-true claim, not a fabrication). | Good — cited a real comparative rationale (device-agnostic low-friction constraint), and the spine correctly hedges version pinning ("latest stable at build time, verify at implementation start") rather than asserting a fixed number. |
| Supabase (Postgres+Auth+Storage+Edge Functions) | Yes, actively developed, current pricing structure confirmed. | Yes — RLS-based relational model is a good fit for the class/role-scoped, history-as-append, multi-teacher domain described. | Good, but see Finding 3 (internal inconsistency) and Finding 1 (unaddressed pause risk) below. |
| `@vite-pwa/sveltekit` | Yes, package exists, latest is 1.1.0 (published 2025-11-27, confirmed via npm registry). | Mostly — zero-config PWA/offline plugin fits the installable-PWA requirement. | Thin on one axis — see Finding 2 (SvelteKit 3 peer-range gap). |
| `svelte-i18n` | Yes, package exists and is still the most commonly used Svelte i18n library, but latest release (4.0.1) was published 2024-10-21 — essentially unmaintained for ~23 months as of this spine's date. | Functionally yes for a 3-locale (de/en/bo) app, but see Finding 4. | Thin — memlog verified "is it the standard/popular choice," not "is it current/maintained," which is the more decision-relevant question given the alternative libraries research below turned up. |
| Cloudflare Pages free tier | Yes, current. Memlog's later figure (line 35: unlimited sites/bandwidth, 500 builds/month, Pages Functions on Workers' 100k req/day free plan) matches current published limits exactly. | Yes — comfortably covers a ~100-150 account, weekly-concentrated-usage app. | Good — correctly researched and even priced out the optional custom-domain cost. |

## Findings

### Finding 1 (moderate) — Supabase free-tier auto-pause risk surfaced in research but never carried into the spine's rules

The memlog (line 34) correctly researched and recorded that Supabase free projects "auto-pause after 7 days inactivity (manual dashboard restore, ~60s cold start)" and characterized this as "an operational quirk, not a cost." That characterization undersells it for *this specific app*: SPEC.md describes a Sunday school with admitted "weekly-concentrated usage" (the memlog's own cost-estimate note, line 36). A multi-week school holiday, or a quiet stretch where no teacher logs homework and no student checks the app, is a real and foreseeable way to cross 7 days of inactivity — at which point the app is down until someone notices and restores it from the dashboard (or has set up a keep-alive ping, which nothing in the spine sets up).

This is a case where the research was done, but its consequence never made it into `ARCHITECTURE-SPINE.md` — there is no AD, Deferred item, or Consistency Convention addressing it (confirmed: no occurrence of "pause"/"inactivity"/"cold start" anywhere in the spine). Recommend either an AD-6 addendum (e.g., a scheduled Edge Function or external keep-alive ping as part of "deployment & environments") or an explicit Deferred/Risk entry acknowledging it's accepted and who is responsible for watching the pause-warning emails.

### Finding 2 (moderate) — `@vite-pwa/sveltekit`'s verified compatibility does not cover the SvelteKit version transition already underway

The spine's Stack table asserts "`@vite-pwa/sveltekit` — latest (v1.x confirmed current, Sep 2026)" with no caveat. Registry data confirms 1.1.0 is indeed latest, but its `peerDependencies` pin `@sveltejs/kit` to `^1.3.1 || ^2.0.1` — it has no declared support for SvelteKit 3, which was already in release-candidate (`3.0.0-next.27`) at the time this spine was written (per `svelte.dev` blog and npm dist-tags, confirmed independently). The GitHub README likewise only claims SvelteKit 1/2 support, with no SvelteKit 3 mention.

This isn't hypothetical: the spine's own SvelteKit version rule says "latest stable at build time (verify at implementation start)." If SvelteKit 3 goes stable before this project starts building (plausible — it's already at `next.27`), the PWA plugin as currently verified may not yet support it. The memlog's verification (line 11) checked "actively maintained" and "zero-config... fits the constraint" but not forward-compatibility with the version transition its own SvelteKit research (implicitly) should have flagged. Recommend the spine's "verify at implementation start" instruction explicitly include re-checking `@vite-pwa/sveltekit`'s peer range against whatever SvelteKit line is picked, not just SvelteKit's own version.

### Finding 3 (minor) — Internal inconsistency in the memlog's own Supabase free-tier figures

Memlog line 10 (early Firebase-vs-Supabase comparison) states the Supabase free tier as "50k MAU, 500MB DB, 2GB bandwidth." Memlog line 34 (a later, more careful pass) gives "500MB DB, 1GB file storage, 50k MAU, 5GB egress, 500k Edge Function invocations/month... max 2 active free projects; auto-pause after 7 days." The 2GB-vs-5GB bandwidth/egress figures disagree. Independent verification here confirms the *later* figure (5GB: "5 GB database egress and 5 GB cached egress") is the current, correct one — so the spine itself isn't wrong (it doesn't hardcode a bandwidth number), but the research trail contains a stale, uncorrected assertion sitting alongside the corrected one. Worth a one-line strikethrough/correction in the memlog for anyone reading the trail later, since the earlier note reads as an unretracted claim.

### Finding 4 (minor-to-moderate) — `svelte-i18n` staleness and the Svelte 5/runes transition were not evaluated

`svelte-i18n` v4.0.1 was published 2024-10-21 and has had no release since — roughly 23 months of no updates as of this spine's Sep 2026 date, spanning the entire Svelte 5 (runes) rollout and now the SvelteKit 3 RC. Its `peerDependencies` nominally list `svelte: ^3 || ^4 || ^5`, so it isn't broken, but independent research surfaced that newer libraries (e.g. Sveltia i18n, `@shelchin/svelte-i18n`) were built specifically because `svelte-i18n`'s store-based API predates runes and the ecosystem sees it as needing a rework — a maintainer note found in research corroborates this ("due for reworking... when maintainers find time"). The memlog's verification (line 12) confirmed `svelte-i18n` is "the standard i18n library... fits the German/English/Tibetan UI constraint" but never checked recency or runes-compatibility risk — the two questions most relevant to a build starting in the SvelteKit-3-transition window this same memlog documents elsewhere (Flutter/SvelteKit research thread). Recommend flagging this for re-verification at implementation start alongside the SvelteKit version check, with `sveltekit-i18n` or a runes-native alternative as a fallback option if `svelte-i18n` proves incompatible with whatever Svelte/SvelteKit version is current then.

## What was done well (for balance)

- The Flutter-vs-SvelteKit detour (memlog lines 14-19) is the best-evidenced part of the trail: it cites a specific GitHub issue number (`flutter/flutter#148797`) for the Tibetan-script rendering gap, correctly notes the fix's shipped-version status as "unconfirmed" rather than overclaiming, and separately verified Flutter Web's WASM renderer size/TTI and remaining accessibility gap — this is exactly the "reality-check, don't assert" standard this review is checking for.
- Supabase vs. a custom backend (lines 20-22) is grounded in real cost figures (Railway compute + managed Postgres ranges, PocketBase as a named alternative) rather than a generic "BaaS is easier" assertion.
- The Cloudflare Pages figures (line 35) and the final cost projection (line 36) are accurate against current published limits and appropriately scoped to the project's actual expected size (~100-150 accounts).
- AD-3's security reasoning (client-computed award values are a real tamper vector, distinct from RLS's row-level guarantee) is sound architectural judgment, not a claim that needed web verification.

## Sources consulted for this review

- npm registry API (`registry.npmjs.org`) for `@vite-pwa/sveltekit`, `svelte-i18n`, `@sveltejs/kit` — exact version numbers, publish dates, peerDependencies (authoritative, first-party).
- GitHub `vite-pwa/sveltekit` README — stated SvelteKit version support.
- `svelte.dev/blog` (What's new in Svelte, June/Aug 2026) and Releasebot SvelteKit updates — SvelteKit 3 RC status.
- Supabase official docs (`supabase.com/docs/guides/platform/free-project-pausing`) and multiple independent 2026 pricing summaries — free tier limits and auto-pause behavior.
- Cloudflare Pages 2026 pricing summaries (multiple independent sources) — free tier builds/bandwidth/Functions limits.
- Multiple 2026 SvelteKit-vs-Next.js comparison articles — bundle size figures (directionally consistent, absolute numbers vary by source).
- Search results on `svelte-i18n` Svelte 5/runes compatibility and successor libraries (Sveltia i18n, `@shelchin/svelte-i18n`, `sveltekit-i18n`).
