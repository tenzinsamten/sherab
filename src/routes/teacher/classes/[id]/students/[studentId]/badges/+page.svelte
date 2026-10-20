<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import BadgeCollection from '$lib/components/BadgeCollection.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/** A student's badges as their teacher sees them, mobile-first story 7. */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.badge_page_heading()} — {data.student.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/teacher') },
				{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
				{ label: data.student.name }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div>
			<p class="{ui.kicker} wrap-break-word">{data.class.name}</p>
			<h1 class={ui.heading}>{m.badge_page_heading_of({ name: data.student.name })}</h1>
			<p class={ui.subtitle}>{m.badge_page_intro()}</p>
		</div>
	</header>

	<BadgeCollection sections={data.sections} loadError={data.loadError} />
</div>
