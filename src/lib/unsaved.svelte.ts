import { tick } from 'svelte';
import type { Action } from 'svelte/action';
import type { SubmitFunction } from '@sveltejs/kit';
import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
import * as m from '$lib/paraglide/messages.js';
import type { Confirm } from './confirm.svelte';

/**
 * #121: asks before leaving a changed homework create / edit form or
 * syllabus section form. One guard per page, created during component init
 * with the page's `createConfirm()` (one question at a time):
 *
 *   const unsaved = createUnsavedGuard(confirm);
 *   <form use:unsaved.track use:enhance={unsaved.submit(pending.submit('edit'))}>
 *   <ConfirmDialog {confirm} />
 *
 * A form is changed when what it would post (`formSignature`) differs from a
 * snapshot taken at its first `focusin` / `pointerdown` / `dragenter`: after
 * mount, so the rich-text editor's own normalising does not count, and
 * before the first edit. A form never touched is not changed.
 *
 * Leaving a changed form inside the app (a link, the nav, Back, `goto`) is
 * cancelled and the dialog asks; Leave continues to the same address (Back:
 * `history.go(delta)`). Reload or closing the tab (`'leave'`) gets the
 * browser's own prompt. A link to an outside address is asked in the dialog
 * too: SvelteKit's `cancel()` there only drops the click, it does not prompt.
 * A tracked form's own submit never asks (its redirect passes); a successful
 * answer (`success` / `redirect`) takes a new snapshot, a failed one keeps
 * the guard. Only the navigation that answer starts passes: leaving while a
 * save is still on its way asks as usual. `submit` without `track` (the
 * syllabus delete form) only lets its own redirect pass.
 *
 * Deliberate limits: a form's own in-page Cancel (a syllabus section's)
 * discards without asking; values the browser restores or autofills before
 * the first touch become the baseline.
 */

/** What a form would post, as a comparable string: files by name and size. */
export function formSignature(data: FormData): string {
	const entries: [string, string | [string, number]][] = [];
	for (const [name, value] of data.entries()) {
		entries.push([name, typeof value === 'string' ? value : [value.name, value.size]]);
	}
	return JSON.stringify(entries);
}

/** Whether `form`'s current values differ from `snapshot` (null: never touched). */
export function isChanged(snapshot: string | null, current: FormData): boolean {
	return snapshot !== null && formSignature(current) !== snapshot;
}

export function createUnsavedGuard(confirm: Confirm) {
	/** Tracked forms and their snapshot (null until first touched). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read on demand, never rendered.
	const forms = new Map<HTMLFormElement, string | null>();
	/** Forms applying their answer: the navigation that answer starts passes. */
	let applying = 0;
	let bypass = false;

	function snapshot(form: HTMLFormElement) {
		forms.set(form, formSignature(new FormData(form)));
	}

	function changed(): boolean {
		for (const [form, saved] of forms) {
			if (form.isConnected && isChanged(saved, new FormData(form))) return true;
		}
		return false;
	}

	beforeNavigate((navigation) => {
		if (bypass || applying > 0 || !changed()) return;
		const { type, to, from, delta, willUnload } = navigation;
		// Reload, closing the tab: the browser asks.
		if (type === 'leave' || !to) {
			navigation.cancel();
			return;
		}
		// The same page (a hash link): nothing is lost.
		if (from && to.url.pathname === from.url.pathname && to.url.search === from.url.search) {
			return;
		}
		navigation.cancel();
		const url = to.url;
		void confirm
			.ask(m.unsaved_leave_confirm(), m.unsaved_leave_okay(), { destructive: true })
			.then(async (leave) => {
				if (!leave) return;
				bypass = true;
				if (willUnload) {
					window.location.assign(url.href);
				} else if (type === 'popstate' && delta) {
					history.go(delta);
				} else {
					// A failed navigation leaves the page here; ask again next time.
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- the address SvelteKit was already going to.
					await goto(url).catch(() => {});
					bypass = false;
				}
			});
	});

	afterNavigate(() => {
		bypass = false;
	});

	/** `use:unsaved.track` on a guarded form. */
	const track: Action<HTMLFormElement> = (form) => {
		forms.set(form, null);
		const first = () => {
			if (forms.get(form) === null) snapshot(form);
		};
		const events = ['focusin', 'pointerdown', 'dragenter'] as const;
		for (const event of events) form.addEventListener(event, first, { capture: true });
		return {
			destroy() {
				for (const event of events) form.removeEventListener(event, first, { capture: true });
				forms.delete(form);
			}
		};
	};

	/**
	 * Wraps a form's submit function: the navigation its answer starts (a
	 * redirect) passes, and a tracked form takes a new snapshot after a
	 * successful answer. Counted only while the answer is applied, so a
	 * cancelled submit (SvelteKit drops the callback) or a throw leaves nothing.
	 */
	function submit(inner: SubmitFunction): SubmitFunction {
		return async (input) => {
			const after = await inner(input);
			return async (opts) => {
				applying += 1;
				try {
					if (after) await after(opts);
					else await opts.update();
					if (opts.result.type === 'success' || opts.result.type === 'redirect') {
						await tick();
						if (forms.has(opts.formElement)) snapshot(opts.formElement);
					}
				} finally {
					applying -= 1;
				}
			};
		};
	}

	return { track, submit };
}

export type UnsavedGuard = ReturnType<typeof createUnsavedGuard>;
