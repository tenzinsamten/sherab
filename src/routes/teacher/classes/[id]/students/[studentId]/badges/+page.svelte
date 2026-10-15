<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import BadgeCollection from '$lib/components/BadgeCollection.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.badge_page_heading()} — {data.student.name} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.nav_dashboard(), href: resolve('/teacher') },
			{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
			{ label: data.student.name }
		]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">{data.class.name}</p>
			<h1 class="page-heading">{m.badge_page_heading_of({ name: data.student.name })}</h1>
			<p class="page-subtitle">{m.badge_page_intro()}</p>
		</div>
	</header>

	<BadgeCollection sections={data.sections} loadError={data.loadError} />
</div>
