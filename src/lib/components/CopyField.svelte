<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { copyText } from '$lib/clipboard';

	/**
	 * One labelled value (username, PIN, password, class code) with a copy
	 * button (#41, #53). `hideLabel` keeps the label for screen readers only,
	 * e.g. inside a table whose column header already names the value.
	 */
	let {
		label,
		value,
		hideLabel = false
	}: { label: string; value: string; hideLabel?: boolean } = $props();

	let valueEl: HTMLElement | undefined = $state();
</script>

<div class="copy-field">
	<span class={hideLabel ? 'sr-only' : 'copy-label'}>{label}</span>
	<span class="credential" bind:this={valueEl}>{value}</span>
	<ix-icon-button
		icon="copy"
		variant="tertiary"
		size="24"
		aria-label={m.copy_label({ label })}
		title={m.copy_label({ label })}
		onclick={() => copyText(value, valueEl)}
	></ix-icon-button>
</div>

<style>
	.copy-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.copy-label {
		color: var(--theme-color-soft-text);
	}

	/* Line up the labels only where several fields stack (CredentialFields). */
	:global(.credential-fields) .copy-label {
		min-width: 9rem;
	}
</style>
