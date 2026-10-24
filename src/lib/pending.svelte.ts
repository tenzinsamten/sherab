import { tick } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { showToast } from '$lib/toast';
import { actionEnded, actionStarted } from './busy.svelte';

/**
 * Tracks which form submission on a page is in flight, so the button that
 * started it can show a loading spinner and every action button can be
 * disabled until the server answers (no double creates or deletes).
 *
 *   const pending = createPending();
 *   <form use:enhance={pending.submit('create')}>
 *   <Button type="submit" disabled={pending.busy} aria-busy={pending.is('create') || undefined}>
 *
 * `key` may be a function for shared hidden forms (e.g. one delete form for
 * every row); it is read at submit time, after the row's target is set.
 * `{ reset: false }` keeps the form's fields after a successful submit (for
 * forms whose values come back from the reloaded page data, like checkboxes,
 * which a reset would return to their server-rendered state).
 * The reset only clears a field to its server-rendered default, so forms
 * whose defaults come from props remount with {#key} after a success (the
 * create form's ScheduleFields in admin/classes/+page.svelte).
 * `confirm` (#91) asks before posting, for a press that cannot be undone:
 * the form is only submitted when it resolves true (see `with` in confirm.svelte.ts).
 * Story 11: every submit that actually posts is counted app-wide
 * (busy.svelte.ts) until its `update()` settles, for the layout's loading bar.
 * #109: the disabled buttons drop focus to <body> while the action runs, and
 * on success SvelteKit's applyAction moves it to <body> too, so afterwards
 * focus goes back to where it was when the answer came (a text field after
 * Enter, or one the user moved to), else to the pressed button (see `restoreFocus`).
 * #120: when the request could not be sent (the fetch threw a TypeError: no
 * connection), a toast says so and the page stays as it was.
 */
export function createPending() {
	let current = $state<string | null>(null);
	let asking = false;

	return {
		get busy() {
			return current !== null;
		},
		is(key: string) {
			return current === key;
		},
		submit(
			key: string | (() => string),
			options: { reset?: boolean; confirm?: () => Promise<boolean> } = {}
		): SubmitFunction {
			const start: SubmitFunction = ({ cancel, submitter }) => {
				// Enter in a text field still submits while the button is disabled.
				if (current !== null) return cancel();
				current = typeof key === 'function' ? key() : key;
				actionStarted();
				return async ({ update, result }) => {
					// Where focus is as the answer arrives, before applyAction resets it.
					const before = typeof document !== 'undefined' ? document.activeElement : null;
					// #120: the fetch itself failed (a TypeError, no status). An answer that
					// came but could not be read (a proxy's HTML 502) also has no status,
					// but throws a SyntaxError, and goes to the error page as before.
					const offline =
						result.type === 'error' &&
						result.status === undefined &&
						result.error instanceof TypeError;
					try {
						// #120: no connection: say so and keep the page and its values,
						// instead of the error page.
						if (offline) {
							showToast('error', m.action_error_offline());
						} else {
							await update({ reset: options.reset ?? true });
						}
					} finally {
						current = null;
						actionEnded();
						// A redirect's new page and an error page set their own focus; the
						// page kept after a failed fetch (#120) does not.
						if (result.type !== 'redirect' && (result.type !== 'error' || offline)) {
							await restoreFocus(before, submitter);
						}
					}
				};
			};
			const { confirm } = options;
			if (!confirm) return start;
			return async (input) => {
				// A second press while the question is open asks nothing more.
				if (current !== null || asking) return input.cancel();
				asking = true;
				try {
					if (!(await confirm())) return input.cancel();
				} finally {
					asking = false;
				}
				return start(input);
			};
		}
	};
}

/**
 * #109: once the buttons are enabled again, puts focus back on the first
 * candidate that can take it: the element focused before the answer was
 * applied, else the button that started the action. Only when focus was lost
 * (it is on <body> or nowhere): focus a dialog or a new page moved elsewhere
 * stays. <body>, an element that left the page or one still disabled is skipped.
 */
export async function restoreFocus(...candidates: (Element | null | undefined)[]) {
	if (typeof document === 'undefined') return;
	// The `disabled={pending.busy}` attributes update on the next flush.
	await tick();
	const active = document.activeElement;
	if (active !== null && active !== document.body) return;
	// An element can pass these checks and still not take focus (hidden, an
	// inert ancestor, a disabled fieldset), so the next one is tried.
	for (const el of candidates) {
		if (!el || el === document.body || !el.isConnected) continue;
		if ((el as HTMLButtonElement).disabled) continue;
		if (typeof (el as HTMLElement).focus !== 'function') continue;
		(el as HTMLElement).focus({ preventScroll: true });
		if (document.activeElement === el) return;
	}
}
