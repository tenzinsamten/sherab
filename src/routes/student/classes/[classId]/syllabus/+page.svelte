<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.syllabus_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{data.class.name}</p>
			<h1 class="page-heading">
				{data.syllabus
					? m.student_syllabus_heading({ year: formatSchoolYear(data.syllabus.schoolYear) })
					: m.syllabus_heading()}
			</h1>
		</div>
		<ix-button variant="secondary" href={resolve('/student')}>
			{m.student_homework_back()}
		</ix-button>
	</header>

	<section class="card">
		<TextWithLinks
			text={data.syllabus?.content ?? null}
			links={data.syllabus?.links ?? []}
			empty={m.student_syllabus_empty()}
		/>
	</section>
</div>
