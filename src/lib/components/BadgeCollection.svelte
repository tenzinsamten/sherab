<script lang="ts">
	import Trophy from '@lucide/svelte/icons/trophy';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import {
		badgeIconLabel,
		badgeSubjectLabel,
		badgeTrackLabel,
		badgeUnlockText,
		type BadgeSubject
	} from '$lib/badge-subject';
	import { formatDate, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import BadgeDetailDialog from './BadgeDetailDialog.svelte';

	type Track = {
		type: 'attendance' | 'homework';
		total: number | null;
		next: number | null;
		badges: { milestone: number; icon: string | null; earnedAt: string | null }[];
	};

	/**
	 * Every badge of a student's subjects (badge detail CAP-7), on the
	 * student's, the parent's and the teacher's badge page. Earned badges are
	 * buttons opening their detail; locked ones are the same icon greyed out,
	 * with what unlocks them and, for the next one, the progress toward it.
	 * The state is always in text ("Earned on …" / "Locked"), not colour alone.
	 * Its own `data-ui="new"` root (mobile-first story 3); the clay
	 * celebration styling since story 4.
	 */
	let {
		sections,
		loadError
	}: {
		sections: { subject: BadgeSubject; tracks: Track[] }[];
		loadError: boolean;
	} = $props();

	let detail = $state<ReturnType<typeof BadgeDetailDialog>>();

	const badgeKey = (subject: BadgeSubject, type: string, milestone: number) =>
		`${subject}-${type}-${milestone}`;

	function earnedText(earnedAt: string): string {
		return m.badge_earned_on({
			date: formatDate(earnedAt, {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: 'Europe/Berlin'
			})
		});
	}

	/** "7 / 25" under the next locked badge only, when the track's count is known. */
	function progressFor(track: Track, milestone: number): string | null {
		if (track.total === null || track.next !== milestone) return null;
		return m.badge_progress_value({ total: num(track.total), next: num(milestone) });
	}

	const caption = 'text-[0.8125rem] leading-snug wrap-anywhere';
</script>

<div data-ui="new" class="flex flex-col gap-4">
	{#if loadError}
		<!-- A failed load is unknown state, not an empty collection. -->
		<p class={ui.muted} role="alert" data-testid="badge-page-error">{m.badge_page_load_failed()}</p>
	{:else if sections.length === 0}
		<p class={ui.muted} data-testid="badge-page-empty">{m.badge_page_empty()}</p>
	{:else}
		{#each sections as section (section.subject)}
			<section
				class={ui.clay}
				aria-labelledby="badge-subject-{section.subject}"
				data-subject={section.subject}
			>
				<h2 id="badge-subject-{section.subject}" class={ui.cardTitle}>
					{badgeSubjectLabel(section.subject)}
				</h2>
				{#each section.tracks as track (track.type)}
					<h3 class="mt-3 mb-2 text-base font-bold">{badgeTrackLabel(track.type)}</h3>
					<ul class="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
						{#each track.badges as badge (badge.milestone)}
							{@const view = {
								subject: section.subject,
								badgeType: track.type,
								milestone: badge.milestone
							}}
							{@const key = badgeKey(section.subject, track.type, badge.milestone)}
							{#if badge.earnedAt}
								{@const earnedAt = badge.earnedAt}
								<li
									class="flex min-w-0 flex-col items-center gap-1 rounded-clay border-3 border-clay bg-card p-2 text-center shadow-clay"
									data-badge={key}
									data-state="earned"
								>
									<button
										type="button"
										class="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
										aria-label={badgeIconLabel(view)}
										title={badgeIconLabel(view)}
										onclick={(event) =>
											detail?.open(
												{ ...view, earnedAt, icon: badge.icon },
												track.total === null ? undefined : track.next,
												event.currentTarget
											)}
									>
										{#if badge.icon}
											<img
												src={badge.icon}
												alt=""
												width="72"
												height="72"
												class="size-18 object-contain"
											/>
										{:else}
											<Badge>
												<Trophy aria-hidden="true" />
												{num(badge.milestone)}
											</Badge>
										{/if}
									</button>
									<p class={caption}>{earnedText(earnedAt)}</p>
								</li>
							{:else}
								{@const progress = progressFor(track, badge.milestone)}
								<li
									class="flex min-w-0 flex-col items-center gap-1 rounded-clay border-3 border-dashed border-clay p-2 text-center"
									data-badge={key}
									data-state="locked"
								>
									<!-- Locked: the real icon, greyed and faded, clearly apart from earned ones. -->
									<span
										class="inline-flex min-h-11 items-center opacity-40 grayscale"
										aria-hidden="true"
										data-visual
									>
										{#if badge.icon}
											<img
												src={badge.icon}
												alt=""
												width="72"
												height="72"
												class="size-18 object-contain"
											/>
										{:else}
											<Badge variant="secondary">
												<Trophy aria-hidden="true" />
												{num(badge.milestone)}
											</Badge>
										{/if}
									</span>
									<p class="{caption} flex flex-col text-muted-foreground">
										<span class="sr-only">{badgeIconLabel(view)}:</span>
										<span class="font-semibold">{m.badge_locked()}</span>
										<span>{badgeUnlockText(view)}</span>
										{#if progress}
											<span class="font-semibold tabular-nums" data-progress>{progress}</span>
										{/if}
									</p>
								</li>
							{/if}
						{/each}
					</ul>
				{/each}
			</section>
		{/each}
	{/if}
</div>

<BadgeDetailDialog bind:this={detail} />
