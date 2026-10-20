import { goto } from '$app/navigation';
import type { ToastType } from '@siemens/ix';
import * as m from '$lib/paraglide/messages.js';

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
			iconArrowDown: icons.iconArrowDown,
			iconArrowUp: icons.iconArrowUp,
			iconBook: icons.iconBook,
			iconCalendar: icons.iconCalendar,
			iconCancel: icons.iconCancel,
			iconChevronLeft: icons.iconChevronLeft,
			iconChevronRight: icons.iconChevronRight,
			iconCopy: icons.iconCopy,
			iconDashboard: icons.iconDashboard,
			iconEye: icons.iconEye,
			iconEyeCancelled: icons.iconEyeCancelled,
			iconGlobe: icons.iconGlobe,
			iconHome: icons.iconHome,
			iconHourglass: icons.iconHourglass,
			iconInfo: icons.iconInfo,
			iconKey: icons.iconKey,
			iconLink: icons.iconLink,
			iconList: icons.iconList,
			iconListSorted: icons.iconListSorted,
			iconLogIn: icons.iconLogIn,
			iconLogOut: icons.iconLogOut,
			iconMail: icons.iconMail,
			iconPen: icons.iconPen,
			iconTasksOpen: icons.iconTasksOpen,
			iconTextBold: icons.iconTextBold,
			iconTextItalic: icons.iconTextItalic,
			iconTextUnderline: icons.iconTextUnderline,
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
 * #91: confirmAction with the usual title and Cancel, for `pending.submit`'s
 * `confirm` option. `okay` repeats the label of the button that was pressed.
 */
export function confirmWith(message: string, okay: string) {
	return () => confirmAction(m.common_confirm_title(), message, okay, m.common_cancel());
}

/** App-wide feedback: every action error and short confirmation is an iX toast. */
export async function showToast(type: ToastType, message: string) {
	const ix = await setupIx();
	await ix.toast({ type, message });
}

/**
 * Client-side navigation for links rendered by iX (#40).
 *
 * `<ix-button href>` renders an `<a target="_self">` in its shadow DOM.
 * SvelteKit treats any link with a `target` as external and lets the
 * browser do a full page load, so every such click reloaded the app and iX
 * re-drew from scratch (the flicker). This catches those clicks
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
