<script lang="ts">
	import {
		badgeIconLabel,
		badgeSubjectLabel,
		badgeTrackLabel,
		badgeUnlockText,
		type BadgeSubject
	} from '$lib/badge-subject';
	import { formatDate, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
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
</script>

{#if loadError}
	<!-- A failed load is unknown state, not an empty collection. -->
	<p class="muted" role="alert" data-testid="badge-page-error">{m.badge_page_load_failed()}</p>
{:else if sections.length === 0}
	<p class="muted" data-testid="badge-page-empty">{m.badge_page_empty()}</p>
{:else}
	{#each sections as section (section.subject)}
		<section
			class="card badge-section"
			aria-labelledby="badge-subject-{section.subject}"
			data-subject={section.subject}
		>
			<h2 id="badge-subject-{section.subject}">{badgeSubjectLabel(section.subject)}</h2>
			{#each section.tracks as track (track.type)}
				<h3 class="badge-track-heading">{badgeTrackLabel(track.type)}</h3>
				<ul class="badge-grid">
					{#each track.badges as badge (badge.milestone)}
						{@const view = {
							subject: section.subject,
							badgeType: track.type,
							milestone: badge.milestone
						}}
						{@const key = badgeKey(section.subject, track.type, badge.milestone)}
						{#if badge.earnedAt}
							{@const earnedAt = badge.earnedAt}
							<li class="badge-item" data-badge={key} data-state="earned">
								<button
									type="button"
									class="badge-button"
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
										<img src={badge.icon} alt="" width="72" height="72" />
									{:else}
										<ix-pill variant="primary" icon="trophy">{num(badge.milestone)}</ix-pill>
									{/if}
								</button>
								<p class="badge-caption">{earnedText(earnedAt)}</p>
							</li>
						{:else}
							{@const progress = progressFor(track, badge.milestone)}
							<li class="badge-item badge-locked" data-badge={key} data-state="locked">
								<span class="badge-visual" aria-hidden="true">
									{#if badge.icon}
										<img src={badge.icon} alt="" width="72" height="72" />
									{:else}
										<ix-pill variant="neutral" icon="trophy">{num(badge.milestone)}</ix-pill>
									{/if}
								</span>
								<p class="badge-caption">
									<span class="sr-only">{badgeIconLabel(view)}:</span>
									<span class="badge-state">{m.badge_locked()}</span>
									<span class="badge-unlock">{badgeUnlockText(view)}</span>
									{#if progress}
										<span class="badge-progress">{progress}</span>
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

<BadgeDetailDialog bind:this={detail} />

<style>
	.badge-section h2 {
		margin-top: 0;
	}
	.badge-track-heading {
		margin: var(--space-2) 0 var(--space-1);
		font-size: 1rem;
	}
	.badge-grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: var(--space-2);
	}
	.badge-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		text-align: center;
		min-width: 0;
	}
	.badge-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0;
		border: none;
		background: none;
		border-radius: 8px;
		cursor: pointer;
	}
	.badge-button:focus-visible {
		outline: 2px solid var(--theme-color-focus-bdr, currentColor);
		outline-offset: 2px;
	}
	.badge-item img {
		display: block;
		width: 72px;
		height: 72px;
		object-fit: contain;
	}
	.badge-visual {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
	}
	/* Locked: the real icon, greyed and faded, clearly apart from earned ones. */
	.badge-locked .badge-visual {
		filter: grayscale(1);
		opacity: 0.4;
	}
	.badge-caption {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.badge-locked .badge-caption {
		display: flex;
		flex-direction: column;
		color: var(--theme-color-soft-text, inherit);
	}
	.badge-state {
		font-weight: 600;
	}
	.badge-progress {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
</style>
