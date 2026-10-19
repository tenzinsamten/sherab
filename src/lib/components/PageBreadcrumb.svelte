<script lang="ts">
	import { onMount } from 'svelte';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * The breadcrumb above a nested page's header (#61), on the new component
	 * system (mobile-first story 3); it carries its own `data-ui="new"` root,
	 * so it works on pages that are still iX. Every level above the current
	 * page is a real link; the last item is the current page
	 * (aria-current="page"). On a phone (below 40rem) only the last two
	 * levels show and the earlier ones move into a "…" menu; a level without
	 * a link (the admin class name) is left out there, as it would lead
	 * nowhere. Long labels end with an ellipsis instead of pushing the page
	 * sideways; a link never gets narrower than 44px.
	 */
	type Crumb = { label: string; href?: string };
	let { items }: { items: Crumb[] } = $props();

	const last = $derived(items.length - 1);

	// The phone trail: link-less levels dropped (the current page stays).
	const phone = $derived(
		items
			.map((item, index) => ({ item, index }))
			.filter(({ item, index }) => item.href || index === last)
	);
	// Shown on a phone: the last two of those; the rest are in the "…" menu.
	const phoneVisible = $derived(new Set(phone.slice(-2).map(({ index }) => index)));
	const collapsed = $derived(phone.slice(0, -2));

	// Vertical padding inside the clipped box keeps Tibetan letters' feet (#86).
	// Set once the trail is interactive (tests wait for it before opening "…").
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	const crumbText = 'block max-w-full truncate py-1';
	const linkClass =
		'inline-flex min-h-11 max-w-full min-w-11 items-center rounded-md px-1 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring';
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- crumb hrefs are built with resolve() by the pages. -->
<Breadcrumb.Root
	data-ui="new"
	data-testid="page-breadcrumb"
	data-hydrated={hydrated || undefined}
	aria-label={m.breadcrumb_label()}
	class="mb-2 max-w-full min-w-0"
>
	<Breadcrumb.List class="flex-nowrap gap-0.5 text-sm text-muted-foreground">
		{#if collapsed.length > 0}
			<Breadcrumb.Item class="shrink-0 sm:hidden" data-crumb-menu>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
						aria-label={m.breadcrumb_show_previous()}
						data-testid="breadcrumb-more"
					>
						<Ellipsis class="size-5" aria-hidden="true" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-auto max-w-[calc(100vw-2rem)] min-w-48">
						{#each collapsed as { item, index } (index)}
							<DropdownMenu.Item class="min-h-11 p-0">
								{#snippet child({ props })}
									<a {...props} href={item.href} class="{props.class} px-3 text-base">
										<span class="truncate">{item.label}</span>
									</a>
								{/snippet}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Breadcrumb.Item>
			<Breadcrumb.Separator class="shrink-0 sm:hidden" />
		{/if}
		{#each items as item, index (`${index}|${item.href ?? ''}|${item.label}`)}
			{@const hiddenOnPhone = !phoneVisible.has(index)}
			<Breadcrumb.Item
				class="{item.href && index !== last ? 'min-w-11' : 'min-w-0'} {index === last
					? 'shrink'
					: 'shrink-[2]'} {hiddenOnPhone ? 'hidden sm:inline-flex' : ''}"
			>
				{#if index === last}
					<span aria-current="page" class="{crumbText} px-1 font-medium text-foreground">
						{item.label}
					</span>
				{:else if item.href}
					<Breadcrumb.Link href={item.href} class={linkClass}>
						<span class={crumbText}>{item.label}</span>
					</Breadcrumb.Link>
				{:else}
					<span class="{crumbText} px-1">{item.label}</span>
				{/if}
			</Breadcrumb.Item>
			{#if index < last}
				<Breadcrumb.Separator class="shrink-0 {hiddenOnPhone ? 'hidden sm:block' : ''}" />
			{/if}
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
