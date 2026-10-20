<script lang="ts" module>
	import { ui } from '$lib/ui/classes';

	/** Shared classes of the auth pages' fields and actions (story 6). */
	export const auth = {
		form: 'flex min-w-0 flex-col gap-4',
		field: 'flex min-w-0 flex-col gap-1.5',
		label: 'text-sm font-medium',
		/** The card's one full-width action. */
		submit: `${ui.touch} mt-2 w-full gap-2`,
		/** A footer link: a ≥44px target (CAP-3). */
		link: `${ui.link} inline-flex min-h-11 items-center px-2 text-center`
	} as const;
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import logo from '$lib/assets/sherab-logo-blue.svg';

	/**
	 * One centred card for the signed-out pages (sign in, register, password,
	 * email confirmation, the signed-out home). Mobile-first story 6: the
	 * page's own `data-ui="new"` root, marked `data-hydrated` once mounted.
	 */
	let {
		title,
		subtitle,
		children,
		footer
	}: { title: string; subtitle?: string; children: Snippet; footer?: Snippet } = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<div
	data-ui="new"
	data-auth-card
	data-hydrated={hydrated || undefined}
	class="flex min-w-0 justify-center px-4 py-8 md:py-12"
>
	<div
		class="w-full max-w-md min-w-0 rounded-lg border border-border bg-card px-5 py-8 text-card-foreground shadow-sm sm:px-8"
	>
		<header class="mb-6 text-center">
			<img
				src={logo}
				alt={m.nav_logo_alt()}
				width="180"
				height="100"
				class="mx-auto mb-3 block h-auto w-45 max-w-full"
			/>
			<h1 class="text-2xl leading-tight font-bold wrap-break-word">{title}</h1>
			{#if subtitle}<p class="mt-2 {ui.muted}">{subtitle}</p>{/if}
		</header>
		{@render children()}
		{#if footer}
			<div class="mt-4 flex flex-col items-center">{@render footer()}</div>
		{/if}
	</div>
</div>
