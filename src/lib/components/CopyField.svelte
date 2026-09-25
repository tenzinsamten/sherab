<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { copyText } from '$lib/clipboard';

	/** One labelled one-time value (username, PIN, password) with a copy button (#41). */
	let { label, value }: { label: string; value: string } = $props();

	let valueEl: HTMLElement | undefined = $state();
</script>

<div class="copy-field">
	<span class="copy-label">{label}</span>
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
		min-width: 9rem;
		color: var(--theme-color-soft-text);
	}
</style>
