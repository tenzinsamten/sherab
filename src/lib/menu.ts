/**
 * Side menu expand state (#36). The menu starts expanded on wide screens; a
 * collapse there is remembered in this cookie (read server-side by the root
 * layout, so the first render is already right).
 */
export const MENU_COOKIE = 'sherab-menu';
export const MENU_COLLAPSED = 'collapsed';

/** iX's `lg` breakpoint: the only width where `start-expanded` applies. */
export const WIDE_SCREEN_QUERY = '(min-width: 80.0625em)';

/**
 * Svelte action for <ix-menu>: remembers the person's expand / collapse
 * choice. Only choices made on a wide screen count; below `lg` iX opens the
 * menu as an overlay and closes it again on its own, which must not overwrite
 * the desktop preference.
 */
export function rememberMenuExpand(node: HTMLElement) {
	function onExpandChange(event: Event) {
		if (!window.matchMedia(WIDE_SCREEN_QUERY).matches) return;
		const expanded = (event as CustomEvent<boolean>).detail;
		document.cookie = expanded
			? `${MENU_COOKIE}=; path=/; max-age=0; SameSite=Lax`
			: `${MENU_COOKIE}=${MENU_COLLAPSED}; path=/; max-age=31536000; SameSite=Lax`;
	}

	node.addEventListener('expandChange', onExpandChange);
	return {
		destroy() {
			node.removeEventListener('expandChange', onExpandChange);
		}
	};
}
