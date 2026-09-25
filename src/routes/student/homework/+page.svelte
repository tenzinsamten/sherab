<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Pager from '$lib/components/Pager.svelte';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import { showToast } from '$lib/ix';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	type Filter = 'todo' | 'done';

	$effect(() => {
		if (form?.success) showToast('success', m.student_homework_mark_done_success());
	});

	const listHref = resolve('/student/homework');

	function pageHref(filter: Filter, pageNumber: number): string {
		const parts: string[] = [];
		if (filter !== 'todo') parts.push(`filter=${filter}`);
		if (pageNumber > 1) parts.push(`page=${pageNumber}`);
		return parts.length > 0 ? `${listHref}?${parts.join('&')}` : listHref;
	}

	let filters = $derived([
		{ value: 'todo' as const, label: m.student_filter_todo({ count: data.counts.todo }) },
		{ value: 'done' as const, label: m.student_filter_done({ count: data.counts.done }) }
	]);

	let enrolledIds = $derived(new Set(data.classes.map((c) => c.id)));
</script>

<svelte:head>
	<title>{m.student_homework_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.student_section_label()}</p>
			<h1 class="page-heading">{m.student_homework_heading()}</h1>
		</div>
	</header>

	<nav class="actions filter-nav" aria-label={m.student_homework_heading()}>
		{#each filters as f (f.value)}
			<ix-button
				variant={data.filter === f.value ? 'primary' : 'secondary'}
				href={pageHref(f.value, 1)}
				aria-current={data.filter === f.value ? 'page' : undefined}
			>
				{f.label}
			</ix-button>
		{/each}
	</nav>

	{#if data.groups.length === 0}
		<!-- A failed load is unknown state, not "no classes" (#45); the layout
		     also shows the error toast. -->
		<ix-empty-state
			header={data.loadError
				? m.student_homework_load_failed()
				: data.filter === 'todo'
					? m.student_no_classes()
					: m.student_done_empty()}
			icon="tasks-open"
		></ix-empty-state>
	{/if}

	{#each data.groups as group (group.classId)}
		<section class="card class-group">
			<div class="class-group-header">
				<h2>{group.name}</h2>
				{#if enrolledIds.has(group.classId)}
					<a href={resolve('/student/classes/[classId]', { classId: group.classId })}>
						{m.student_class_open_link()}
					</a>
				{/if}
			</div>

			{#if group.items.length === 0}
				<p class="muted" style="margin:0;">{m.student_class_nothing_due()}</p>
			{:else}
				<StudentHomeworkRows items={group.items} fromDone={data.filter === 'done'} />
			{/if}
		</section>
	{/each}

	{#if data.filter === 'done'}
		<Pager page={data.page} pageCount={data.pageCount} hrefFor={(n) => pageHref('done', n)} />
	{/if}
</div>

<style>
	.filter-nav {
		margin-bottom: var(--space-4);
	}

	.class-group + .class-group {
		margin-top: var(--space-4);
	}

	.class-group-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.class-group-header h2 {
		margin: 0;
	}
</style>
