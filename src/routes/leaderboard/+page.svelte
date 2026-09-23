<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

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
			rank,
			team: teamName,
			weeks: m.leaderboard_streak_weeks({ count: totalStreak })
		});
	}
</script>

<svelte:head>
	<title>{m.leaderboard_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.leaderboard_section_label()}</p>
			<h1 class="page-heading">{m.leaderboard_heading()}</h1>
		</div>
	</header>

	{#if !data.loadError}
		{#if data.teams.length > 0}
			<ol class="leaderboard">
				{#each data.teams as team, index (team.teamId)}
					<li aria-label={rowAriaLabel(index + 1, team.teamName, team.totalStreak)}>
						<ix-card variant="outline" passive>
							<ix-card-content>
								<div class="leaderboard-row">
									<span class="leaderboard-rank" class:top={index === 0}>{index + 1}</span>
									<span class="leaderboard-team">{team.teamName}</span>
									<span class="stat-tile-value"
										>{m.leaderboard_streak_weeks({ count: team.totalStreak })}</span
									>
								</div>
							</ix-card-content>
						</ix-card>
					</li>
				{/each}
			</ol>
		{:else}
			<ix-empty-state header={m.leaderboard_empty()} icon="trophy"></ix-empty-state>
		{/if}
	{/if}
</div>

<style>
	.leaderboard {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.leaderboard-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.leaderboard-rank {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--theme-color-component-1);
		font-weight: var(--theme-font-weight-bold);
	}
	.leaderboard-rank.top {
		background: var(--theme-color-primary);
		color: var(--theme-color-primary--contrast);
	}
	.leaderboard-team {
		flex: 1;
		font-weight: var(--theme-font-weight-bold);
	}
	.leaderboard-row .stat-tile-value {
		font-size: var(--theme-font-size-xl);
	}
</style>
