/**
 * Side nav expand state (#36). The side nav (shown from 80em only) starts
 * expanded; a collapse is remembered in this cookie, read server-side by the
 * root layout so the first render is already right.
 */
export const MENU_COOKIE = 'sherab-menu';
export const MENU_COLLAPSED = 'collapsed';

/**
 * Remembers the person's expand / collapse choice. Only the side nav calls
 * this, and it exists only on wide screens, so a phone or tablet never
 * overwrites the desktop preference.
 */
export function rememberMenuExpanded(expanded: boolean) {
	document.cookie = expanded
		? `${MENU_COOKIE}=; path=/; max-age=0; SameSite=Lax`
		: `${MENU_COOKIE}=${MENU_COLLAPSED}; path=/; max-age=31536000; SameSite=Lax`;
}
