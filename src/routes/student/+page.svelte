<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import StudentProgressTiles from '$lib/components/StudentProgressTiles.svelte';
	import { showToast } from '$lib/ix';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	$effect(() => {
		if (form?.success) showToast('success', m.student_homework_mark_done_success());
	});

	const homeworkHref = resolve('/student/homework');

	// A failed load shows "—" rather than a misleading zero.
	let tiles = $derived([
		{ label: m.student_tile_todo(), value: data.tiles.todo, href: homeworkHref },
		{ label: m.student_tile_overdue(), value: data.tiles.overdue, href: homeworkHref },
		{
			label: m.student_tile_done_week(),
			value: data.tiles.doneThisWeek,
			href: `${homeworkHref}?filter=done`
		}
	]);
</script>

<svelte:head>
	<title>{m.student_dashboard_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.student_section_label()}</p>
			<h1 class="page-heading">{m.student_dashboard_heading()}</h1>
		</div>
	</header>

	<div class="tile-grid" style="margin-bottom: var(--space-4);">
		{#each tiles as tile (tile.label)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tile.href is built on resolve() above. -->
			<a href={tile.href} class="tile-link">
				<ix-card variant="outline">
					<ix-card-content>
						<p class="section-label">{tile.label}</p>
						<p
							class={tile.value === 0 || data.loadError
								? 'stat-tile-value muted'
								: 'stat-tile-value'}
						>
							{data.loadError ? '—' : tile.value}
						</p>
					</ix-card-content>
				</ix-card>
			</a>
		{/each}
		<a href={resolve('/leaderboard')} class="tile-link">
			<ix-card variant="outline">
				<ix-card-content>
					<p class="section-label">{m.student_tile_team()}</p>
					{#if data.team}
						<p class="stat-tile-value">
							{m.student_team_rank({ rank: data.team.rank, total: data.team.total })}
						</p>
						<p class="muted" style="margin:0;">{data.team.name}</p>
					{:else}
						<p class="stat-tile-value muted">—</p>
					{/if}
				</ix-card-content>
			</ix-card>
		</a>
	</div>

	<StudentProgressTiles streak={data.streak} badges={data.badges} loadError={data.loadError} />

	<section class="card">
		<div class="card-header">
			<h2>{m.student_next_due_heading()}</h2>
			<a href={homeworkHref}>{m.student_see_all_homework()}</a>
		</div>
		{#if data.nextDue.length === 0}
			<p class="muted" style="margin:0;">
				{data.loadError ? m.student_homework_load_failed() : m.student_homework_empty()}
			</p>
		{:else}
			<StudentHomeworkRows items={data.nextDue} />
		{/if}
	</section>

	<section class="card">
		<h2>{m.nav_my_classes()}</h2>
		{#if data.classes.length === 0}
			<p class="muted" style="margin:0;">
				{data.loadError ? m.student_homework_load_failed() : m.student_no_classes()}
			</p>
		{:else}
			<div class="class-cards">
				{#each data.classes as cls (cls.id)}
					<a href={resolve('/student/classes/[classId]', { classId: cls.id })} class="tile-link">
						<ix-card variant="outline">
							<ix-card-content>
								<p class="section-label">{cls.name}</p>
								<p class="muted" style="margin:0;">
									{m.student_class_todo_count({ count: cls.todo })}
								</p>
							</ix-card-content>
						</ix-card>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.card-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.card-header h2 {
		margin: 0;
	}

	.class-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-4);
	}
</style>
