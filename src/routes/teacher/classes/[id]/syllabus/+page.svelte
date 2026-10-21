<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import SyllabusList from '$lib/components/SyllabusList.svelte';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/** A class's syllabi, one per school year, mobile-first story 8. */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.syllabus_list_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/teacher') },
				{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
				{ label: m.syllabus_heading() }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.syllabus_heading()}</p>
			<h1 class={ui.heading}>{m.syllabus_list_heading()}</h1>
			<p class="{ui.subtitle} wrap-break-word">{data.class.name}</p>
		</div>
	</header>

	<SyllabusList
		syllabi={data.syllabi}
		currentYear={data.currentYear}
		addableYears={data.addableYears}
		hrefFor={(syllabusId) =>
			resolve('/teacher/classes/[id]/syllabus/[syllabusId]', { id: data.class.id, syllabusId })}
	/>
</div>
