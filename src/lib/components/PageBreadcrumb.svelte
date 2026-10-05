<script lang="ts">
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';

	/**
	 * iX breadcrumb above a nested page's header (#61). Every level above the
	 * current page is a real link (iX renders an <a> in its shadow DOM, which
	 * routeIxLinks() hands to the SvelteKit router); the last item is the
	 * current page, which iX marks aria-current="page". On narrow screens the
	 * earlier levels collapse into iX's "…" dropdown, whose items have no
	 * href: picking one navigates through the itemClick event instead.
	 */
	type Crumb = { label: string; href?: string };
	let { items }: { items: Crumb[] } = $props();

	const NARROW = '(max-width: 640px)';
	let narrow = $state(typeof window !== 'undefined' && window.matchMedia(NARROW).matches);
	$effect(() => {
		const query = window.matchMedia(NARROW);
		narrow = query.matches;
		const onChange = (event: MediaQueryListEvent) => (narrow = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});

	let visibleCount = $derived(narrow ? 2 : 9);

	// A link-less level (the admin class name) would do nothing when picked
	// from the "…" dropdown, so on narrow screens it is left out; the last
	// item (the current page) always stays.
	let shown = $derived(
		narrow ? items.filter((item, i) => item.href || i === items.length - 1) : items
	);

	/**
	 * iX renders a crumb with an href as <a role="button">, so screen readers
	 * would announce the levels above as buttons. This gives the anchor back
	 * its link role, and again whenever iX re-renders it.
	 */
	function linkRole(node: HTMLElement) {
		let observer: MutationObserver | undefined;
		let destroyed = false;
		const fix = () => {
			const anchor = node.shadowRoot?.querySelector('a[role="button"]');
			if (anchor) anchor.removeAttribute('role');
		};
		(async () => {
			await customElements.whenDefined('ix-breadcrumb-item');
			await (
				node as HTMLElement & { componentOnReady?: () => Promise<unknown> }
			).componentOnReady?.();
			if (destroyed || !node.shadowRoot) return;
			fix();
			observer = new MutationObserver(fix);
			observer.observe(node.shadowRoot, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: ['role']
			});
		})().catch(() => undefined);
		return () => {
			destroyed = true;
			observer?.disconnect();
		};
	}

	function onItemClick(event: CustomEvent<{ breadcrumbKey?: string }>) {
		// Visible items bubble their own itemClick up from <ix-breadcrumb-item>;
		// their <a> already navigates. Only the breadcrumb's own event (a
		// collapsed item picked from the dropdown) needs handling here.
		if (event.target !== event.currentTarget) return;
		const key = event.detail?.breadcrumbKey;
		const target = items.find((item) => item.href && item.href === key);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- crumb hrefs are built with resolve() by the pages.
		if (target?.href) void goto(target.href);
	}
</script>

<!-- iX computes which items are hidden only when its children change, not
     when visible-item-count does: remount it when the screen size flips. -->
{#key visibleCount}
	<!-- svelte-ignore a11y_unknown_aria_attribute (an iX prop, the "…" button's label) -->
	<ix-breadcrumb
		class="page-breadcrumb"
		aria-label={m.breadcrumb_label()}
		aria-label-previous-button={m.breadcrumb_show_previous()}
		visible-item-count={visibleCount}
		enable-top-layer
		onitemClick={onItemClick}
	>
		<!-- Keyed by label too, so a changed label (the parent page's tab)
		     replaces the element and iX re-reads its items; the index keeps two
		     link-less items with the same label apart. -->
		{#each shown as item, i (`${i}|${item.href ?? ''}|${item.label}`)}
			<ix-breadcrumb-item
				label={item.label}
				href={item.href}
				breadcrumb-key={item.href ?? `${i}|${item.label}`}
				{@attach linkRole}
			></ix-breadcrumb-item>
		{/each}
	</ix-breadcrumb>
{/key}

<style>
	.page-breadcrumb {
		max-width: 100%;
		min-width: 0;
		/* Lines the first label up with the heading (iX pads each crumb 0.5rem). */
		margin: 0 0 var(--space-3) -0.5rem;
	}

	/* Long labels shrink with an ellipsis instead of pushing the page sideways
	   (iX gives each item a fixed 5rem minimum and no shrinking). */
	.page-breadcrumb ix-breadcrumb-item {
		flex: 0 1 auto;
		min-width: 2.5rem;
		max-width: 100%;
	}

	/* iX clips each label to a single 1.43em line, which cuts the feet of
	   Tibetan letters (drawn 1.36x, #85) the way it did on buttons (#78). A
	   crumb can be Tibetan in any interface language (a class name, a homework
	   title), so every crumb gets a taller box whose line fills it; it still
	   fits inside iX's 2.5rem breadcrumb (#86). */
	.page-breadcrumb ix-breadcrumb-item {
		height: 2.25rem;
		line-height: 2.25rem;
	}
</style>
