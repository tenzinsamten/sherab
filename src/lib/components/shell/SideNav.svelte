<script lang="ts">
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import { isActive, type NavEntry } from '$lib/nav';
	import { rememberMenuExpanded } from '$lib/menu';
	import * as m from '$lib/paraglide/messages.js';
	import CountPill from './CountPill.svelte';
	import CountText from './CountText.svelte';
	import { navIcons } from './icons';

	/**
	 * The desktop navigation (from 80em; below it the bottom bar takes over).
	 * Collapsible to icons only; the choice is remembered in a cookie (#36).
	 */
	let {
		items,
		pathname,
		initialExpanded,
		onHelp
	}: {
		items: NavEntry[];
		pathname: string;
		/** From the layout load (the cookie), so the first render is right. */
		initialExpanded: boolean;
		onHelp: () => void;
	} = $props();

	// Follows the cookie until the person toggles it here.
	let expanded = $derived(initialExpanded);

	function toggle() {
		expanded = !expanded;
		rememberMenuExpanded(expanded);
	}

	const itemClass =
		'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring aria-[current=page]:bg-sidebar-primary aria-[current=page]:text-sidebar-primary-foreground';
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is resolve()d by the caller (src/lib/nav.ts, the layout). -->

<nav
	data-ui="new"
	data-testid="side-nav"
	data-expanded={expanded}
	aria-label={m.nav_main_label()}
	class="sticky top-[calc(3.5rem+env(safe-area-inset-top))] hidden h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] shrink-0 flex-col border-t border-sidebar-border bg-sidebar pl-[env(safe-area-inset-left)] text-sidebar-foreground xl:flex {expanded
		? 'w-64'
		: 'w-16'}"
>
	<ul class="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
		{#each items as item (item.id)}
			{@const Icon = navIcons[item.icon]}
			<li>
				{#if item.kind === 'link'}
					<a
						href={item.href}
						class={itemClass}
						aria-current={isActive(item, pathname) ? 'page' : undefined}
						data-count={item.count}
						title={expanded ? undefined : item.label}
					>
						<span class="relative shrink-0">
							<Icon class="size-5" aria-hidden={true} />
							{#if item.count && !expanded}
								<CountPill
									count={item.count}
									class="absolute -top-2 -right-2.5 min-w-4 bg-sidebar-foreground px-1 text-[0.625rem] text-sidebar"
								/>
							{/if}
						</span>
						<span class={expanded ? 'min-w-0 flex-1 break-words' : 'sr-only'}>{item.label}</span>
						{#if item.count}<CountText count={item.count} />{/if}
						{#if item.count && expanded}
							<CountPill count={item.count} class="ml-auto bg-sidebar-foreground text-sidebar" />
						{/if}
					</a>
				{:else}
					<button
						type="button"
						class={itemClass}
						title={expanded ? undefined : item.label}
						onclick={onHelp}
					>
						<Icon class="size-5 shrink-0" aria-hidden={true} />
						<span class={expanded ? 'min-w-0 flex-1 break-words' : 'sr-only'}>{item.label}</span>
					</button>
				{/if}
			</li>
		{/each}
	</ul>
	<div class="border-t border-sidebar-border p-2">
		<button
			type="button"
			class={itemClass}
			aria-label={expanded ? m.nav_collapse() : m.nav_expand()}
			title={expanded ? undefined : m.nav_expand()}
			onclick={toggle}
			data-testid="side-nav-toggle"
		>
			{#if expanded}
				<PanelLeftClose class="size-5 shrink-0" aria-hidden={true} />
				<span class="min-w-0 flex-1 break-words">{m.nav_collapse()}</span>
			{:else}
				<PanelLeftOpen class="size-5 shrink-0" aria-hidden={true} />
			{/if}
		</button>
	</div>
</nav>
