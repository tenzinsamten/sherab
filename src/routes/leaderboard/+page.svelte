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

<p class="section-label">{m.leaderboard_section_label()}</p>
<h1>{m.leaderboard_heading()}</h1>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{:else if data.teams.length > 0}
	<ol
		style="list-style:none; padding:0; margin: var(--space-4) 0 0 0; display:flex; flex-direction:column; gap: var(--space-2);"
	>
		{#each data.teams as team, index (team.teamId)}
			<li class="card" aria-label={rowAriaLabel(index + 1, team.teamName, team.totalStreak)}>
				<div
					style="display:flex; align-items:center; justify-content:space-between; gap: var(--space-4);"
				>
					<div style="display:flex; align-items:baseline; gap: var(--space-3);">
						<span class="section-label" style="margin:0;"
							>{m.leaderboard_rank_label({ rank: index + 1 })}</span
						>
						<span style="font-weight:700; font-size: var(--text-lg);">{team.teamName}</span>
					</div>
					<p class="stat-tile-value" style="margin:0;">
						{m.leaderboard_streak_weeks({ count: team.totalStreak })}
					</p>
				</div>
			</li>
		{/each}
	</ol>
{:else}
	<div class="card" style="margin-top: var(--space-4);">
		<p style="color: var(--color-muted-foreground); margin: 0;">{m.leaderboard_empty()}</p>
	</div>
{/if}
