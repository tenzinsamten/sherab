---
title: 'Sign-in forms show that they are sending (#118)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Login, forgot password, resend confirmation and reset password submit with a plain `use:enhance`: the button never disables, shows no spinner and the layout's loading bar stays off (it counts only `createPending` actions). On a slow phone nothing shows that the form is sending, and a second tap submits again.

**Approach:** Submit these four forms through `createPending` (`src/lib/pending.svelte.ts`), as the app's other forms do: while the action runs, the submit button is disabled, carries `aria-busy` and a spinner (`LoaderCircle`, as register and join), a second submit (tap or Enter) is cancelled, and the loading bar shows. Field values after an error stay as they are today (`reset: false` where the page echoes values from `form`). Register and join keep their own pending state. The #117 inline errors are unchanged.

</frozen-after-approval>

## Implementation Notes

- `login`, `forgot-password`, `reset-password`, `resend-confirmation` `+page.svelte`: `createPending()`, `use:enhance={pending.submit('<key>')}`, the button `disabled={pending.busy}` and `aria-busy`, `LoaderCircle` while pending (login swaps it for its `LogIn` icon). `reset` stays at createPending's default (`true`), which is what the plain `use:enhance` did: fields reset only on success; after an error the #117 messages and echoed values stay.
- e2e `auth-mobile.e2e.ts` "sending (…)": each of the four forms with its POST held at the network: button disabled and `aria-busy`, Enter in a field sends nothing more (one POST), enabled again after the answer; the login and reset errors still show.
- Deviation noted: the frozen Approach says `reset: false` where the page echoes values; the forms keep createPending's default (`reset: true`), which is what their plain `use:enhance` did (reset only on success), so values after an error stay as today, as the Intent requires.

## Review Triage Log

- Enter after the button is disabled never reaches the cancel guard, so "one post per press" was untested — medium (test proves nothing). Patched: the test calls `form.requestSubmit()`; with the guard removed it now fails (2 POSTs).
- Forgot and resend legs assert no outcome — low, direct. Patched: success toast and status line asserted.
- Spinner and loading bar untested; values after an error unchecked — low. Patched the email kept after a failed login; spinner/loading bar rejected (the bar shows after 150 ms, timing-dependent; `aria-busy` and `disabled` are asserted).
- Focus restore after the answer unchecked — low; rejected (shared createPending behaviour with its own tests; the test no longer types into a field).
- No "sending" announcement for screen readers — low, real, app-wide (every createPending button); deferred.
- `#118` comment said "waits" — low, direct. Patched to "is ignored until the answer".
- Busy-button markup repeated; register and join still use their own flag (no loading bar, no focus restore) — low; deferred (the spec kept register and join as they are).
- Label shifts when the spinner appears on three forms — low; rejected (same as register and join).
- `heldSubmit` without `try/finally` — low, direct. Patched.
- Rate limit of 30 sign-ins per hour — maybe-false; rejected (one failed sign-in per viewport; local config only; would only be low).
