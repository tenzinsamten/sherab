<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	let { ...restProps }: SonnerProps = $props();
</script>

<!-- Sherab (story 10): light only (no mode-watcher; the app is light-only),
     plain toasts in the theme's popover colours and radius. Mounted inside a
     `data-ui="new"` root, whose reset (reset.css, id weight) zeroes the
     toast's padding, border and the close button's look; the `!important`
     utilities below put them back. A toast's border and the close button
     take the colours Sonner sets per type (`richColors`); the font and the
     title's line height follow the root, so Tibetan gets Atisha and its
     taller line (the size is `text-[0.875rem]`, not `text-sm`, which would
     also set a line height). The close button looks 20px but takes taps on a centred
     44px pseudo-element (CAP-3). -->
<Sonner
	theme="light"
	class="toaster group [font-family:inherit]"
	style="--normal-bg: var(--popover); --normal-text: var(--popover-foreground); --normal-border: var(--border); --border-radius: var(--radius);"
	toastOptions={{
		classes: {
			toast: 'cn-toast p-4 border text-[0.875rem]',
			success: 'border-(--success-border)',
			error: 'border-(--error-border)',
			info: 'border-(--info-border)',
			warning: 'border-(--warning-border)',
			title: '[line-height:inherit]',
			closeButton:
				'rounded-full border border-inherit bg-inherit after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2'
		}
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<Loader2Icon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
