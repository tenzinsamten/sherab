---
title: 'A page action without a connection says so and keeps the page (#120)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a form action cannot reach the server (no connection), SvelteKit's `enhance` returns `{ type: 'error' }` without a `status` and `update()` applies it: the user lands on the error page (#115) and loses the page they were on, e.g. an offline "Mark done".

**Approach:** In `createPending` (`src/lib/pending.svelte.ts`), which every enhanced form but register and join goes through: when the answer is an error without a status (the fetch itself failed), do not apply it; show an error toast "No connection. Check your internet and try again." (new key `action_error_offline` in en, de, bo; the Tibetan text is the assistant's draft for the user to review), keep the page and the typed values, and end the pending state as usual (buttons enabled, focus restored). Errors the server answered (with a status) behave as today.

**Decisions (2026-10-24):** Split from #120 by the user: the offline navigation page (A) and an offline banner (B) are deferred; offline sync stays a non-goal (ARCHITECTURE-SPINE.md:240). Register and join keep their own flag (deferred in #118), so they are not covered.

</frozen-after-approval>

## Implementation Notes

- `src/lib/pending.svelte.ts`: `offline = result.type === 'error' && result.status === undefined` (SvelteKit's `enhance` sets `status` from the response; only a thrown fetch, or an unreadable answer, leaves it unset). Then: `showToast('error', m.action_error_offline())`, no `update()`, pending ends, and focus is restored (the skip for error results now applies only to applied error pages).
- `messages/{en,de,bo}.json`: `action_error_offline`. Tibetan draft for review: "དྲ་རྒྱ་དང་འབྲེལ་བ་མེད། དྲ་རྒྱ་ལ་ཞིབ་ལྟ་གནང་ནས་སླར་འབད་རོགས།".
- Tests: `pending.spec.ts` — a failed fetch toasts without `update()`, a server error is applied as before, focus returns after a failed fetch; the existing "error page moves no focus" fixture now carries `status: 500` (as real ones do); the document stub has `cookie` (the toast's message reads the locale). e2e `auth-mobile.e2e.ts` "no connection (…)": the sign-in POST aborted, toast shown, still on `/login` with the email kept, no error page.
- Review fix: `offline` now also requires `result.error instanceof TypeError` (a failed fetch); an unreadable answer (SyntaxError from `deserialize`, e.g. a proxy's HTML 502) keeps going to the error page. German text in the house style.

## Review Triage Log

- Unreadable answers (proxy HTML 502/504, captive portal) shown as "No connection" — medium, real: `fetch`, `response.text()` and `deserialize` share one `try` in SvelteKit's `forms.js`. Patched: only a `TypeError` counts; unit test for a `SyntaxError` added.
- Register and join not covered — false as "unmentioned": the frozen Decisions name them; moving them to `createPending` is deferred since #118.
- No test for the misclassification — low. Patched with the first.
- e2e only on login, one failure mode — low; rejected (the branch is in `createPending`, unit-tested; login is a `createPending` form).
- No early toast when already offline — low; rejected (watching `online`/`offline` is the deferred banner, #120 B).
- German text off house style — low, direct. Patched: "Bitte prüfe deine Internetverbindung und versuche es erneut." Tibetan stays a draft for the user.
- `cookie` in the document stub — low; rejected (test-only; Paraglide's cookie strategy is the project's configured one).
- restoreFocus fixture changed to `status: 500` — false: real server errors always carry a status; the new SyntaxError test pins the status-less non-network case.
- `offline` name and comment claim too much — low, direct. Patched: the comments now say a failed fetch (TypeError).
