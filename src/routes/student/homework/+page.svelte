<script lang="ts">
	import { onMount } from 'svelte';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import Pager from '$lib/components/Pager.svelte';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import { num } from '$lib/format';
	import { showToast } from '$lib/toast';
	import * as m from '$lib/paraglide/messages.js';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * My homework (#43), mobile-first story 4: the To do / Done filter links,
	 * then a card per class with its stacked rows; Done has a pager.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	type Filter = 'todo' | 'done';

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

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
		{ value: 'todo' as const, label: m.student_filter_todo({ count: num(data.counts.todo) }) },
		{ value: 'done' as const, label: m.student_filter_done({ count: num(data.counts.done) }) }
	]);

	let enrolledIds = $derived(new Set(data.classes.map((c) => c.id)));
</script>

<svelte:head>
	<title>{m.student_homework_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.student_section_label()}</p>
			<h1 class={ui.heading}>{m.student_homework_heading()}</h1>
		</div>
	</header>

	<nav class="flex flex-wrap gap-2" aria-label={m.student_homework_heading()}>
		{#each filters as f (f.value)}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- pageHref() builds on resolve(). -->
			<a
				href={pageHref(f.value, 1)}
				class="{ui.filter} {data.filter === f.value ? ui.filterCurrent : ui.filterOther}"
				aria-current={data.filter === f.value ? 'page' : undefined}
			>
				{f.label}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/each}
	</nav>

	{#if data.groups.length === 0}
		<!-- A failed load is unknown state, not "no classes" (#45); the layout
		     also shows the error toast. -->
		<section class={ui.card}>
			<EmptyState
				header={data.loadError
					? m.student_homework_load_failed()
					: data.filter === 'todo'
						? m.student_no_classes()
						: m.student_done_empty()}
				icon={ListTodo}
			/>
		</section>
	{/if}

	{#each data.groups as group (group.classId)}
		<section class={ui.card} aria-labelledby="group-{group.classId}" data-testid="class-group">
			<div class="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 id="group-{group.classId}" class="text-lg leading-snug font-bold wrap-break-word">
					{group.name}
				</h2>
				{#if enrolledIds.has(group.classId)}
					<a
						href={resolve('/student/classes/[classId]', { classId: group.classId })}
						class="{ui.link} inline-flex min-h-11 items-center"
					>
						{m.student_class_open_link()}
					</a>
				{/if}
			</div>

			{#if group.items.length === 0}
				<p class={ui.muted}>{m.student_class_nothing_due()}</p>
			{:else}
				<StudentHomeworkRows items={group.items} fromDone={data.filter === 'done'} />
			{/if}
		</section>
	{/each}

	{#if data.filter === 'done'}
		<Pager page={data.page} pageCount={data.pageCount} hrefFor={(n) => pageHref('done', n)} />
	{/if}
</div>
