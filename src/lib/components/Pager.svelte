<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';

	/**
	 * Previous / Page n of m / Next. `hrefFor` returns an already resolve()d
	 * href. Its own `data-ui="new"` root (mobile-first story 3), so it also
	 * works on pages that are still iX. At either end the button is disabled
	 * (a `<button>`, no link).
	 */
	let {
		page,
		pageCount,
		hrefFor
	}: { page: number; pageCount: number; hrefFor: (page: number) => string } = $props();
</script>

{#if pageCount > 1}
	<nav
		data-ui="new"
		class="mt-4 flex items-center justify-between gap-2 sm:justify-center sm:gap-4"
		aria-label={m.homework_pager_status({ page: num(page), total: num(pageCount) })}
	>
		<Button
			variant="outline"
			class={ui.touch}
			disabled={page <= 1}
			href={page > 1 ? hrefFor(page - 1) : undefined}
		>
			<ChevronLeft aria-hidden="true" />
			{m.homework_pager_prev()}
		</Button>
		<span class="text-center text-sm text-muted-foreground"
			>{m.homework_pager_status({ page: num(page), total: num(pageCount) })}</span
		>
		<Button
			variant="outline"
			class={ui.touch}
			disabled={page >= pageCount}
			href={page < pageCount ? hrefFor(page + 1) : undefined}
		>
			{m.homework_pager_next()}
			<ChevronRight aria-hidden="true" />
		</Button>
	</nav>
{/if}
