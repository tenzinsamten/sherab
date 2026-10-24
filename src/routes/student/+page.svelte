<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import StudentProgressTiles from '$lib/components/StudentProgressTiles.svelte';
	import { num } from '$lib/format';
	import { showToast } from '$lib/toast';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * The student dashboard (#46), mobile-first story 4: the homework and
	 * team tiles in two columns on a phone (four from 48em), streak and
	 * badges, the next homework due and a card per class (a grid on a
	 * tablet). #113: the "Join another class" card is on the Classes tab.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	// Set once the page is interactive (tests wait for it before tapping).
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	$effect(() => {
		if (!form) return;
		if ('success' in form && form.success)
			showToast('success', m.student_homework_mark_done_success());
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

	const tile = `${ui.card} flex h-full flex-col gap-1 transition-colors group-hover:bg-muted`;
	const tileLink = `${ui.tileLink} group min-w-0`;
	const cardHeader = 'mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1';
</script>

<svelte:head>
	<title>{m.student_dashboard_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.student_section_label()}</p>
			<h1 class={ui.heading}>{m.student_dashboard_heading()}</h1>
		</div>
	</header>

	<ul class="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" data-testid="dashboard-tiles">
		{#each tiles as t (t.label)}
			<li class="min-w-0">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- t.href is built on resolve() above. -->
				<a href={t.href} class={tileLink}>
					<div class={tile}>
						<p class="{ui.label} wrap-break-word">{t.label}</p>
						<p class="{ui.stat} {t.value === 0 || data.loadError ? ui.muted : ''}">
							{data.loadError ? '—' : num(t.value)}
						</p>
					</div>
				</a>
			</li>
		{/each}
		<li class="min-w-0">
			<!-- #97: with a team, the tile opens the team's students (that page
			     leads on to the leaderboard); without one, the leaderboard. -->
			<a
				href={data.teamId
					? resolve('/teams/[teamId]', { teamId: data.teamId })
					: resolve('/leaderboard')}
				class={tileLink}
			>
				<div class={tile}>
					<p class="{ui.label} wrap-break-word">{m.student_tile_team()}</p>
					{#if data.team}
						<p class="{ui.stat} wrap-break-word">
							{m.student_team_rank({ rank: num(data.team.rank), total: num(data.team.total) })}
						</p>
						<p class="{ui.muted} wrap-break-word">{data.team.name}</p>
					{:else}
						<p class="{ui.stat} {ui.muted}">—</p>
					{/if}
				</div>
			</a>
		</li>
	</ul>

	<StudentProgressTiles
		streak={data.streak}
		badges={data.badges}
		badgeProgress={data.badgeProgress}
		progressLoadError={data.progressLoadError}
		loadError={data.loadError}
		seeAllHref={resolve('/student/badges')}
	/>

	<section class={ui.card} aria-labelledby="next-due-heading">
		<div class={cardHeader}>
			<h2 id="next-due-heading" class="text-lg leading-snug font-bold">
				{m.student_next_due_heading()}
			</h2>
			<a href={homeworkHref} class="{ui.link} inline-flex min-h-11 items-center">
				{m.student_see_all_homework()}
			</a>
		</div>
		{#if data.nextDue.length === 0}
			<p class={ui.muted}>
				{data.loadError ? m.student_homework_load_failed() : m.student_homework_empty()}
			</p>
		{:else}
			<StudentHomeworkRows items={data.nextDue} />
		{/if}
	</section>

	<section class={ui.card} aria-labelledby="classes-heading">
		<h2 id="classes-heading" class={ui.cardTitle}>{m.nav_my_classes()}</h2>
		{#if data.classes.length === 0}
			<p class={ui.muted}>
				{data.loadError ? m.student_homework_load_failed() : m.student_no_classes()}
			</p>
			{#if !data.loadError}
				<!-- #126: the next step: joining lives on My classes (#113). -->
				<div>
					<Button href={resolve('/student/classes')} variant="outline">{m.nav_join()}</Button>
				</div>
			{/if}
		{:else}
			<ul class="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="class-cards">
				{#each data.classes as cls (cls.id)}
					<li class="min-w-0">
						<a href={resolve('/student/classes/[classId]', { classId: cls.id })} class={tileLink}>
							<div
								class="flex h-full items-center justify-between gap-2 rounded-lg border border-border p-4 transition-colors group-hover:bg-muted"
							>
								<span class="flex min-w-0 flex-col gap-1">
									<span class="font-bold wrap-break-word">{cls.name}</span>
									<span class={ui.muted}>
										{m.student_class_todo_count({ count: num(cls.todo) })}
									</span>
								</span>
								<ChevronRight class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
