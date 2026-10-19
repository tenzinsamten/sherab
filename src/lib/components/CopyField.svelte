<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { copyText } from '$lib/clipboard';

	/**
	 * One labelled value (username, PIN, password, class code) with a copy
	 * button (#41, #53). `hideLabel` keeps the label for screen readers only,
	 * e.g. inside a table whose column header already names the value.
	 * Its own `data-ui="new"` root (mobile-first story 4), so it also works on
	 * pages that are still iX (admin classes, requests, credentials). Where
	 * several stack (CredentialFields' `.credential-fields`), the labels line
	 * up. `copy-field` / `credential` stay as the hooks tests find them by.
	 */
	let {
		label,
		value,
		hideLabel = false
	}: { label: string; value: string; hideLabel?: boolean } = $props();

	let valueEl: HTMLElement | undefined = $state();
</script>

<div data-ui="new" class="copy-field flex min-w-0 flex-wrap items-center gap-x-2">
	<span class={hideLabel ? 'sr-only' : 'text-muted-foreground in-[.credential-fields]:min-w-36'}
		>{label}</span
	>
	<span class="credential min-w-0 font-mono font-bold wrap-anywhere select-all" bind:this={valueEl}
		>{value}</span
	>
	<Button
		variant="ghost"
		size="icon"
		class="size-11 text-primary"
		aria-label={m.copy_label({ label })}
		title={m.copy_label({ label })}
		onclick={() => copyText(value, valueEl)}
	>
		<Copy class="size-5" aria-hidden="true" />
	</Button>
</div>
