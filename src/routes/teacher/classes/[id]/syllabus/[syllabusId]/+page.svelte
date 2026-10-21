<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import SyllabusDetail from '$lib/components/SyllabusDetail.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatSchoolYear } from '$lib/school-year';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/** One syllabus and its sections, mobile-first story 8. */
	let { data, form }: PageProps & { form: ActionData } = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let year = $derived(formatSchoolYear(data.syllabus.schoolYear));
</script>

<svelte:head>
	<title>{m.syllabus_year_heading({ year })} — {data.class.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
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
	</div>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class="{ui.kicker} wrap-break-word">{m.syllabus_heading()} · {data.class.name}</p>
			<h1 class="{ui.heading} flex flex-wrap items-center gap-2">
				{m.syllabus_year_heading({ year })}
				{#if data.syllabus.schoolYear === data.currentYear}
					<Badge variant="success">{m.syllabus_current()}</Badge>
				{/if}
			</h1>
		</div>
	</header>

	{#key data.syllabus.id}
		<SyllabusDetail syllabus={data.syllabus} result={form} />
	{/key}
</div>
