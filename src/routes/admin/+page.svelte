<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Muted-not-hidden zero convention (Boundaries, decided 2026-09-17): a
	 *  zero-value tile keeps the exact same tile/label, only the number's
	 *  colour changes -- never a separate empty-state layout. */
	function valueClass(value: number) {
		return value === 0 ? 'stat-tile-value muted' : 'stat-tile-value';
	}

	let tiles = $derived([
		{
			label: m.dashboard_tile_classes(),
			value: data.classesCount,
			text: `${data.classesCount}`,
			href: resolve('/admin/classes')
		},
		{
			label: m.dashboard_tile_teachers(),
			value: data.teachersCount,
			text: `${data.teachersCount}`,
			href: resolve('/admin/teachers')
		},
		{
			label: m.dashboard_tile_pending_requests(),
			value: data.pendingRequestsCount,
			text: `${data.pendingRequestsCount}`,
			href: resolve('/requests')
		},
		// No destination screen exists for these yet (Boundaries: "Do not build a per-class breakdown table").
		{
			label: m.dashboard_tile_students(),
			value: data.studentsCount,
			text: `${data.studentsCount}`
		},
		{
			label: m.dashboard_tile_homework_assignments(),
			value: data.homeworkAssignmentsCount,
			text: `${data.homeworkAssignmentsCount}`
		},
		{
			label: m.dashboard_tile_completion(),
			value: data.homeworkCompletionPercent,
			text: m.dashboard_tile_completion_value({ percent: data.homeworkCompletionPercent })
		}
	] as { label: string; value: number; text: string; href?: string }[]);
</script>

<svelte:head>
	<title>{m.dashboard_heading()} — Sherab Admin</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.dashboard_section_label()}</p>
			<h1 class="page-heading">{m.dashboard_heading()}</h1>
		</div>
	</header>

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
</div>
