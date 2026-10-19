<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { PORTAL_TARGET } from '$lib/components/shell/portal.js';

	// Sherab: popups go to the shell's portal root, which carries the scoped reset.
	let { to = PORTAL_TARGET, ...restProps }: SheetPrimitive.PortalProps = $props();
</script>

<SheetPrimitive.Portal {to} {...restProps} />
