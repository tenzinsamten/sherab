<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import BadgeCollection from '$lib/components/BadgeCollection.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/** The student's own badges (badge detail story 4), mobile-first story 4. */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.badge_page_heading_own()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/student') },
				{ label: m.badge_page_heading_own() }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.student_section_label()}</p>
			<h1 class={ui.heading}>{m.badge_page_heading_own()}</h1>
			<p class={ui.subtitle}>{m.badge_page_intro()}</p>
		</div>
	</header>

	<BadgeCollection sections={data.sections} loadError={data.loadError} />
</div>
