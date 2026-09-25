import type { SubmitFunction } from '@sveltejs/kit';

/**
 * Tracks which form submission on a page is in flight, so the button that
 * started it can show iX's `loading` spinner and every action button can be
 * disabled until the server answers (no double creates or deletes).
 *
 *   const pending = createPending();
 *   <form use:enhance={pending.submit('create')}>
 *   <ix-button loading={pending.is('create') || undefined} disabled={pending.busy || undefined}>
 *
 * `key` may be a function for shared hidden forms (e.g. one delete form for
 * every row); it is read at submit time, after the row's target is set.
 */
export function createPending() {
	let current = $state<string | null>(null);

	return {
		get busy() {
			return current !== null;
		},
		is(key: string) {
			return current === key;
		},
		submit(key: string | (() => string)): SubmitFunction {
			return ({ cancel }) => {
				// Enter in a text field still submits while the button is disabled.
				if (current !== null) return cancel();
				current = typeof key === 'function' ? key() : key;
				return async ({ update }) => {
					try {
						await update();
					} finally {
						current = null;
					}
				};
			};
		}
	};
}
