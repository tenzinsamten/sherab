<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import EnrollmentPanel from '$lib/components/EnrollmentPanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.enroll_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.classes_col_students()}</p>
			<h1 class="page-heading">{m.enroll_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
		</div>
		<ix-button variant="secondary" href={resolve('/admin/classes')}>
			{m.syllabus_back_to_classes()}
		</ix-button>
	</header>

	{#if data.students.length === 0}
		<ix-empty-state header={m.roster_empty()} icon="user-group"></ix-empty-state>
	{/if}

	<EnrollmentPanel
		className={data.class.name}
		students={data.students}
		enrollable={data.enrollable}
	/>
</div>
