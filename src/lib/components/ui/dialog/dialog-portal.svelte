<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { PORTAL_TARGET } from '$lib/components/shell/portal.js';

	// Sherab: popups go to the shell's portal root, which carries the scoped reset.
	let { to = PORTAL_TARGET, ...restProps }: DialogPrimitive.PortalProps = $props();
</script>

<DialogPrimitive.Portal {to} {...restProps} />
