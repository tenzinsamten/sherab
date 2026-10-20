<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { copyText } from '$lib/clipboard';
	import { ui } from '$lib/ui/classes';
	import CopyField from './CopyField.svelte';

	/**
	 * One-time sign-in details (#41): each value copies on its own, and
	 * "Copy both" copies them together as "Label: value" lines.
	 * Its own `data-ui="new"` root (mobile-first story 5), so it also works
	 * on the pages that are still iX (admin teachers, EnrollmentPanel).
	 * `credential-fields` lines up CopyField's labels.
	 */
	let { fields }: { fields: { label: string; value: string }[] } = $props();

	let block: HTMLElement | undefined = $state();
	let all = $derived(fields.map((f) => `${f.label}: ${f.value}`).join('\n'));
</script>

<div data-ui="new" class="credential-fields mt-2 flex min-w-0 flex-col gap-2" bind:this={block}>
	{#each fields as field (field.label)}
		<CopyField label={field.label} value={field.value} />
	{/each}
	<div>
		<Button variant="outline" class={ui.touch} onclick={() => copyText(all, block)}>
			<Copy aria-hidden="true" />
			{m.copy_all()}
		</Button>
	</div>
</div>
