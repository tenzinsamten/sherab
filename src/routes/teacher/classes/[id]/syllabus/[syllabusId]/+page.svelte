<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import SyllabusDetail from '$lib/components/SyllabusDetail.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	let year = $derived(formatSchoolYear(data.syllabus.schoolYear));
</script>

<svelte:head>
	<title>{m.syllabus_year_heading({ year })} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.nav_dashboard(), href: resolve('/teacher') },
			{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
			{
				label: m.syllabus_heading(),
				href: resolve('/teacher/classes/[id]/syllabus', { id: data.class.id })
			},
			{ label: year }
		]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.syllabus_heading()} · {data.class.name}</p>
			<h1 class="page-heading" style="display:flex; align-items:center; gap: var(--space-2);">
				{m.syllabus_year_heading({ year })}
				{#if data.syllabus.schoolYear === data.currentYear}
					<ix-pill variant="success">{m.syllabus_current()}</ix-pill>
				{/if}
			</h1>
		</div>
	</header>

	{#key data.syllabus.id}
		<SyllabusDetail syllabus={data.syllabus} result={form} />
	{/key}
</div>
