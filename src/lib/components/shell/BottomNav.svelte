<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { isActive, type NavEntry, type TabEntry } from '$lib/nav';
	import * as m from '$lib/paraglide/messages.js';
	import CountPill from './CountPill.svelte';
	import CountText from './CountText.svelte';
	import { navIcons } from './icons';

	/**
	 * The phone and tablet navigation (below 80em, CAP-1): a tab bar at the
	 * bottom of the screen, clear of the home indicator. It sits at the end
	 * of the page flow and sticks to the bottom, so it never covers the end
	 * of the page. Labels wrap (at most two lines) instead of being cut.
	 */
	let {
		items,
		pathname,
		onHelp
	}: {
		items: TabEntry[];
		pathname: string;
		onHelp: () => void;
	} = $props();

	let moreOpen = $state(false);

	// The bar's height (labels may take two lines; the safe area), for the
	// page's scroll-padding (src/app.css): focus and scroll targets stop
	// above the bar.
	let barHeight = $state(0);
	$effect(() => {
		if (!barHeight) return;
		const root = document.documentElement;
		root.style.setProperty('--bottom-nav-height', `${barHeight}px`);
		return () => root.style.removeProperty('--bottom-nav-height');
	});

	// A page change (a link, back/forward, goto) closes the More sheet.
	$effect(() => {
		void pathname;
		moreOpen = false;
	});

	const tabClass =
		'flex h-full min-h-14 w-full flex-col items-center justify-start gap-0.5 rounded-md px-0.5 pt-1.5 pb-1 text-center text-[0.6875rem] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:font-semibold aria-[current=page]:text-primary';
	const labelClass = 'w-full hyphens-auto wrap-break-word';
	const sheetItemClass =
		'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-primary';

	function help() {
		moreOpen = false;
		onHelp();
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is resolve()d by the caller (src/lib/nav.ts, the layout). -->

{#snippet icon(item: TabEntry)}
	{@const Icon = navIcons[item.icon]}
	<span class="relative">
		<Icon class="size-6" aria-hidden={true} />
		{#if item.kind === 'link' && item.count}
			<CountPill count={item.count} class="absolute -top-1.5 left-4 min-w-4 px-1 text-[0.625rem]" />
		{/if}
	</span>
{/snippet}

{#snippet sheetEntry(item: NavEntry)}
	{@const Icon = navIcons[item.icon]}
	<li>
		{#if item.kind === 'link'}
			<a
				href={item.href}
				class={sheetItemClass}
				aria-current={isActive(item, pathname) ? 'page' : undefined}
				data-count={item.count}
				onclick={() => (moreOpen = false)}
			>
				<Icon class="size-5 shrink-0" aria-hidden={true} />
				<span class="min-w-0 flex-1 break-words">{item.label}</span>
				{#if item.count}<CountText count={item.count} /><CountPill count={item.count} />{/if}
			</a>
		{:else}
			<button type="button" class={sheetItemClass} onclick={help}>
				<Icon class="size-5 shrink-0" aria-hidden={true} />
				<span class="min-w-0 flex-1 break-words">{item.label}</span>
			</button>
		{/if}
	</li>
{/snippet}

<nav
	data-ui="new"
	data-testid="bottom-nav"
	data-shell-bottom-nav
	bind:offsetHeight={barHeight}
	aria-label={m.nav_main_label()}
	class="sticky bottom-0 z-40 border-t border-border bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] xl:hidden"
>
	<ul class="mx-auto flex max-w-2xl items-stretch">
		{#each items as item (item.id)}
			{@const active = isActive(item, pathname)}
			<li class="min-w-0 flex-1 basis-0">
				{#if item.kind === 'link'}
					<a
						href={item.href}
						class={tabClass}
						aria-current={active ? 'page' : undefined}
						data-count={item.count}
					>
						{@render icon(item)}
						<span class={labelClass} data-nav-label>{item.label}</span>
						{#if item.count}<CountText count={item.count} />{/if}
					</a>
				{:else if item.kind === 'help'}
					<button type="button" class={tabClass} onclick={onHelp}>
						{@render icon(item)}
						<span class={labelClass} data-nav-label>{item.label}</span>
					</button>
				{:else}
					<button
						type="button"
						class={tabClass}
						aria-haspopup="dialog"
						aria-expanded={moreOpen}
						aria-current={active ? 'page' : undefined}
						onclick={() => (moreOpen = true)}
					>
						{@render icon(item)}
						<span class={labelClass} data-nav-label>{item.label}</span>
					</button>
				{/if}
			</li>
		{/each}
	</ul>
</nav>

{#each items as item (item.id)}
	{#if item.kind === 'more'}
		<Sheet.Root bind:open={moreOpen}>
			<Sheet.Content
				side="bottom"
				closeLabel={m.common_close()}
				class="max-h-[85dvh] gap-2 rounded-t-lg px-3 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
				data-testid="more-sheet"
			>
				<Sheet.Header class="p-0 pr-12 pl-3">
					<Sheet.Title class="text-base font-semibold">{m.nav_more_label()}</Sheet.Title>
				</Sheet.Header>
				<ul class="flex flex-col gap-1 overflow-y-auto">
					{#each item.items as entry (entry.id)}
						{@render sheetEntry(entry)}
					{/each}
				</ul>
			</Sheet.Content>
		</Sheet.Root>
	{/if}
{/each}
