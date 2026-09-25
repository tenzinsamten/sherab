<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	/** Previous / Page n of m / Next. `hrefFor` returns an already resolve()d href. */
	let {
		page,
		pageCount,
		hrefFor
	}: { page: number; pageCount: number; hrefFor: (page: number) => string } = $props();
</script>

{#if pageCount > 1}
	<nav class="pager" aria-label={m.homework_pager_status({ page, total: pageCount })}>
		<ix-button
			variant="secondary"
			disabled={page <= 1 || undefined}
			href={page > 1 ? hrefFor(page - 1) : undefined}
		>
			{m.homework_pager_prev()}
		</ix-button>
		<span class="muted">{m.homework_pager_status({ page, total: pageCount })}</span>
		<ix-button
			variant="secondary"
			disabled={page >= pageCount || undefined}
			href={page < pageCount ? hrefFor(page + 1) : undefined}
		>
			{m.homework_pager_next()}
		</ix-button>
	</nav>
{/if}

<style>
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
</style>
