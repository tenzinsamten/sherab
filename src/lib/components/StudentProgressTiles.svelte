<script lang="ts">
	import {
		badgeIconLabel,
		badgeSubjectLabel,
		badgeTrackLabel,
		recentBadges,
		type BadgeSubject
	} from '$lib/badge-subject';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import BadgeDetailDialog, { type BadgeView } from './BadgeDetailDialog.svelte';

	type ProgressTrack = { total: number; next: number | null };

	/**
	 * A student's streak and badges tiles (Stories 4-1/4-2), on the student
	 * dashboard and the parent's child page. Badges show as icons that open
	 * their detail, with per-subject progress toward the next badge (badge
	 * detail story 3). The tile shows the most recently earned badges only;
	 * "See all" leads to the badge page with every badge (story 4).
	 */
	let {
		streak,
		badges,
		badgeProgress,
		loadError,
		progressLoadError,
		seeAllHref
	}: {
		streak: { currentStreak: number } | null;
		badges: BadgeView[];
		badgeProgress: {
			subject: BadgeSubject;
			attendance: ProgressTrack;
			homework: ProgressTrack;
		}[];
		loadError: boolean;
		/** badge_progress() failed: only the progress section shows "—". */
		progressLoadError: boolean;
		/** The student's badge page, linked as "See all". */
		seeAllHref: string;
	} = $props();

	/** How many earned badges the tile shows. */
	const RECENT_BADGES = 6;

	// Newest first (a tie keeps the subject order).
	let shownBadges = $derived(recentBadges(badges, RECENT_BADGES));

	let detail = $state<ReturnType<typeof BadgeDetailDialog>>();

	/** The badge's track's next target from badge_progress; undefined when there is no row. */
	function trackNext(badge: BadgeView): number | null | undefined {
		return badgeProgress.find((row) => row.subject === badge.subject)?.[badge.badgeType].next;
	}

	function progressText(track: ProgressTrack): string {
		return track.next === null
			? m.badge_progress_top({ total: num(track.total) })
			: m.badge_progress_value({ total: num(track.total), next: num(track.next) });
	}
</script>

<div class="tile-grid" style="margin-bottom: var(--space-4);">
	<ix-card variant="outline" passive>
		<ix-card-content>
			<p class="section-label">{m.student_streak_label()}</p>
			{#if loadError}
				<!-- A failed fetch is unknown state, not a truthful zero: the
				     layout shows the error toast, and this tile shows no value
				     rather than the "no streak yet" copy. -->
				<p class="stat-tile-value muted">—</p>
			{:else if streak && streak.currentStreak > 0}
				<p
					class="stat-tile-value"
					aria-label={num(m.student_streak_aria_label({ count: streak.currentStreak }))}
				>
					{num(m.student_streak_weeks({ count: streak.currentStreak }))}
				</p>
			{:else}
				<p class="muted" style="margin:0;">{m.student_streak_empty()}</p>
			{/if}
		</ix-card-content>
	</ix-card>

	<ix-card variant="outline" passive>
		<ix-card-content>
			<div class="badge-tile-header">
				<p class="section-label">{m.student_badges_label()}</p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seeAllHref is resolve()d by the caller. -->
				<a href={seeAllHref} aria-label={m.badge_see_all_label()} data-testid="badges-see-all"
					>{m.badge_see_all()}</a
				>
			</div>
			{#if loadError}
				<p class="stat-tile-value muted">—</p>
			{:else}
				{#if shownBadges.length > 0}
					<ul class="badge-icons">
						{#each shownBadges as badge (`${badge.subject}-${badge.badgeType}-${badge.milestone}`)}
							<li>
								<button
									type="button"
									class="badge-button"
									class:badge-button-pill={!badge.icon}
									aria-label={badgeIconLabel(badge)}
									title={badgeIconLabel(badge)}
									data-badge={`${badge.subject}-${badge.badgeType}-${badge.milestone}`}
									onclick={(event) => detail?.open(badge, trackNext(badge), event.currentTarget)}
								>
									{#if badge.icon}
										<img src={badge.icon} alt="" width="56" height="56" />
									{:else}
										<ix-pill variant="primary" icon="trophy">
											{badgeSubjectLabel(badge.subject)} · {badgeTrackLabel(badge.badgeType)}
											{num(badge.milestone)}
										</ix-pill>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted" style="margin:0;">{m.student_badges_empty()}</p>
				{/if}

				<p class="section-label badge-progress-heading">{m.badge_progress_heading()}</p>
				{#if progressLoadError}
					<p class="stat-tile-value muted">—</p>
				{:else if badgeProgress.length > 0}
					<dl class="badge-progress">
						{#each badgeProgress as row (row.subject)}
							{#each ['attendance', 'homework'] as const as track (track)}
								<div data-progress={`${row.subject}-${track}`}>
									<dt>{badgeSubjectLabel(row.subject)} · {badgeTrackLabel(track)}</dt>
									<dd>{progressText(row[track])}</dd>
								</div>
							{/each}
						{/each}
					</dl>
				{:else}
					<p class="muted" style="margin:0;">{m.badge_progress_empty()}</p>
				{/if}
			{/if}
		</ix-card-content>
	</ix-card>
</div>

<BadgeDetailDialog bind:this={detail} />

<style>
	.badge-tile-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.badge-tile-header a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.badge-tile-header .section-label {
		margin-bottom: 0;
	}
	.badge-icons {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.badge-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: none;
		border-radius: 8px;
		cursor: pointer;
	}
	.badge-button img {
		display: block;
		width: 56px;
		height: 56px;
		object-fit: contain;
	}
	.badge-button-pill {
		min-height: 44px;
	}
	.badge-button:focus-visible {
		outline: 2px solid var(--theme-color-focus-bdr, currentColor);
		outline-offset: 2px;
	}
	.badge-progress-heading {
		margin-top: var(--space-2);
	}
	.badge-progress {
		margin: 0;
		display: grid;
		gap: var(--space-1);
	}
	.badge-progress div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.badge-progress dt,
	.badge-progress dd {
		margin: 0;
	}
	.badge-progress dd {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
