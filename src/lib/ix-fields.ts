import type { Attachment } from 'svelte/attachments';

/**
 * Helpers for iX form fields (<ix-input>, <ix-select>, <ix-date-input>, ...)
 * used as native form fields (#66). They are form-associated, so `name`,
 * native posts and use:enhance work as with <input>; what they lack is
 * handled here.
 *
 * Use these as {@attach} rather than template attributes: Svelte sets all of
 * a template's attributes in one effect, and re-assigns a custom element's
 * properties each time that effect runs, so an error appearing or a reload
 * of other page data would put the server value back over what the user
 * changed.
 */

type IxField = HTMLElement & {
	value?: unknown;
	componentOnReady?: () => Promise<unknown>;
	getNativeInputElement?: () => Promise<HTMLElement>;
};

async function whenReady(host: IxField) {
	await customElements.whenDefined(host.localName);
	await host.componentOnReady?.();
}

/**
 * A server error shown in a light-DOM element (`errorId`, usually a
 * `.field-error` under the field): iX invalid state (`ix-invalid`) plus
 * aria-invalid and a description. <ix-checkbox>'s host is the checkbox, so
 * it gets `aria-invalid` / `aria-describedby` itself. Other fields have
 * their native control in the shadow DOM: that control gets `aria-invalid`
 * and `ariaDescribedByElements` (an id can't reach across the shadow root),
 * and the role-less host gets no ARIA. Pass `undefined` when there is no
 * error. Cleanup undoes only what this attachment set.
 *
 * The form must be `novalidate`: otherwise iX's own validation runs on
 * value change and blur and sets the control's `aria-describedby`, which
 * replaces the description linked here.
 */
export function ixFieldError(errorId: string | undefined): Attachment<HTMLElement> {
	return (host: IxField) => {
		host.classList.toggle('ix-invalid', Boolean(errorId));
		if (!errorId) return;

		if (host.localName === 'ix-checkbox') {
			host.setAttribute('aria-invalid', 'true');
			host.setAttribute('aria-describedby', errorId);
			return () => {
				host.removeAttribute('aria-invalid');
				host.removeAttribute('aria-describedby');
			};
		}

		let active = true;
		let native: HTMLElement | null = null;
		let setDescription = false;
		(async () => {
			await whenReady(host);
			if (!active || typeof host.getNativeInputElement !== 'function') return;
			const control = await host.getNativeInputElement().catch(() => null);
			if (!active || !control) return;
			native = control;
			native.setAttribute('aria-invalid', 'true');
			const target = document.getElementById(errorId);
			if (target && 'ariaDescribedByElements' in native) {
				native.ariaDescribedByElements = [target];
				setDescription = true;
			}
		})();
		return () => {
			active = false;
			host.classList.remove('ix-invalid');
			if (!native) return;
			native.removeAttribute('aria-invalid');
			if (setDescription) native.ariaDescribedByElements = null;
		};
	};
}

// Last value each host was given per property, so a re-run with the same
// incoming value (e.g. after another form's save reloaded the page data)
// doesn't overwrite what the user has typed since.
const lastIncoming = new WeakMap<HTMLElement, Map<string, unknown>>();

/**
 * Sets an iX field's property (`value` by default, or `checked`), and only
 * when the incoming value differs from the one it was last given, so unsaved
 * edits survive a reload of other page data.
 *
 * It is written twice. First right away, so the component reads it when it
 * loads: as an attribute while iX isn't defined yet (attachments run at
 * hydration, and iX is only defined later, from the root layout's onMount),
 * else as the property. Some fields only take their form
 * value from what they load with (<ix-select> sets it in componentWillLoad
 * and on user picks, not when `value` changes later). Then again once the
 * component has loaded, because some defaults are applied on load:
 * <ix-number-input> falls back to 0 and <ix-time-input> to the current time,
 * which would otherwise be posted. Pass `null` for empty.
 */
export function ixValue(
	value: unknown,
	prop: 'value' | 'checked' = 'value'
): Attachment<HTMLElement> {
	return (host: IxField) => {
		let seen = lastIncoming.get(host);
		if (!seen) lastIncoming.set(host, (seen = new Map()));
		if (seen.has(prop) && Object.is(seen.get(prop), value)) return;
		seen.set(prop, value);

		const record = host as unknown as Record<string, unknown>;
		if (customElements.get(host.localName)) {
			record[prop] = value;
		} else if (prop === 'checked') {
			host.toggleAttribute('checked', Boolean(value));
		} else if (value === null || value === undefined) {
			host.removeAttribute(prop);
		} else {
			host.setAttribute(prop, String(value));
		}

		const incoming = seen;
		(async () => {
			await whenReady(host);
			// A newer value may have come in while iX was loading: that one wins.
			if (Object.is(incoming.get(prop), value)) record[prop] = value;
		})();
	};
}

/**
 * <ix-number-input> value for a duration in minutes: a finite number, or
 * `null` (empty) for null, undefined, '', whitespace or anything non-numeric.
 */
export function durationValue(minutes: number | string | null | undefined): number | null {
	if (minutes === null || minutes === undefined) return null;
	if (typeof minutes === 'string' && minutes.trim() === '') return null;
	const n = Number(minutes);
	return Number.isFinite(n) ? n : null;
}
