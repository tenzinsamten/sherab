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
			iconDashboard: icons.iconDashboard,
			iconGlobe: icons.iconGlobe,
			iconHome: icons.iconHome,
			iconKey: icons.iconKey,
			iconLogIn: icons.iconLogIn,
			iconLogOut: icons.iconLogOut,
			iconPen: icons.iconPen,
			iconTasksOpen: icons.iconTasksOpen,
			iconTrashcan: icons.iconTrashcan,
			iconTrophy: icons.iconTrophy,
			iconUserCheck: icons.iconUserCheck,
			iconUserGroup: icons.iconUserGroup,
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
 * right-hand slots can't be positioned on the left.
 */
export function headerHomeLink(node: HTMLElement, href: string) {
	let target = href;
	const sheet = new CSSStyleSheet();
	sheet.replaceSync('.name { cursor: pointer; } .name:focus-visible { outline: 1px solid; }');

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

/** App-wide feedback: every action error and short confirmation is an iX toast. */
export async function showToast(type: ToastType, message: string) {
	const ix = await setupIx();
	await ix.toast({ type, message });
}
