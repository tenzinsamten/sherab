<script lang="ts" module>
	import type { BadgeSubject } from '$lib/badge-subject';

	/** A badge the student has not seen celebrated yet (the layout's `newBadges`). */
	export type NewBadgeView = {
		id: string;
		subject: BadgeSubject;
		badgeType: 'attendance' | 'homework';
		milestone: number;
		icon: string | null;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { badgeRewardText } from '$lib/badge-subject';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * The one-time "New badge!" celebration (badge detail CAP-9). Mounted in
	 * the signed-in layout for the student role only; the layout loads
	 * `badges` (unseen, approved student only) in tile order.
	 *
	 * It opens by itself when there are badges to show. Dismissing it (Close,
	 * Escape, or the link to the badge page) marks them seen on the account;
	 * showing it does not. If marking fails the dialog still closes, and the
	 * badges show again on the next visit.
	 */
	let { badges, userId }: { badges: readonly NewBadgeView[]; userId: string } = $props();

	type ModalElement = HTMLElement & {
		showModal(): Promise<void>;
		closeModal(reason?: unknown): Promise<void>;
		componentOnReady?: () => Promise<unknown>;
	};

	let modal = $state<HTMLElement>();
	let closeButton = $state<HTMLElement>();
	// What the dialog shows while open; kept so a layout reload while it is
	// open does not change it under the student.
	let shown = $state<NewBadgeView[]>([]);
	let isOpen = false;
	// Set while Close or the link is closing it, so focus is not pulled back.
	let closing = false;
	let opener: HTMLElement | null = null;

	// The layout load does not run again on every navigation, so badges
	// dismissed in this browser session are remembered here too. Plain
	// variables: nothing is rendered from them.
	let dismissed: string[] = [];
	let dismissedOwner = '';

	function pending(): NewBadgeView[] {
		if (dismissedOwner !== userId) {
			dismissedOwner = userId;
			dismissed = [];
		}
		return badges.filter((badge) => !dismissed.includes(badge.id));
	}

	$effect(() => {
		const toShow = pending();
		if (toShow.length > 0 && !isOpen && modal) void open(toShow);
	});

	async function open(toShow: NewBadgeView[]) {
		isOpen = true;
		shown = toShow;
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		await tick();
		const el = modal as ModalElement | undefined;
		if (!el) {
			isOpen = false;
			return;
		}
		await customElements.whenDefined('ix-modal');
		await el.componentOnReady?.();
		// The <dialog> lives in ix-modal's shadow DOM, where an aria-labelledby
		// to the slotted header can't resolve: name it directly, before it opens.
		el.shadowRoot
			?.querySelector('dialog')
			?.setAttribute('aria-label', m.badge_new_title({ count: toShow.length }));
		await el.showModal();
		focusInside();
	}

	/**
	 * Moves focus to the Close button unless it is already in the dialog.
	 * Needed because a navigation (the redirect after sign-in) resets focus
	 * to the page after the dialog opened.
	 */
	function focusInside() {
		if (!isOpen || !modal || closing) return;
		const active = document.activeElement;
		if (active && active !== document.body && modal.contains(active)) return;
		closeButton?.focus();
	}

	/**
	 * Where focus goes when there is no opener to return to (the dialog
	 * usually opens right after the sign-in redirect, with focus on the body):
	 * the page's <main>, else its first heading.
	 */
	function focusPage() {
		const target =
			document.querySelector<HTMLElement>('ix-content main') ??
			document.querySelector<HTMLElement>('main') ??
			document.querySelector<HTMLElement>('ix-content h1') ??
			document.querySelector<HTMLElement>('h1');
		if (!target) return;
		if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
		target.focus();
	}

	afterNavigate(() => {
		void tick().then(focusInside);
	});

	/** Marks what was shown seen, once per dialog; a failure only logs. */
	function markSeen() {
		const ids = shown.map((badge) => badge.id).filter((id) => !dismissed.includes(id));
		if (ids.length === 0) return;
		dismissed.push(...ids);
		fetch('/api/badges/seen', {
			method: 'POST',
			// Still sent when the link navigates or the page closes right away.
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ids })
		})
			.then((response) => {
				if (!response.ok) console.warn(`badges: marking seen failed (${response.status})`);
			})
			.catch((error: unknown) => console.warn('badges: marking seen failed', error));
	}

	function close() {
		closing = true;
		void (modal as ModalElement | undefined)?.closeModal();
	}

	function onLink() {
		markSeen();
		close();
	}

	function onClosed() {
		markSeen();
		isOpen = false;
		closing = false;
		const target = opener;
		opener = null;
		void tick().then(() => {
			if (target?.isConnected && target !== document.body) target.focus();
			else focusPage();
		});
	}
</script>

<ix-modal
	bind:this={modal}
	size="480"
	ondialogClose={onClosed}
	ondialogDismiss={onClosed}
	data-testid="new-badge-dialog"
>
	<!-- svelte-ignore a11y_unknown_aria_attribute -->
	<ix-modal-header aria-label-close-icon-button={m.badge_new_close()}>
		{m.badge_new_title({ count: shown.length })}
	</ix-modal-header>
	<ix-modal-content>
		<p class="new-badge-intro">{m.badge_new_intro()}</p>
		<ul class="new-badges">
			{#each shown as badge (badge.id)}
				<li class="new-badge" data-testid="new-badge">
					{#if badge.icon}
						<img class="new-badge-icon" src={badge.icon} alt="" width="120" height="120" />
					{:else}
						<ix-pill variant="primary" icon="trophy">
							{num(badge.milestone)}
						</ix-pill>
					{/if}
					<p class="new-badge-reward">{badgeRewardText(badge)}</p>
				</li>
			{/each}
		</ul>
	</ix-modal-content>
	<ix-modal-footer>
		<a href={resolve('/student/badges')} onclick={onLink} data-testid="new-badge-see-all">
			{m.badge_new_see_all()}
		</a>
		<ix-button bind:this={closeButton} variant="secondary" onclick={close}>
			{m.badge_new_close()}
		</ix-button>
	</ix-modal-footer>
</ix-modal>

<style>
	.new-badge-intro {
		margin: 0 0 var(--space-2);
		text-align: center;
	}
	.new-badges {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
	}
	.new-badge {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		max-width: 10rem;
		text-align: center;
	}
	.new-badge p {
		margin: 0;
	}
	.new-badge-icon {
		width: 120px;
		height: 120px;
		object-fit: contain;
	}
	.new-badge-reward {
		font-weight: 600;
	}
</style>
