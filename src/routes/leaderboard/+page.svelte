<script lang="ts">
	import { onMount } from 'svelte';
	import Trophy from '@lucide/svelte/icons/trophy';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * The team leaderboard: ranked rows, the top rank highlighted, two
	 * columns from 48em. Mobile-first story 5.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	/**
	 * Composes the full per-row accessible name (rank, team name, combined
	 * streak) mirroring student/+page.svelte's aria-label-overrides-visible-
	 * text pattern (WCAG 2.2 AA) -- the weeks phrase is formatted via
	 * leaderboard_streak_weeks first (so its plural form is correct for this
	 * team's total) and then composed into the row-level sentence, avoiding
	 * the need for a second nested plural selector in the aria-label message
	 * itself.
	 */
	function rowAriaLabel(rank: number, teamName: string, totalStreak: number): string {
		return m.leaderboard_row_aria_label({
			rank: num(rank),
			team: teamName,
			weeks: num(m.leaderboard_streak_weeks({ count: totalStreak }))
		});
	}
</script>

<svelte:head>
	<title>{m.leaderboard_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.leaderboard_section_label()}</p>
			<h1 class={ui.heading}>{m.leaderboard_heading()}</h1>
		</div>
	</header>

	{#if !data.loadError}
		{#if data.teams.length > 0}
			<ol class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2" data-testid="leaderboard">
				{#each data.teams as team, index (team.teamId)}
					{@const top = index === 0}
					<li
						aria-label={rowAriaLabel(index + 1, team.teamName, team.totalStreak)}
						data-testid="leaderboard-row"
						data-top={top || undefined}
						class="flex min-h-16 min-w-0 items-center gap-4 rounded-lg border bg-card p-4 text-card-foreground {top
							? 'border-2 border-primary bg-accent'
							: 'border-border'}"
					>
						<span
							class="inline-flex size-10 flex-none items-center justify-center rounded-full font-bold tabular-nums {top
								? 'bg-primary text-primary-foreground'
								: 'bg-muted text-foreground'}">{num(index + 1)}</span
						>
						<span class="min-w-0 flex-1 font-bold wrap-anywhere">
							{#if team.canOpen}
								<a
									href={resolve('/teams/[teamId]', { teamId: team.teamId })}
									aria-label={m.team_students_link_label({ team: team.teamName })}
									class="{ui.link} inline-flex min-h-11 items-center">{team.teamName}</a
								>
							{:else}
								{team.teamName}
							{/if}
						</span>
						<span class="flex-none text-xl font-bold tabular-nums"
							>{num(m.leaderboard_streak_weeks({ count: team.totalStreak }))}</span
						>
					</li>
				{/each}
			</ol>
		{:else}
			<section class={ui.card}>
				<EmptyState header={m.leaderboard_empty()} icon={Trophy} />
			</section>
		{/if}
	{/if}
</div>
