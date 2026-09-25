<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { copyText } from '$lib/clipboard';
	import CopyField from './CopyField.svelte';

	/**
	 * One-time sign-in details (#41): each value copies on its own, and
	 * "Copy both" copies them together as "Label: value" lines.
	 */
	let { fields }: { fields: { label: string; value: string }[] } = $props();

	let block: HTMLElement | undefined = $state();
	let all = $derived(fields.map((f) => `${f.label}: ${f.value}`).join('\n'));
</script>

<div class="credential-fields" bind:this={block}>
	{#each fields as field (field.label)}
		<CopyField label={field.label} value={field.value} />
	{/each}
	<div>
		<ix-button variant="secondary" icon="copy" onclick={() => copyText(all, block)}>
			{m.copy_all()}
		</ix-button>
	</div>
</div>

<style>
	.credential-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
</style>
