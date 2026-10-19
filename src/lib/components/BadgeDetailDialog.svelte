<script lang="ts" module>
	import type { BadgeSubject } from '$lib/badge-subject';

	/** An earned badge as the Badges tile and its detail dialog show it (badge detail CAP-5). */
	export type BadgeView = {
		subject: BadgeSubject;
		badgeType: 'attendance' | 'homework';
		milestone: number;
		earnedAt: string;
		icon: string | null;
	};
</script>

<script lang="ts">
	import Trophy from '@lucide/svelte/icons/trophy';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { badgeRewardText, badgeSubjectLabel } from '$lib/badge-subject';
	import { formatDate, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';

	/**
	 * An earned badge's detail (badge detail CAP-5), on the new component
	 * system (mobile-first story 3): a dialog portalled to the shell's
	 * `data-ui="new"` root, titled with the badge's subject (as iX's header was). Escape, the
	 * close button or the footer button close it; focus returns to the badge
	 * that opened it.
	 */
	let isOpen = $state(false);
	let badge = $state<BadgeView | null>(null);
	// The track's next target from badge_progress (null: top reached;
	// undefined: no progress row for the track, so no Next line).
	let next = $state<number | null | undefined>(undefined);
	let opener: HTMLElement | null = null;

	/**
	 * Opens the detail for `shown`; `trackNext` is its track's next target
	 * (null at the top, undefined when unknown). Focus returns to `from` on close.
	 */
	export function open(
		shown: BadgeView,
		trackNext: number | null | undefined,
		from: HTMLElement | null
	) {
		badge = shown;
		next = trackNext;
		opener = from;
		isOpen = true;
	}

	function returnFocus(event: Event) {
		const target = opener;
		opener = null;
		if (target?.isConnected) {
			event.preventDefault();
			target.focus();
		}
	}
</script>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Content
		data-testid="badge-detail"
		closeLabel={m.badge_dialog_close()}
		class="max-h-[85dvh] overflow-y-auto p-6 sm:max-w-sm"
		onCloseAutoFocus={returnFocus}
	>
		{#if badge}
			<div class="flex flex-col items-center gap-2 pt-4 text-center">
				<Dialog.Title class="text-lg leading-snug font-semibold">
					{badgeSubjectLabel(badge.subject)}
				</Dialog.Title>
				{#if badge.icon}
					<img src={badge.icon} alt="" width="160" height="160" class="size-40 object-contain" />
				{:else}
					<Badge>
						<Trophy aria-hidden="true" />
						{num(badge.milestone)}
					</Badge>
				{/if}
				<p class="text-lg leading-snug font-semibold">{badgeRewardText(badge)}</p>
				<Dialog.Description class={ui.muted}>
					{m.badge_detail_subject({ subject: badgeSubjectLabel(badge.subject) })}
				</Dialog.Description>
				<p class={ui.muted}>
					{m.badge_earned_on({
						date: formatDate(badge.earnedAt, {
							day: 'numeric',
							month: 'long',
							year: 'numeric',
							timeZone: 'Europe/Berlin'
						})
					})}
				</p>
				{#if next !== undefined}
					<p>
						{next === null ? m.badge_top_reached() : m.badge_next({ count: num(next) })}
					</p>
				{/if}
			</div>
			<div class="mt-2 flex justify-center">
				<Button
					variant="outline"
					class="{ui.touch} w-full sm:w-auto"
					onclick={() => (isOpen = false)}
				>
					{m.badge_dialog_close()}
				</Button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
