<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/** #97: a team's students by name. Mobile-first story 5. */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{data.team.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<PageBreadcrumb
		items={[
			{ label: m.leaderboard_heading(), href: resolve('/leaderboard') },
			{ label: data.team.name }
		]}
	/>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.team_students_section_label()}</p>
			<h1 class="{ui.heading} wrap-anywhere">{data.team.name}</h1>
		</div>
	</header>

	<section class={ui.card} aria-labelledby="team-students-heading">
		<h2 id="team-students-heading" class={ui.cardTitle}>
			{m.team_students_heading({ count: num(data.students.length) })}
		</h2>
		{#if data.students.length === 0}
			<p class={ui.muted} data-testid="team-students-empty">{m.team_students_empty()}</p>
		{:else}
			<!-- Names only (#97); two students may share a name, so keyed by position. -->
			<ul
				class="{ui.rows} md:grid md:grid-cols-2 md:gap-x-6 md:divide-y-0"
				data-testid="team-students"
			>
				{#each data.students as name, index (index)}
					<li class="min-w-0 py-3 wrap-anywhere md:border-b md:border-border">{name}</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
