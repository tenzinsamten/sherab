import { goto } from '$app/navigation';
import type { ToastType } from '@siemens/ix';

/**
 * Siemens iX is a set of web components, so everything here is browser-only:
 * the root layout calls setupIx() from onMount, and SSR just emits the
 * un-upgraded <ix-*> tags. Icons are registered individually (addIcons)
 * rather than copying all ~1.5k SVGs into static/.
 */
let ready: Promise<typeof import('@siemens/ix')> | undefined;

export function setupIx() {
	ready ??= (async () => {
		const [ix, ixLoader, iconsLoader, { addIcons }, icons] = await Promise.all([
			import('@siemens/ix'),
			import('@siemens/ix/loader'),
			import('@siemens/ix-icons/loader'),
			import('@siemens/ix-icons'),
			import('@siemens/ix-icons/icons')
		]);
		addIcons({
			iconAdd: icons.iconAdd,
			iconBook: icons.iconBook,
			iconCalendar: icons.iconCalendar,
			iconCancel: icons.iconCancel,
			iconChevronLeft: icons.iconChevronLeft,
			iconChevronRight: icons.iconChevronRight,
			iconCopy: icons.iconCopy,
			iconDashboard: icons.iconDashboard,
			iconGlobe: icons.iconGlobe,
			iconHome: icons.iconHome,
			iconHourglass: icons.iconHourglass,
			iconInfo: icons.iconInfo,
			iconKey: icons.iconKey,
			iconLogIn: icons.iconLogIn,
			iconLogOut: icons.iconLogOut,
			iconMail: icons.iconMail,
			iconPen: icons.iconPen,
			iconTasksOpen: icons.iconTasksOpen,
			iconTrashcan: icons.iconTrashcan,
			iconTrophy: icons.iconTrophy,
			iconUndo: icons.iconUndo,
			iconUser: icons.iconUser,
			iconUserCheck: icons.iconUserCheck,
			iconUserGroup: icons.iconUserGroup,
			iconUserManagement: icons.iconUserManagement,
			iconUserReading: icons.iconUserReading
		});
		await iconsLoader.defineCustomElements();
		await ixLoader.defineCustomElements();
		ix.setToastPosition('top-right');
		return ix;
	})();
	return ready;
}

/**
 * iX warning dialog for destructive actions. Resolves true only when the
 * user picks the okay button (dismissing or cancelling resolves false).
 */
export async function confirmAction(title: string, message: string, okay: string, cancel: string) {
	const ix = await setupIx();
	const result = await ix.showMessage.warning(title, message, okay, cancel);
	return new Promise<boolean>((resolve) => {
		result.once(({ actionId }) => resolve(actionId === 'okay'));
	});
}

/**
 * Svelte action for <ix-application-header>: makes the app name (rendered by
 * iX as plain text in its shadow DOM) behave as a link to `href`. A slotted
 * <a> can't replace it -- the logo slot is hidden below 48em and the other
 * right-hand slots can't be positioned on the left. Above 48em the slotted
 * logo link takes over and the name is hidden.
 */
export function headerHomeLink(node: HTMLElement, href: string) {
	let target = href;
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(
		'.name { cursor: pointer; } .name:focus-visible { outline: 1px solid; }' +
			// iX hides the logo slot at max-width 48em; above that a slotted
			// logo is the home link, so the name text is hidden (the exact
			// complement of iX's query, so one of the two always shows). Only
			// when a logo is slotted -- iX marks an empty slot `.hide-logo`.
			' @media not all and (max-width: 48em) {' +
			' :host .left-side .logo:not(.hide-logo) ~ .name { display: none; } }'
	);

	const isName = (event: Event) =>
		event.composedPath().some((el) => el instanceof HTMLElement && el.classList.contains('name'));
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass an already resolve()d href.
	const go = () => void goto(target);

	const onClick = (event: MouseEvent) => {
		if (isName(event)) go();
	};
	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && isName(event)) go();
	};
	node.addEventListener('click', onClick);
	node.addEventListener('keydown', onKeydown);

	(async () => {
		await customElements.whenDefined('ix-application-header');
		await (
			node as HTMLElement & { componentOnReady?: () => Promise<unknown> }
		).componentOnReady?.();
		const root = node.shadowRoot;
		const name = root?.querySelector<HTMLElement>('.name');
		if (!root || !name) return;
		root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
		name.setAttribute('role', 'link');
		name.setAttribute('tabindex', '0');
	})();

	return {
		update(next: string) {
			target = next;
		},
		destroy() {
			node.removeEventListener('click', onClick);
			node.removeEventListener('keydown', onKeydown);
		}
	};
}

/**
 * Svelte action for a header <ix-avatar>: gives its menu button an accessible
 * name. iX moves a host `aria-label` onto the avatar image only, and drops it
 * entirely when `initials` are shown, so the button would be announced as
 * just the initials.
 */
export function avatarLabel(node: HTMLElement, label: string) {
	let current = label;
	let destroyed = false;

	// Re-queried on every write: iX may re-render its internal button.
	function apply() {
		const button = node.shadowRoot?.querySelector<HTMLElement>('button');
		if (button) button.setAttribute('aria-label', current);
		else node.setAttribute('aria-label', current);
	}

	(async () => {
		await customElements.whenDefined('ix-avatar');
		await (
			node as HTMLElement & { componentOnReady?: () => Promise<unknown> }
		).componentOnReady?.();
		if (!destroyed) apply();
	})();

	return {
		update(next: string) {
			current = next;
			if (!destroyed) apply();
		},
		destroy() {
			destroyed = true;
		}
	};
}

/** App-wide feedback: every action error and short confirmation is an iX toast. */
export async function showToast(type: ToastType, message: string) {
	const ix = await setupIx();
	await ix.toast({ type, message });
}

/**
 * Client-side navigation for links rendered by iX (#40).
 *
 * `<ix-button href>` and `<ix-menu-item href>` render an `<a target="_self">`
 * in their shadow DOM. SvelteKit treats any link with a `target` as external
 * and lets the browser do a full page load, so every menu click reloaded the
 * app and iX re-drew from scratch (the flicker). This catches those clicks
 * first (capture phase) and hands same-origin ones to SvelteKit's router.
 * Returns a cleanup function.
 */
export function routeIxLinks(): () => void {
	const onClick = (event: MouseEvent) => {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		const anchor = event
			.composedPath()
			.find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
		if (!anchor || !anchor.href || anchor.target !== '_self' || anchor.hasAttribute('download')) {
			return;
		}
		// Only anchors iX renders inside its own components.
		const root = anchor.getRootNode();
		if (!(root instanceof ShadowRoot) || !root.host.tagName.startsWith('IX-')) return;

		const url = new URL(anchor.href);
		if (url.origin !== location.origin) return;

		event.preventDefault();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- iX hrefs are built with resolve() by the pages.
		void goto(url.pathname + url.search + url.hash);
	};

	document.addEventListener('click', onClick, { capture: true });
	return () => document.removeEventListener('click', onClick, { capture: true });
}
