/**
 * Where every Bits UI popup of the new component system (dropdowns, sheets)
 * is portalled to: the shell's `<div data-ui="new" id="ui-portal">` at the
 * end of the page (PortalRoot.svelte). Popups get the scoped reset there,
 * whatever page they open on.
 */
export const PORTAL_ID = 'ui-portal';
export const PORTAL_TARGET = `#${PORTAL_ID}`;
