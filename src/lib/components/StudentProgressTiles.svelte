<script lang="ts">
	import { badgeSubjectLabel, type BadgeSubject } from '$lib/badge-subject';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	/** A student's streak and badges tiles (Stories 4-1/4-2), shown on /account (#44). */
	let {
		streak,
		badges,
		loadError
	}: {
		streak: { currentStreak: number } | null;
		badges: { subject: BadgeSubject; badgeType: 'attendance' | 'homework'; milestone: number }[];
		loadError: boolean;
	} = $props();

	// Subject prefix is interim until the badge icons/detail (badge detail story 3).
	function badgeEntryLabel(badge: {
		subject: BadgeSubject;
		badgeType: 'attendance' | 'homework';
		milestone: number;
	}): string {
		const entry =
			badge.badgeType === 'homework'
				? m.student_badges_entry_homework({ count: num(badge.milestone) })
				: m.student_badges_entry_attendance({ count: num(badge.milestone) });
		return `${badgeSubjectLabel(badge.subject)}: ${entry}`;
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
			<p class="section-label">{m.student_badges_label()}</p>
			{#if loadError}
				<p class="stat-tile-value muted">—</p>
			{:else if badges.length > 0}
				<ul
					style="list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap: var(--space-1);"
				>
					{#each badges as badge (`${badge.subject}-${badge.badgeType}-${badge.milestone}`)}
						<li><ix-pill variant="primary" icon="trophy">{badgeEntryLabel(badge)}</ix-pill></li>
					{/each}
				</ul>
			{:else}
				<p class="muted" style="margin:0;">{m.student_badges_empty()}</p>
			{/if}
		</ix-card-content>
	</ix-card>
</div>
