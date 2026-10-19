<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { helpFaq } from '$lib/help';

	/**
	 * The shared questions (#87), each closed until opened. Its own
	 * `data-ui="new"` root (mobile-first story 5); each question is a
	 * ≥44px summary.
	 */
</script>

<div data-ui="new" class="min-w-0 divide-y divide-border" data-testid="help-faq">
	{#each helpFaq as entry, i (i)}
		<details class="group">
			<summary
				class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 font-bold wrap-break-word focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
			>
				<span class="min-w-0">{entry.title()}</span>
				<ChevronDown
					class="size-5 flex-none text-muted-foreground transition-transform group-open:rotate-180"
					aria-hidden="true"
				/>
			</summary>
			<p class="max-w-prose pb-3 wrap-break-word">{entry.body()}</p>
		</details>
	{/each}
</div>
