<script lang="ts">
	import { resolve } from '$app/paths';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.team.name} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.leaderboard_heading(), href: resolve('/leaderboard') },
			{ label: data.team.name }
		]}
	/>
	<header class="page-header">
		<div class="team-title">
			<p class="page-kicker">{m.team_students_section_label()}</p>
			<h1 class="page-heading">{data.team.name}</h1>
		</div>
	</header>

	<section class="card" aria-labelledby="team-students-heading">
		<h2 id="team-students-heading">
			{m.team_students_heading({ count: num(data.students.length) })}
		</h2>
		{#if data.students.length === 0}
			<p class="muted" style="margin:0;">{m.team_students_empty()}</p>
		{:else}
			<!-- Names only (#97); two students may share a name, so keyed by position. -->
			<ul class="students">
				{#each data.students as name, index (index)}
					<li>{name}</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.team-title {
		min-width: 0;
	}

	.team-title .page-heading,
	.students li {
		overflow-wrap: anywhere;
	}

	.students {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.students li {
		min-width: 0;
	}
</style>
