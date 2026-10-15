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
	import { tick } from 'svelte';
	import { badgeRewardText, badgeSubjectLabel } from '$lib/badge-subject';
	import { formatDate, num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	type ModalElement = HTMLElement & {
		showModal(): Promise<void>;
		closeModal(reason?: unknown): Promise<void>;
	};

	let modal = $state<HTMLElement>();
	let badge = $state<BadgeView | null>(null);
	// The track's next target from badge_progress (null: top reached;
	// undefined: no progress row for the track, so no Next line).
	let next = $state<number | null | undefined>(undefined);
	let opener: HTMLElement | null = null;

	/**
	 * Opens the detail for `shown`; `trackNext` is its track's next target
	 * (null at the top, undefined when unknown). Focus returns to `from` on close.
	 */
	export async function open(
		shown: BadgeView,
		trackNext: number | null | undefined,
		from: HTMLElement | null
	) {
		badge = shown;
		next = trackNext;
		opener = from;
		await tick();
		const el = modal as (ModalElement & { componentOnReady?: () => Promise<unknown> }) | undefined;
		if (!el) return;
		await customElements.whenDefined('ix-modal');
		await el.componentOnReady?.();
		// The <dialog> lives in ix-modal's shadow DOM, where an aria-labelledby
		// to the slotted header can't resolve: name it directly, before it opens.
		el.shadowRoot?.querySelector('dialog')?.setAttribute('aria-label', badgeRewardText(shown));
		await el.showModal();
	}

	function close() {
		void (modal as ModalElement | undefined)?.closeModal();
	}

	function onClosed() {
		const target = opener;
		opener = null;
		void tick().then(() => {
			if (target?.isConnected) target.focus();
		});
	}
</script>

<ix-modal
	bind:this={modal}
	size="360"
	ondialogClose={onClosed}
	ondialogDismiss={onClosed}
	data-testid="badge-detail"
>
	<!-- svelte-ignore a11y_unknown_aria_attribute -->
	<ix-modal-header aria-label-close-icon-button={m.badge_dialog_close()}>
		{badge ? badgeSubjectLabel(badge.subject) : ''}
	</ix-modal-header>
	<ix-modal-content>
		{#if badge}
			<div class="badge-detail">
				{#if badge.icon}
					<img class="badge-detail-icon" src={badge.icon} alt="" width="160" height="160" />
				{:else}
					<ix-pill variant="primary" icon="trophy">{num(badge.milestone)}</ix-pill>
				{/if}
				<p class="badge-detail-reward">{badgeRewardText(badge)}</p>
				<p class="muted">{m.badge_detail_subject({ subject: badgeSubjectLabel(badge.subject) })}</p>
				<p class="muted">
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
		{/if}
	</ix-modal-content>
	<ix-modal-footer>
		<ix-button variant="secondary" onclick={close}>{m.badge_dialog_close()}</ix-button>
	</ix-modal-footer>
</ix-modal>

<style>
	.badge-detail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		text-align: center;
	}
	.badge-detail p {
		margin: 0;
	}
	.badge-detail-icon {
		width: 160px;
		height: 160px;
		object-fit: contain;
	}
	.badge-detail-reward {
		font-weight: 600;
		font-size: 1.125rem;
	}
</style>
