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
	 * earned badges, then each track's next badge as its icon greyed out
	 * (badge detail story 3). The whole badges card is one link to the badge
	 * page with every badge, its detail and progress (story 4); nothing
	 * inside it is clickable on its own.
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
		/** The student's badge page, which the whole badges card links to. */
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
	<a href={seeAllHref} class="tile-link" data-testid="badges-tile">
		<ix-card variant="outline">
			<ix-card-content>
				<p class="section-label">{m.student_badges_label()}</p>
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

					<!-- Once every track is at its top badge there is nothing left to show. -->
					{#if progressLoadError || nextBadges.length > 0 || badgeProgress.length === 0}
						<p class="section-label badge-progress-heading">{m.badge_progress_heading()}</p>
					{/if}
					{#if progressLoadError}
						<p class="stat-tile-value muted">—</p>
					{:else if nextBadges.length > 0}
						<ul class="badge-icons badge-next">
							{#each nextBadges as badge (badgeKey(badge))}
								{@const icon = badgeIconPath(badge)}
								{@const label = `${badgeIconLabel(badge)} (${m.badge_locked()})`}
								<li data-badge={badgeKey(badge)} data-state="next" title={label}>
									{#if icon}
										<img src={icon} alt={label} width="56" height="56" />
									{:else}
										<ix-pill variant="neutral" icon="trophy" aria-label={label}
											>{num(badge.milestone)}</ix-pill
										>
									{/if}
								</li>
							{/each}
						</ul>
					{:else if badgeProgress.length === 0}
						<p class="muted" style="margin:0;">{m.badge_progress_empty()}</p>
					{/if}
				{/if}
			</ix-card-content>
		</ix-card>
	</a>
</div>

<style>
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
		filter: grayscale(1);
		opacity: 0.4;
	}
	.badge-progress-heading {
		margin-top: var(--space-2);
	}
</style>
