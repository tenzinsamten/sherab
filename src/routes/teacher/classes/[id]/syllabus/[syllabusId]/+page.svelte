<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
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
		<ix-button
			variant="secondary"
			href={resolve('/teacher/classes/[id]/syllabus', { id: data.class.id })}
		>
			{m.syllabus_back_to_list()}
		</ix-button>
	</header>

	{#key data.syllabus.id}
		<SyllabusDetail
			syllabus={data.syllabus}
			startInEdit={data.startInEdit}
			saved={Boolean(form && 'action' in form && form.action === 'syllabusSaved')}
		/>
	{/key}
</div>
