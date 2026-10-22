<script lang="ts">
	import { onMount } from 'svelte';
	import Users from '@lucide/svelte/icons/users';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import CopyField from '$lib/components/CopyField.svelte';
	import EnrollmentPanel from '$lib/components/EnrollmentPanel.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/** A class's students for the admin, mobile-first story 9 (EnrollmentPanel is story 8's). */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.enroll_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_classes(), href: resolve('/admin/classes') },
				{ label: data.class.name },
				{ label: m.classes_col_students() }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div class="flex min-w-0 flex-col gap-2">
			<div>
				<p class={ui.kicker}>{m.classes_col_students()}</p>
				<h1 class={ui.heading}>{m.enroll_heading()}</h1>
				<p class="{ui.subtitle} wrap-break-word">{data.class.name}</p>
			</div>
			<CopyField label={m.class_code_label()} value={data.class.code} />
		</div>
	</header>

	{#if data.students.length === 0}
		<section class={ui.card}>
			<EmptyState header={m.roster_empty()} icon={Users} />
		</section>
	{/if}

	<EnrollmentPanel
		className={data.class.name}
		students={data.students}
		enrollable={data.enrollable}
	/>
</div>
