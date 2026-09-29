<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import SyllabusList from '$lib/components/SyllabusList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.syllabus_list_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.nav_dashboard(), href: resolve('/teacher') },
			{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
			{ label: m.syllabus_heading() }
		]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.syllabus_heading()}</p>
			<h1 class="page-heading">{m.syllabus_list_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
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
