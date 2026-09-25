<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Same muted-not-hidden zero convention as the admin dashboard. */
	function valueClass(value: number) {
		return value === 0 ? 'stat-tile-value muted' : 'stat-tile-value';
	}

	let pendingRequestsCount = $derived(data.pendingRequestsCount ?? 0);

	let tiles = $derived([
		{
			label: m.dashboard_tile_students(),
			value: data.studentsCount,
			text: `${data.studentsCount}`
		},
		{
			label: m.dashboard_tile_pending_requests(),
			value: pendingRequestsCount,
			text: `${pendingRequestsCount}`,
			href: resolve('/requests')
		},
		{
			label: m.dashboard_tile_due_this_week(),
			value: data.dueThisWeek,
			text: `${data.dueThisWeek}`
		},
		{
			label: m.dashboard_tile_overdue(),
			value: data.overdue,
			text: `${data.overdue}`
		},
		{
			label: m.dashboard_tile_awaiting_review(),
			value: data.awaitingReview,
			text: `${data.awaitingReview}`
		},
		{
			label: m.dashboard_tile_completion(),
			value: data.completionPercent,
			text: m.dashboard_tile_completion_value({ percent: data.completionPercent })
		}
	] as { label: string; value: number; text: string; href?: string }[]);
</script>

<svelte:head>
	<title>{m.dashboard_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.teacher_section_label()}</p>
			<h1 class="page-heading">{m.dashboard_heading()}</h1>
		</div>
	</header>

	{#if data.classes.length === 0}
		<ix-empty-state header={m.teacher_no_classes()} icon="book"></ix-empty-state>
	{:else}
		<div class="tile-grid">
			{#each tiles as tile (tile.label)}
				{#if tile.href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tile.href is already resolve()d in the tiles array above. -->
					<a href={tile.href} class="tile-link">
						<ix-card variant="outline">
							<ix-card-content>
								<p class="section-label">{tile.label}</p>
								<p class={valueClass(tile.value)}>{tile.text}</p>
							</ix-card-content>
						</ix-card>
					</a>
				{:else}
					<ix-card variant="outline" passive>
						<ix-card-content>
							<p class="section-label">{tile.label}</p>
							<p class={valueClass(tile.value)}>{tile.text}</p>
						</ix-card-content>
					</ix-card>
				{/if}
			{/each}
		</div>

		<h2 style="margin: var(--space-6) 0 var(--space-3);">{m.teacher_my_classes_heading()}</h2>
		<div class="tile-grid">
			{#each data.classes as cls (cls.id)}
				<ix-card variant="outline" passive>
					<ix-card-content>
						<h3 style="margin:0;">{cls.name}</h3>
						<p class="muted" style="margin:0;">{m.teacher_class_code_label({ code: cls.code })}</p>
						<ix-button variant="secondary" href={resolve('/teacher/classes/[id]', { id: cls.id })}>
							{m.teacher_view_roster()}
						</ix-button>
					</ix-card-content>
				</ix-card>
			{/each}
		</div>
	{/if}
</div>
