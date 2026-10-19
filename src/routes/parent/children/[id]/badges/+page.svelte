<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import BadgeCollection from '$lib/components/BadgeCollection.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Set once the page is interactive (tests wait for it before tapping).
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.badge_page_heading()} — {data.child.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/parent') },
				{ label: data.child.name, href: resolve('/parent/children/[id]', { id: data.child.id }) },
				{ label: m.badge_page_heading() }
			]}
		/>
		<header class={ui.header}>
			<div class="min-w-0">
				<p class={ui.kicker}>{m.parent_kicker()}</p>
				<h1 class={ui.heading}>{m.badge_page_heading_of({ name: data.child.name })}</h1>
				<p class={ui.subtitle}>{m.badge_page_intro()}</p>
			</div>
		</header>
	</div>

	<BadgeCollection sections={data.sections} loadError={data.loadError} />
</div>
