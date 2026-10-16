<script lang="ts">
	import {
		badgeIconLabel,
		badgeIconPath,
		badgeSubjectLabel,
		badgeTrackLabel,
		recentBadges,
		type BadgeSubject
	} from '$lib/badge-subject';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import type { BadgeView } from './BadgeDetailDialog.svelte';

	type ProgressTrack = { total: number; next: number | null };

	/**
	 * A student's streak and badges tiles (Stories 4-1/4-2), on the student
	 * dashboard and the parent's child page. The tile shows the most recently
	 * earned badges, then each track's next badge greyed out with the
	 * per-subject progress toward it (badge detail story 3). The whole badges
	 * card is one link to the badge page with every badge and its detail
	 * (story 4); nothing inside it is clickable on its own.
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

	// Each track's next badge to earn, in progress order; none after the top milestone.
	let nextBadges = $derived(
		badgeProgress.flatMap((row) =>
			(['attendance', 'homework'] as const).flatMap((badgeType) => {
				const milestone = row[badgeType].next;
				return milestone === null ? [] : [{ subject: row.subject, badgeType, milestone }];
			})
		)
	);

	const badgeKey = (badge: Pick<BadgeView, 'subject' | 'badgeType' | 'milestone'>) =>
		`${badge.subject}-${badge.badgeType}-${badge.milestone}`;

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

	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seeAllHref is resolve()d by the caller. -->
	<a href={seeAllHref} class="tile-link" data-testid="badges-see-all">
		<ix-card variant="outline">
			<ix-card-content>
				<div class="badge-tile-header">
					<p class="section-label">{m.student_badges_label()}</p>
					<span class="badge-see-all">{m.badge_see_all()}</span>
				</div>
				{#if loadError}
					<p class="stat-tile-value muted">—</p>
				{:else}
					{#if shownBadges.length > 0}
						<ul class="badge-icons">
							{#each shownBadges as badge (badgeKey(badge))}
								<li data-badge={badgeKey(badge)} data-state="earned" title={badgeIconLabel(badge)}>
									{#if badge.icon}
										<img src={badge.icon} alt={badgeIconLabel(badge)} width="56" height="56" />
									{:else}
										<ix-pill variant="primary" icon="trophy">
											{badgeSubjectLabel(badge.subject)} · {badgeTrackLabel(badge.badgeType)}
											{num(badge.milestone)}
										</ix-pill>
									{/if}
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
						{#if nextBadges.length > 0}
							<!-- The greyed icons repeat the progress list below, which carries the text. -->
							<ul class="badge-icons badge-next" aria-hidden="true">
								{#each nextBadges as badge (badgeKey(badge))}
									{@const icon = badgeIconPath(badge)}
									<li data-badge={badgeKey(badge)} data-state="next">
										{#if icon}
											<img src={icon} alt="" width="56" height="56" />
										{:else}
											<ix-pill variant="neutral" icon="trophy">{num(badge.milestone)}</ix-pill>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
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
	</a>
</div>

<style>
	.badge-tile-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.badge-tile-header .section-label {
		margin-bottom: 0;
	}
	.badge-see-all {
		color: var(--theme-color-primary);
	}
	.tile-link:hover .badge-see-all {
		text-decoration: underline;
	}
	.badge-icons {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.badge-icons img {
		display: block;
		width: 56px;
		height: 56px;
		object-fit: contain;
	}
	/* Not yet earned: the real icon, greyed and faded, as on the badge page. */
	.badge-next {
		margin-bottom: var(--space-1);
		filter: grayscale(1);
		opacity: 0.4;
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
