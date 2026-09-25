<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Pager from '$lib/components/Pager.svelte';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import { showToast } from '$lib/ix';
	import { formatSchoolYear } from '$lib/school-year';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	type Filter = 'todo' | 'done';

	$effect(() => {
		if (form?.success) showToast('success', m.student_homework_mark_done_success());
	});

	let classHref = $derived(resolve('/student/classes/[classId]', { classId: data.class.id }));

	function pageHref(filter: Filter, pageNumber: number): string {
		const parts: string[] = [];
		if (filter !== 'todo') parts.push(`filter=${filter}`);
		if (pageNumber > 1) parts.push(`page=${pageNumber}`);
		return parts.length > 0 ? `${classHref}?${parts.join('&')}` : classHref;
	}

	let filters = $derived([
		{ value: 'todo' as const, label: m.student_filter_todo({ count: data.counts.todo }) },
		{ value: 'done' as const, label: m.student_filter_done({ count: data.counts.done }) }
	]);
</script>

<svelte:head>
	<title>{data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.nav_my_classes()}</p>
			<h1 class="page-heading">{data.class.name}</h1>
			<p class="page-subtitle">
				{data.teachers.length > 0
					? m.student_class_taught_by({ names: data.teachers.map((t) => t.name).join(', ') })
					: m.student_class_no_teachers()}
			</p>
		</div>
		<ix-button variant="secondary" href={resolve('/student/classes')}>
			{m.student_classes_back()}
		</ix-button>
	</header>

	<section class="card">
		<h2>
			{data.syllabus
				? m.student_syllabus_heading({ year: formatSchoolYear(data.syllabus.schoolYear) })
				: m.syllabus_heading()}
		</h2>
		<TextWithLinks
			text={data.syllabus?.content ?? null}
			links={data.syllabus?.links ?? []}
			empty={m.student_syllabus_empty()}
		/>
	</section>

	<section class="card">
		<h2>{m.student_class_homework_heading()}</h2>
		<nav class="actions filter-nav" aria-label={m.student_class_homework_heading()}>
			{#each filters as f (f.value)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- pageHref() builds on resolve(). -->
				<ix-button
					variant={data.filter === f.value ? 'primary' : 'secondary'}
					href={pageHref(f.value, 1)}
					aria-current={data.filter === f.value ? 'page' : undefined}
				>
					{f.label}
				</ix-button>
			{/each}
		</nav>
		{#if data.items.length === 0}
			<p class="muted" style="margin:0;">
				{data.loadError
					? m.student_homework_load_failed()
					: data.filter === 'todo'
						? m.student_class_nothing_due()
						: m.student_done_empty()}
			</p>
		{:else}
			<StudentHomeworkRows items={data.items} fromDone={data.filter === 'done'} />
		{/if}
		{#if data.filter === 'done'}
			<Pager page={data.page} pageCount={data.pageCount} hrefFor={(n) => pageHref('done', n)} />
		{/if}
	</section>

	<section class="card">
		<h2>{m.student_classmates_heading({ count: data.classmates.length })}</h2>
		{#if data.classmates.length === 0}
			<p class="muted" style="margin:0;">{m.student_classmates_empty()}</p>
		{:else}
			<ul class="people">
				{#each data.classmates as person (person.id)}
					<li>{person.name}</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.filter-nav {
		margin-bottom: var(--space-2);
	}

	.people {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
