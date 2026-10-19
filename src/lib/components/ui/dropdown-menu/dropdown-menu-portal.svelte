<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { PORTAL_TARGET } from '$lib/components/shell/portal.js';

	// Sherab: popups go to the shell's portal root, which carries the scoped reset.
	let { to = PORTAL_TARGET, ...restProps }: DropdownMenuPrimitive.PortalProps = $props();
</script>

<DropdownMenuPrimitive.Portal {to} {...restProps} />
