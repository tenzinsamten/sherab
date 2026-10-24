---
title: 'Translated error page with a way back (#115)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/routes` has no `+error.svelte`, so a 404 (unknown address, another child's page), a 403 (`admin/+layout.server.ts`, `parent/+layout.server.ts`, `src/lib/server/class-access.ts`) and a failed form action show SvelteKit's bare default page: an English server message under every language, no heading, no way back.

**Approach:** Add a root `src/routes/+error.svelte` that renders inside the root layout's shell (header and navigation stay, signed in or out) with a translated heading and line for three cases — not found (404), no access (401/403), anything else — the status number (Tibetan digits under Tibetan), and one button back to the role's home (`roleHome` of the active role, `/` signed out). Server messages such as "Admin access only." are not shown (English, not for end users). Texts in en, de and bo; the Tibetan texts are the assistant's draft for the user to review.

</frozen-after-approval>

## Implementation Notes

- The page reads `page.status`, `page.error` and the root layout's data (`page.data.profile`, `page.data.activeRole`) from `$app/state`; same role rule as `+layout.svelte` (`data.activeRole ?? data.profile?.role`). Layout: a `data-ui="new"` root with `ui.page` signed in, the help page's padded frame signed out (`src/routes/help/+page.svelte`); `ui.card`, `ui.heading`, `Button` with `href`; Lucide `search-x` / `shield-x` / `triangle-alert`, `aria-hidden`; `<title>` from the heading.
- A pure helper `src/lib/error-page.ts` maps the status to the case, with a unit spec.
- Add the page to the `@source` list in `src/lib/ui/tailwind.css` (utilities are only collected from listed files).
- Browser test `e2e/error-page.e2e.ts`: an unknown address signed out (English, back to `/`), as a teacher on `/admin` (403, back to `/teacher`, shell still there), and under Tibetan (Tibetan heading, digits). `e2e/role-switcher.e2e.ts:120` expects `/403|Admin access only/` and keeps passing on "403".
- Not covered: an error thrown by the root layout's own load uses SvelteKit's static fallback (`src/error.html` does not exist); recorded as deferred.
- Built (2026-10-24): `src/routes/+error.svelte`, `src/lib/error-page.ts` (+ spec), ten `error_*` keys in en/de/bo, the `@source` line, `e2e/error-page.e2e.ts`. After review: a "Try again" link (same address, `data-sveltekit-reload`, works without JavaScript) beside the home button for the generic case. `e2e/team-students.e2e.ts` expected the server text "Team not found." on the page; it now expects the error page heading (intended change). File routes (`/files/...`, `+server.ts`) are not rendered by `+error.svelte`; `e2e/syllabus-files.e2e.ts:434` still sees "File not found." and passes.
- Verified: prettier and eslint clean; after a reset, `npm test` 1669/1669, `npm run build` and `npm run check` exit 0; after another reset, error-page, team-students, role-switcher, syllabus-files, homework-files and badges browser tests 42/42.
- The Tibetan texts (`error_*` in `messages/bo.json`) are the assistant's draft, not reviewed.

## Review Triage Log

- BH1 (signed-out 401 gets account wording): false; nothing in `src` throws 401 (`grep "error(401"` empty), and signed-out visitors are redirected to `/login` by the role layouts.
- BH2 (generic case says "try again" but offers no retry; home may be the failing page): medium, real; patched with a "Try again" link for the generic case.
- BH3 (home button can point at the page that failed): low, real only when a role home itself throws 404/403, which no load does today; for 500s the new retry link covers it; rejected.
- BH4 (no browser test for the generic case or German): low; forcing a 500 needs a test-only route; the mapping is unit-tested and the markup is shared; rejected.
- BH5 (server text suppression only asserted for 403): low; the page never renders `page.error.message`, and team-students now asserts the 404 heading; rejected.
- BH6 (more statuses in the unit spec, offline failures): low; offline handling is #120; rejected.
- BH7 (no static fallback for root layout errors): medium, real, pre-existing; deferred.
- BH8 (no `handleError` with an error id to quote): low/idea; deferred as an idea.
- BH9 (tour on the error page): maybe-false, low; PageTour waits for a hydrated page root, which the error root does not mark, so no tour starts; rejected.
- BH10 (signed-out frame classes copied from /help): low; two copies, simple to share later; rejected.
- BH11 (comment says "a failed action"): low, real; patched (a thrown error, not a `fail()`).
- BH12 (Tibetan drafts untracked; tsheg-space before digits; labels without shad): drafts tracked in the issue log entry; the tsheg-space before digits matches the existing date format (`ཕྱི་ལོ་ ༢༠༢༦`, #80); button labels without a final shad match other button labels (`ཁ་རྒྱག`); false.
- BH13 (screen readers not told about the error): low; SvelteKit's route announcer reads the new `<title>`, which is the heading; rejected.
