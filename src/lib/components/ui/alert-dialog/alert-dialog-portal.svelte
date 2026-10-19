<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';
	import { PORTAL_TARGET } from '$lib/components/shell/portal.js';

	// Sherab: popups go to the shell's portal root, which carries the scoped reset.
	let { to = PORTAL_TARGET, ...restProps }: AlertDialogPrimitive.PortalProps = $props();
</script>

<AlertDialogPrimitive.Portal {to} {...restProps} />
