<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { formatDay as formatIsoDay } from '$lib/format';
	import ChildPicker from '$lib/components/ChildPicker.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * #59: every approved child's open homework in one list, read-only.
	 * `?child=` narrows to one child (picker with 2 or more children). Done
	 * and Reviewed stay on each child's Homework tab, linked per child.
	 * Mobile-first story 3: each item is a stacked row (child, title, overdue
	 * pill, class and due date, links).
	 */
	let { data }: PageProps = $props();

	const pageHref = resolve('/parent/homework');

	function childHomeworkHref(childId: string): string {
		return `${resolve('/parent/children/[id]', { id: childId })}?tab=homework`;
	}

	const pickerOptions = $derived([
		{
			key: 'all',
			href: pageHref,
			label: m.calendar_all_children(),
			current: data.selectedChild === null
		},
		...data.children.map((child) => ({
			key: child.id,
			href: `${pageHref}?child=${encodeURIComponent(child.id)}`,
			label: child.name,
			current: data.selectedChild === child.id
		}))
	]);

	// Wall-clock dates: format as UTC so no time zone shifts the day (as the child page).
	const formatDay = (date: string) =>
		formatIsoDay(date, { weekday: 'short', day: 'numeric', month: 'long' });

	// Set once the page is interactive (tests wait for it before tapping).
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
</script>

<svelte:head>
	<title>{m.student_class_homework_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div>
			<p class={ui.kicker}>{m.parent_kicker()}</p>
			<h1 class={ui.heading}>{m.student_class_homework_heading()}</h1>
		</div>
	</header>

	{#if data.children.length >= 2}
		<ChildPicker label={m.parent_homework_picker_label()} options={pickerOptions} />
	{/if}

	<section
		class="{ui.card} flex flex-col gap-2"
		aria-labelledby={data.children.length > 0 ? 'open-heading' : undefined}
	>
		{#if data.loadError}
			<p class={ui.muted} role="alert">{m.load_error_generic()}</p>
		{:else if data.children.length === 0}
			<p class={ui.muted}>{m.parent_homework_no_children()}</p>
		{/if}

		{#if data.children.length > 0}
			<h2 id="open-heading" class="text-lg leading-snug font-bold">
				{m.parent_card_open()}{data.failedChildren.length > 0 ? '' : ` (${data.items.length})`}
			</h2>
			<p class="mb-1 {ui.muted}">{m.parent_homework_intro()}</p>

			{#each data.failedChildren as child (child.id)}
				<p class={ui.muted} role="alert">
					{m.parent_homework_child_error({ name: child.name })}
				</p>
			{/each}

			<!-- eslint-disable svelte/no-navigation-without-resolve -- childHomeworkHref() builds on resolve() and only adds ?tab=. -->
			{#if data.items.length === 0}
				{#if data.failedChildren.length < data.inView.length}
					<p class={ui.muted}>{m.student_homework_empty()}</p>
				{/if}
			{:else}
				<ul class={ui.rows} data-testid="homework-list">
					{#each data.items as item (`${item.childId}:${item.instanceId}`)}
						<li class="flex flex-col gap-1 py-3">
							<p class={ui.label}>{item.childName}</p>
							<p class="flex flex-wrap items-center gap-2">
								<a
									href={childHomeworkHref(item.childId)}
									class="inline-flex min-h-11 min-w-0 items-center {ui.link}"
									aria-label={m.parent_homework_row_label({
										title: item.title,
										name: item.childName
									})}
									><strong lang={item.contentLanguage} class="wrap-break-word">{item.title}</strong
									></a
								>
								{#if item.overdue}
									<Badge variant="alarm">{m.student_homework_overdue_label()}</Badge>
								{/if}
							</p>
							<p class={ui.muted}>
								{item.className ?? m.student_class_former()} · {m.student_homework_due_label({
									date: formatDay(item.dueDate)
								})}
							</p>
							{#if item.referenceLinks.length > 0}
								<ul class="list-disc pl-5 wrap-anywhere">
									{#each item.referenceLinks as link, i (i)}
										<li>
											<a href={link.url} target="_blank" rel="noopener noreferrer" class={ui.link}
												>{link.label ?? link.url}</a
											>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<p class="mt-2 flex flex-wrap items-center gap-x-1 {ui.muted}">
				<span>{m.parent_homework_history_label()}</span>
				{#each data.inView as child, i (child.id)}
					<a href={childHomeworkHref(child.id)} class="inline-flex min-h-11 items-center {ui.link}"
						>{child.name}</a
					>{i < data.inView.length - 1 ? ' · ' : ''}
				{/each}
			</p>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</section>
</div>
