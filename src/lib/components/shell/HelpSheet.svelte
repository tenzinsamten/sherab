<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import X from '@lucide/svelte/icons/x';
	import { Dialog, Tabs } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import HelpFaq from '$lib/components/HelpFaq.svelte';
	import HelpGuide from '$lib/components/HelpGuide.svelte';
	import { helpTabLabels, type HelpRole } from '$lib/help';
	import * as m from '$lib/paraglide/messages.js';
	import { isTourRole, tourWhere } from '$lib/tours';

	/**
	 * The guides and FAQs (#87): full screen on a phone, a dialog from 48em.
	 * Opened from the Help tab (teacher, parent), the avatar menu (student)
	 * or the side nav / More sheet (admin).
	 */
	let {
		open = $bindable(false),
		helpRoles,
		role,
		hasTour,
		onReplayTour,
		onClosed
	}: {
		open?: boolean;
		/** The guides, the active role's first. */
		helpRoles: HelpRole[];
		/** The active role: only parents and teachers have tours (#101). */
		role: string | null | undefined;
		/** Whether the page behind has a tour for the active role. */
		hasTour: boolean;
		onReplayTour: () => void;
		/** The sheet has finished closing (its exit animation is over). */
		onClosed?: () => void;
	} = $props();

	// Each opening starts on the active role's guide.
	let tab = $state('');
	$effect(() => {
		if (open) tab = helpRoles[0] ?? 'faq';
	});

	const tabClass =
		'inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-accent data-[state=active]:font-semibold data-[state=active]:text-primary';
	// HelpGuide and HelpFaq carry their own styles (mobile-first story 5).
	const contentClass = 'max-w-[70ch]';
</script>

<Sheet.Root bind:open onOpenChangeComplete={(isOpen) => !isOpen && onClosed?.()}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Dialog.Content
			data-testid="help-sheet"
			class="fixed inset-0 z-50 flex h-dvh flex-col bg-popover pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-lg duration-200 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:max-h-[85dvh] md:w-[min(48rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:pt-0 md:pb-0"
		>
			<Sheet.Header class="border-b border-border py-3 pr-14 pl-4">
				<Sheet.Title class="text-lg font-semibold">{m.help_heading()}</Sheet.Title>
				<Sheet.Description class="text-sm text-muted-foreground"
					>{m.help_subtitle()}</Sheet.Description
				>
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
				{#if isTourRole(role)}
					<!-- #101: run the page's tour again, or where tours are. -->
					<div class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-4">
						{#if hasTour}
							<Button variant="outline" class="min-h-11" onclick={onReplayTour}>
								<Eye aria-hidden="true" />
								{m.tour_replay()}
							</Button>
							<p class="max-w-[70ch] text-sm text-muted-foreground">{m.tour_replay_hint()}</p>
						{:else}
							<p class="max-w-[70ch] text-sm text-muted-foreground">{tourWhere[role]()}</p>
						{/if}
					</div>
				{/if}
				<Tabs.Root bind:value={tab}>
					<Tabs.List aria-label={m.help_tabs_label()} class="mb-4 flex flex-wrap gap-1">
						{#each helpRoles as helpRole (helpRole)}
							<Tabs.Trigger value={helpRole} class={tabClass}
								>{helpTabLabels[helpRole]()}</Tabs.Trigger
							>
						{/each}
						<Tabs.Trigger value="faq" class={tabClass}>{m.help_faq_heading()}</Tabs.Trigger>
					</Tabs.List>
					{#each helpRoles as helpRole (helpRole)}
						<Tabs.Content value={helpRole} class={contentClass}>
							<HelpGuide role={helpRole} />
						</Tabs.Content>
					{/each}
					<Tabs.Content value="faq" class={contentClass}>
						<HelpFaq />
					</Tabs.Content>
				</Tabs.Root>
			</div>
			<Dialog.Close
				class="absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-2 inline-flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:top-2"
			>
				<X class="size-5" aria-hidden="true" />
				<span class="sr-only">{m.help_close()}</span>
			</Dialog.Close>
		</Dialog.Content>
	</Sheet.Portal>
</Sheet.Root>
