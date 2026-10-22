<script lang="ts">
	import { onMount } from 'svelte';
	import { num } from '$lib/format';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * The admin dashboard, mobile-first story 9: six stat tiles, two columns
	 * on a phone and three from a tablet up; three of them link on.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let tiles = $derived([
		{
			label: m.dashboard_tile_classes(),
			value: data.classesCount,
			text: num(data.classesCount),
			href: resolve('/admin/classes')
		},
		{
			label: m.dashboard_tile_teachers(),
			value: data.teachersCount,
			text: num(data.teachersCount),
			href: resolve('/admin/teachers')
		},
		{
			label: m.dashboard_tile_pending_requests(),
			value: data.pendingRequestsCount,
			text: num(data.pendingRequestsCount),
			href: resolve('/requests')
		},
		// No destination screen exists for these yet (Boundaries: "Do not build a per-class breakdown table").
		{
			label: m.dashboard_tile_students(),
			value: data.studentsCount,
			text: num(data.studentsCount)
		},
		{
			label: m.dashboard_tile_homework_assignments(),
			value: data.homeworkAssignmentsCount,
			text: num(data.homeworkAssignmentsCount)
		},
		{
			label: m.dashboard_tile_completion(),
			value: data.homeworkCompletionPercent,
			text: m.dashboard_tile_completion_value({ percent: num(data.homeworkCompletionPercent) })
		}
	] as { label: string; value: number; text: string; href?: string }[]);

	const tile = `${ui.card} flex h-full flex-col gap-1`;
</script>

<svelte:head>
	<title>{m.dashboard_heading()} — Sherab Admin</title>
</svelte:head>

{#snippet tileBody(t: { label: string; value: number; text: string })}
	<p class="{ui.label} wrap-break-word">{t.label}</p>
	<!-- Muted-not-hidden zero convention (Boundaries, decided 2026-09-17): a
	     zero-value tile keeps the exact same tile/label, only the number's
	     colour changes -- never a separate empty-state layout. -->
	<p class="{ui.stat} wrap-break-word {t.value === 0 ? ui.muted : ''}" data-testid="tile-value">
		{t.text}
	</p>
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.dashboard_section_label()}</p>
			<h1 class={ui.heading}>{m.dashboard_heading()}</h1>
		</div>
	</header>

	<ul class="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4" data-testid="dashboard-tiles">
		{#each tiles as t (t.label)}
			<li class="min-w-0">
				{#if t.href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- t.href is already resolve()d in the tiles array above. -->
					<a href={t.href} class="{ui.tileLink} group min-w-0">
						<div class="{tile} transition-colors group-hover:bg-muted">
							{@render tileBody(t)}
						</div>
					</a>
				{:else}
					<div class={tile}>{@render tileBody(t)}</div>
				{/if}
			</li>
		{/each}
	</ul>
</div>
