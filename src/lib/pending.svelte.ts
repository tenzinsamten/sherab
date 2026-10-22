import type { SubmitFunction } from '@sveltejs/kit';
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
			const start: SubmitFunction = ({ cancel }) => {
				// Enter in a text field still submits while the button is disabled.
				if (current !== null) return cancel();
				current = typeof key === 'function' ? key() : key;
				actionStarted();
				return async ({ update }) => {
					try {
						await update({ reset: options.reset ?? true });
					} finally {
						current = null;
						actionEnded();
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
