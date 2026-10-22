<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * Story 11: the loading bar at the top of the screen while SvelteKit
	 * navigates or a page action runs (the root layout decides `busy`). It
	 * shows only once `busy` has lasted 150 ms, so fast navigations don't
	 * flash; `shown` is bindable so the layout's fade of <main> uses the same
	 * delay. A new busy period restarts the delay. Indeterminate (SvelteKit
	 * reports no progress); a static fill under reduced motion. Above the
	 * header and bottom nav (z-40), below dialogs (z-50); never takes taps.
	 */
	let { busy, shown = $bindable(false) }: { busy: boolean; shown?: boolean } = $props();

	const DELAY_MS = 150;

	$effect(() => {
		if (!busy) {
			shown = false;
			return;
		}
		const timer = setTimeout(() => (shown = true), DELAY_MS);
		return () => clearTimeout(timer);
	});
</script>

<div data-ui="new" class="pointer-events-none fixed inset-x-0 top-0 z-[45]">
	{#if shown}
		<div class="pt-[env(safe-area-inset-top)]" data-testid="nav-progress">
			<div class="h-[3px] w-full overflow-hidden">
				<div
					class="h-full w-full bg-primary motion-safe:w-1/3 motion-safe:animate-nav-progress"
					data-testid="nav-progress-fill"
				></div>
			</div>
		</div>
	{/if}
	<p class="sr-only" aria-live="polite">{shown ? m.common_loading() : ''}</p>
</div>
