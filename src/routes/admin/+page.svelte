<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Muted-not-hidden zero convention (Boundaries, decided 2026-09-17): a
	 *  zero-value tile keeps the exact same tile/label, only the number's
	 *  color changes -- never a separate empty-state layout. */
	function valueColor(value: number): string {
		return value === 0 ? 'var(--color-muted-foreground)' : 'inherit';
	}
</script>

<svelte:head>
	<title>{m.dashboard_heading()} — Sherab Admin</title>
</svelte:head>

<p class="section-label">{m.dashboard_section_label()}</p>
<h1>{m.dashboard_heading()}</h1>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}

<div
	style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-4); margin-top: var(--space-4);"
>
	<!-- Linked tiles: each has an existing management/review screen to jump into. -->
	<a href={resolve('/admin/classes')} class="card" style="text-decoration:none; color:inherit;">
		<p class="section-label" style="margin:0 0 var(--space-1) 0;">{m.dashboard_tile_classes()}</p>
		<p class="stat-tile-value" style="margin:0; color:{valueColor(data.classesCount)};">
			{data.classesCount}
		</p>
	</a>

	<a href={resolve('/admin/teachers')} class="card" style="text-decoration:none; color:inherit;">
		<p class="section-label" style="margin:0 0 var(--space-1) 0;">{m.dashboard_tile_teachers()}</p>
		<p class="stat-tile-value" style="margin:0; color:{valueColor(data.teachersCount)};">
			{data.teachersCount}
		</p>
	</a>

	<a href={resolve('/requests')} class="card" style="text-decoration:none; color:inherit;">
		<p class="section-label" style="margin:0 0 var(--space-1) 0;">
			{m.dashboard_tile_pending_requests()}
		</p>
		<p class="stat-tile-value" style="margin:0; color:{valueColor(data.pendingRequestsCount)};">
			{data.pendingRequestsCount}
		</p>
	</a>

	<!-- Plain tiles: no destination screen exists for these yet (Boundaries: "Do not build a per-class breakdown table"). -->
	<div class="card">
		<p class="section-label" style="margin:0 0 var(--space-1) 0;">{m.dashboard_tile_students()}</p>
		<p class="stat-tile-value" style="margin:0; color:{valueColor(data.studentsCount)};">
			{data.studentsCount}
		</p>
	</div>

	<div class="card">
		<p class="section-label" style="margin:0 0 var(--space-1) 0;">
			{m.dashboard_tile_homework_assignments()}
		</p>
		<p class="stat-tile-value" style="margin:0; color:{valueColor(data.homeworkAssignmentsCount)};">
			{data.homeworkAssignmentsCount}
		</p>
	</div>

	<div class="card">
		<p class="section-label" style="margin:0 0 var(--space-1) 0;">
			{m.dashboard_tile_completion()}
		</p>
		<p
			class="stat-tile-value"
			style="margin:0; color:{valueColor(data.homeworkCompletionPercent)};"
		>
			{m.dashboard_tile_completion_value({ percent: data.homeworkCompletionPercent })}
		</p>
	</div>
</div>
