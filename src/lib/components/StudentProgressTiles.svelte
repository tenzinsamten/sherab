<script lang="ts">
	import Trophy from '@lucide/svelte/icons/trophy';
	import { Badge } from '$lib/components/ui/badge/index.js';
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
	import { ui } from '$lib/ui/classes';
	import type { BadgeView } from './BadgeDetailDialog.svelte';

	type ProgressTrack = { total: number; next: number | null };

	/**
	 * A student's streak and badges tiles (Stories 4-1/4-2), on the student
	 * dashboard and the parent's child page. The tile shows the most recently
	 * earned badges, then each track's next badge as its icon greyed out
	 * (badge detail story 3). The whole badges card is one link to the badge
	 * page with every badge, its detail and progress (story 4); nothing
	 * inside it is clickable on its own. Its own `data-ui="new"` root
	 * (mobile-first story 3), so it also works on pages that are still iX.
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

	// Celebration surfaces (story 4): the clay treatment; the streak is the
	// hero tile on play yellow (component-specs.md, Streak card).
	const tile = `${ui.clay} flex h-full flex-col gap-2`;
	const icons = 'flex flex-wrap items-center gap-1';
</script>

<div data-ui="new" class="grid gap-4 sm:grid-cols-2">
	<div class="{tile} bg-play/20" data-testid="streak-tile">
		<p class={ui.label}>{m.student_streak_label()}</p>
		{#if loadError}
			<!-- A failed fetch is unknown state, not a truthful zero: the
			     layout shows the error toast, and this tile shows no value
			     rather than the "no streak yet" copy. -->
			<p class="{ui.stat} {ui.muted}">—</p>
		{:else if streak && streak.currentStreak > 0}
			<p
				class={ui.stat}
				aria-label={num(m.student_streak_aria_label({ count: streak.currentStreak }))}
			>
				{num(m.student_streak_weeks({ count: streak.currentStreak }))}
			</p>
		{:else}
			<p class={ui.muted}>{m.student_streak_empty()}</p>
		{/if}
	</div>

	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seeAllHref is resolve()d by the caller. -->
	<a href={seeAllHref} class="{ui.tileLink} group" data-testid="badges-tile">
		<div class="{tile} transition-colors group-hover:bg-muted">
			<p class={ui.label}>{m.student_badges_label()}</p>
			{#if loadError}
				<p class="{ui.stat} {ui.muted}">—</p>
			{:else}
				{#if shownBadges.length > 0}
					<ul class={icons}>
						{#each shownBadges as badge (badgeKey(badge))}
							<li data-badge={badgeKey(badge)} data-state="earned" title={badgeIconLabel(badge)}>
								{#if badge.icon}
									<img
										src={badge.icon}
										alt={badgeIconLabel(badge)}
										width="56"
										height="56"
										class="size-14 object-contain"
									/>
								{:else}
									<Badge>
										<Trophy aria-hidden="true" />
										{badgeSubjectLabel(badge.subject)} · {badgeTrackLabel(badge.badgeType)}
										{num(badge.milestone)}
									</Badge>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class={ui.muted}>{m.student_badges_empty()}</p>
				{/if}

				<!-- Once every track is at its top badge there is nothing left to show. -->
				{#if progressLoadError || nextBadges.length > 0 || badgeProgress.length === 0}
					<p class="{ui.label} mt-2">{m.badge_progress_heading()}</p>
				{/if}
				{#if progressLoadError}
					<p class="{ui.stat} {ui.muted}">—</p>
				{:else if nextBadges.length > 0}
					<!-- Not yet earned: the real icon, greyed and faded, as on the badge page. -->
					<ul class="{icons} opacity-40 grayscale" data-testid="badge-next">
						{#each nextBadges as badge (badgeKey(badge))}
							{@const icon = badgeIconPath(badge)}
							{@const label = `${badgeIconLabel(badge)} (${m.badge_locked()})`}
							<li data-badge={badgeKey(badge)} data-state="next" title={label}>
								{#if icon}
									<img
										src={icon}
										alt={label}
										width="56"
										height="56"
										class="size-14 object-contain"
									/>
								{:else}
									<Badge variant="secondary" role="img" aria-label={label}>
										<Trophy aria-hidden="true" />
										{num(badge.milestone)}
									</Badge>
								{/if}
							</li>
						{/each}
					</ul>
				{:else if badgeProgress.length === 0}
					<p class={ui.muted}>{m.badge_progress_empty()}</p>
				{/if}
			{/if}
		</div>
	</a>
</div>
