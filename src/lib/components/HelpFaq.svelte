<script lang="ts">
	import { helpFaq } from '$lib/help';

	/** The shared questions (#87), each closed until opened. */
</script>

<div class="faq">
	{#each helpFaq as entry, i (i)}
		<details>
			<summary>{entry.title()}</summary>
			<p>{entry.body()}</p>
		</details>
	{/each}
</div>

<style>
	details {
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
	}

	details:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	summary {
		font-weight: var(--theme-font-weight-bold);
		cursor: pointer;
	}

	details p {
		margin: var(--space-2) 0 0;
		max-width: 70ch;
	}
</style>
