<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import CopyField from '$lib/components/CopyField.svelte';
	import EnrollmentPanel from '$lib/components/EnrollmentPanel.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.enroll_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.nav_classes(), href: resolve('/admin/classes') },
			{ label: data.class.name },
			{ label: m.classes_col_students() }
		]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.classes_col_students()}</p>
			<h1 class="page-heading">{m.enroll_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
			<CopyField label={m.class_code_label()} value={data.class.code} />
		</div>
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
