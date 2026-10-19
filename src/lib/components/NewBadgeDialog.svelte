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
	import { tick, untrack } from 'svelte';
	import Trophy from '@lucide/svelte/icons/trophy';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { badgeRewardText } from '$lib/badge-subject';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';

	/**
	 * The one-time "New badge!" celebration (badge detail CAP-9). Mounted in
	 * the signed-in layout for the student role only; the layout loads
	 * `badges` (unseen, approved student only) in tile order.
	 *
	 * It opens by itself when there are badges to show. Dismissing it (Close,
	 * Escape, or the link to the badge page) marks them seen on the account;
	 * showing it does not. If marking fails the dialog still closes, and the
	 * badges show again on the next visit.
	 *
	 * Mobile-first story 4: a dialog of the new component system (portalled
	 * to the shell's `data-ui="new"` root) with the clay celebration styling.
	 * As it opens, each badge pops in over a light pink burst, once; with
	 * `prefers-reduced-motion: reduce` they show still (tailwind.css stops
	 * every animation in the new system then).
	 */
	let { badges, userId }: { badges: readonly NewBadgeView[]; userId: string } = $props();

	let isOpen = $state(false);
	let closeButton = $state<HTMLElement | null>(null);
	let content = $state<HTMLElement | null>(null);
	// What the dialog shows while open; kept so a layout reload while it is
	// open does not change it under the student.
	let shown = $state<NewBadgeView[]>([]);
	let opener: HTMLElement | null = null;
	// Set when the link closes it: the navigation decides where focus goes.
	let leaving = false;

	// The layout load does not run again on every navigation, so badges
	// dismissed in this browser session are remembered here too. Plain
	// variables: nothing is rendered from them.
	let dismissed: string[] = [];
	let dismissedOwner = '';

	function toShow(): NewBadgeView[] {
		if (dismissedOwner !== userId) {
			dismissedOwner = userId;
			dismissed = [];
		}
		return badges.filter((badge) => !dismissed.includes(badge.id));
	}

	$effect(() => {
		const next = toShow();
		if (next.length > 0 && !untrack(() => isOpen)) open(next);
	});

	function open(next: NewBadgeView[]) {
		shown = next;
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		leaving = false;
		isOpen = true;
	}

	/** Focus starts on Close (not on the first focusable, the link). */
	function onOpenAutoFocus(event: Event) {
		event.preventDefault();
		closeButton?.focus();
	}

	/**
	 * Moves focus to the Close button unless it is already in the dialog.
	 * Needed because a navigation (the redirect after sign-in) resets focus
	 * to the page after the dialog opened.
	 */
	function focusInside() {
		if (!isOpen || !content) return;
		const active = document.activeElement;
		if (active && active !== document.body && content.contains(active)) return;
		closeButton?.focus();
	}

	afterNavigate(() => {
		void tick().then(focusInside);
	});

	/**
	 * Where focus goes when there is no opener to return to (the dialog
	 * usually opens right after the sign-in redirect, with focus on the body):
	 * the page's heading, else the page content (<main>, the shell's since
	 * story 2).
	 */
	function focusPage() {
		const target =
			document.querySelector<HTMLElement>('main h1') ??
			document.querySelector<HTMLElement>('h1') ??
			document.querySelector<HTMLElement>('main');
		if (!target) return;
		if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
		target.focus();
	}

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

	/**
	 * Close or Escape: every way out marks the badges seen. A tap outside
	 * does nothing (as iX's modal), so a stray tap cannot dismiss it.
	 */
	function onOpenChange(next: boolean) {
		if (!next) markSeen();
	}

	function close() {
		markSeen();
		isOpen = false;
	}

	function onLink() {
		leaving = true;
		close();
	}

	function onCloseAutoFocus(event: Event) {
		event.preventDefault();
		const target = opener;
		opener = null;
		if (leaving) return;
		void tick().then(() => {
			if (target?.isConnected && target !== document.body) target.focus();
			else focusPage();
		});
	}
</script>

<Dialog.Root bind:open={isOpen} {onOpenChange}>
	<Dialog.Content
		bind:ref={content}
		data-testid="new-badge-dialog"
		showCloseButton={false}
		class="flex max-h-[85dvh] flex-col gap-4 overflow-hidden rounded-clay border-3 border-clay p-5 shadow-clay ring-0 sm:max-w-md sm:p-6"
		{onOpenAutoFocus}
		{onCloseAutoFocus}
		interactOutsideBehavior="ignore"
	>
		<div class="flex flex-col items-center gap-1 text-center">
			<Dialog.Title class="text-2xl font-bold text-primary">
				{m.badge_new_title({ count: shown.length })}
			</Dialog.Title>
			<Dialog.Description class="text-base">{m.badge_new_intro()}</Dialog.Description>
		</div>
		<ul class="-mx-2 flex min-h-0 flex-wrap justify-center gap-4 overflow-y-auto px-2 py-3">
			{#each shown as badge, i (badge.id)}
				{@const delay = `animation-delay: ${120 + Math.min(i, 5) * 140}ms`}
				<!-- The delay is capped: with many badges the last ones are not hidden for long. -->
				<li
					class="flex max-w-40 min-w-0 flex-col items-center gap-2 text-center"
					data-testid="new-badge"
				>
					<span class="relative grid size-32 place-items-center">
						<!-- The flourish: a pink glow and ring burst behind the badge. -->
						<span
							class="pointer-events-none absolute inset-2 rounded-full bg-celebrate/25 motion-safe:animate-badge-burst motion-reduce:hidden"
							style={delay}
							aria-hidden="true"
							data-flourish
						></span>
						<span
							class="pointer-events-none absolute inset-0 rounded-full border-4 border-celebrate/50 motion-safe:animate-badge-burst motion-reduce:hidden"
							style={delay}
							aria-hidden="true"
						></span>
						<span class="relative motion-safe:animate-badge-pop" style={delay} data-badge-icon>
							{#if badge.icon}
								<img
									src={badge.icon}
									alt=""
									width="120"
									height="120"
									class="size-30 object-contain"
								/>
							{:else}
								<Badge class="px-3 py-1 text-base">
									<Trophy aria-hidden="true" />
									{num(badge.milestone)}
								</Badge>
							{/if}
						</span>
					</span>
					<p class="font-semibold wrap-break-word">{badgeRewardText(badge)}</p>
				</li>
			{/each}
		</ul>
		<div
			class="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between"
		>
			<a
				href={resolve('/student/badges')}
				onclick={onLink}
				class="{ui.link} inline-flex min-h-11 items-center justify-center px-2 text-base"
				data-testid="new-badge-see-all"
			>
				{m.badge_new_see_all()}
			</a>
			<Button bind:ref={closeButton} variant="outline" class={ui.touch} onclick={close}>
				{m.badge_new_close()}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
