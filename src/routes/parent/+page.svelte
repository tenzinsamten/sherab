<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Info from '@lucide/svelte/icons/info';
	import Mail from '@lucide/svelte/icons/mail';
	import Users from '@lucide/svelte/icons/users';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { num } from '$lib/format';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * The parent dashboard: one card per linked child (mobile-first story 3:
	 * stacked on a phone, two columns on a tablet). A child still waiting for
	 * approval is a plain card, not a link.
	 */
	let { data }: PageProps = $props();

	const childCard = `${ui.card} flex h-full flex-col gap-3`;

	// Set once the page is interactive (tests wait for it before tapping).
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.parent_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.parent_kicker()}</p>
			<h1 class={ui.heading}>{m.parent_heading()}</h1>
		</div>
		{#if data.state === 'pending'}
			<Badge variant="warning">{m.parent_status_pending()}</Badge>
		{/if}
	</header>

	{#if data.state === 'unconfirmed'}
		<section class={ui.card}>
			<EmptyState
				header={m.parent_unconfirmed_heading()}
				subHeader={m.parent_unconfirmed_body({ email: data.email })}
				icon={Mail}
			/>
		</section>
	{:else if data.state === 'pending'}
		<section class={ui.card}>
			<EmptyState
				header={m.parent_pending_heading()}
				subHeader={m.parent_pending_body()}
				icon={Hourglass}
			/>
		</section>
	{:else if data.state === 'rejected'}
		<section class={ui.card}>
			<EmptyState
				header={m.parent_rejected_heading()}
				subHeader={m.parent_rejected_body()}
				icon={Info}
			/>
		</section>
	{:else if data.loadError}
		<section class={ui.card}>
			<EmptyState header={m.load_error_generic()} icon={Info} />
		</section>
	{:else if data.children.length === 0}
		<section class={ui.card}>
			<EmptyState header={m.parent_empty_heading()} subHeader={m.parent_empty_body()} icon={Users}>
				<!-- #126: the next step: the parents' guide explains joining. -->
				<Button href="{resolve('/help')}?role=parent" variant="outline"
					>{m.home_join_heading()}</Button
				>
			</EmptyState>
		</section>
	{:else}
		<ul class="grid gap-4 md:grid-cols-2" aria-label={m.parent_children_label()}>
			{#each data.children as child (child.id)}
				<li class="min-w-0">
					{#if child.status === 'pending'}
						<div class={childCard} data-testid="child-card">
							<p class="text-lg font-bold wrap-break-word">{child.name}</p>
							<Badge variant="warning">{m.parent_child_waiting()}</Badge>
						</div>
					{:else}
						<!-- #56: the whole card opens the child's page. -->
						<a
							href={resolve('/parent/children/[id]', { id: child.id })}
							class="{ui.tileLink} group"
							data-tour="parent-child-card"
							data-testid="child-card"
						>
							<div class="{childCard} transition-colors group-hover:bg-muted/50">
								<p
									class="flex items-center justify-between gap-2 text-lg font-bold"
									data-tour="parent-child-name"
								>
									<span class="min-w-0 wrap-break-word">{child.name}</span>
									<ChevronRight class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
								</p>
								<p class="flex flex-col gap-1">
									<span class={ui.label}>{m.parent_card_classes()}</span>
									<span class={ui.muted}>
										{child.classes.length > 0
											? child.classes.join(', ')
											: m.parent_card_no_classes()}
									</span>
								</p>
								<dl class="flex flex-wrap gap-x-8 gap-y-2">
									<div>
										<dt class={ui.label}>{m.parent_card_open()}</dt>
										<dd class="{ui.stat} {child.open === 0 ? ui.muted : ''}">
											{num(child.open)}
										</dd>
									</div>
									<div>
										<dt class={ui.label}>{m.parent_card_overdue()}</dt>
										<dd class="flex min-h-9 items-center">
											{#if child.overdue > 0}
												<Badge variant="alarm" class="text-base">{num(child.overdue)}</Badge>
											{:else}
												<span class="{ui.stat} {ui.muted}">{num(0)}</span>
											{/if}
										</dd>
									</div>
								</dl>
							</div>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
