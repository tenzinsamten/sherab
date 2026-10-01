<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import ChildPicker from '$lib/components/ChildPicker.svelte';
	import type { PageProps } from './$types';

	/**
	 * #59: every approved child's open homework in one list, read-only.
	 * `?child=` narrows to one child (picker with 2 or more children). Done
	 * and Reviewed stay on each child's Homework tab, linked per child.
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
	function formatDay(date: string): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), {
				weekday: 'short',
				day: 'numeric',
				month: 'long',
				timeZone: 'UTC'
			}).format(new Date(`${date}T00:00:00Z`));
		} catch {
			return date;
		}
	}
</script>

<svelte:head>
	<title>{m.student_class_homework_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.parent_kicker()}</p>
			<h1 class="page-heading">{m.student_class_homework_heading()}</h1>
		</div>
	</header>

	{#if data.children.length >= 2}
		<ChildPicker label={m.parent_homework_picker_label()} options={pickerOptions} />
	{/if}

	<section class="card" aria-labelledby={data.children.length > 0 ? 'open-heading' : undefined}>
		{#if data.loadError}
			<p class="muted section-error" role="alert">{m.load_error_generic()}</p>
		{:else if data.children.length === 0}
			<p class="muted empty">{m.parent_homework_no_children()}</p>
		{/if}

		{#if data.children.length > 0}
			<h2 id="open-heading">
				{m.parent_card_open()}{data.failedChildren.length > 0 ? '' : ` (${data.items.length})`}
			</h2>
			<p class="muted intro">{m.parent_homework_intro()}</p>

			{#each data.failedChildren as child (child.id)}
				<p class="muted section-error" role="alert">
					{m.parent_homework_child_error({ name: child.name })}
				</p>
			{/each}

			<!-- eslint-disable svelte/no-navigation-without-resolve -- childHomeworkHref() builds on resolve() and only adds ?tab=. -->
			{#if data.items.length === 0}
				{#if data.failedChildren.length < data.inView.length}
					<p class="muted empty">{m.student_homework_empty()}</p>
				{/if}
			{:else}
				<ul class="plain-list">
					{#each data.items as item (`${item.childId}:${item.instanceId}`)}
						<li class="homework">
							<p class="homework-child section-label">{item.childName}</p>
							<p class="homework-title">
								<a
									href={childHomeworkHref(item.childId)}
									aria-label={m.parent_homework_row_label({
										title: item.title,
										name: item.childName
									})}><strong lang={item.contentLanguage}>{item.title}</strong></a
								>
								{#if item.overdue}
									<ix-pill variant="alarm">{m.student_homework_overdue_label()}</ix-pill>
								{/if}
							</p>
							<p class="muted homework-meta">
								{item.className ?? m.student_class_former()} · {m.student_homework_due_label({
									date: formatDay(item.dueDate)
								})}
							</p>
							{#if item.referenceLinks.length > 0}
								<ul class="links">
									{#each item.referenceLinks as link, i (i)}
										<li>
											<a href={link.url} target="_blank" rel="noopener noreferrer"
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

			<p class="muted history">
				<span>{m.parent_homework_history_label()}</span>
				{#each data.inView as child, i (child.id)}
					<a href={childHomeworkHref(child.id)}>{child.name}</a>{i < data.inView.length - 1
						? ' · '
						: ''}
				{/each}
			</p>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</section>
</div>

<style>
	h2 {
		margin: 0 0 var(--space-1);
	}

	.intro {
		margin: 0 0 var(--space-3);
	}

	.plain-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.plain-list > li {
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
	}

	.plain-list > li:last-child {
		border-bottom: none;
	}

	.empty,
	.section-error {
		margin: 0 0 var(--space-2);
	}

	.homework-child {
		margin: 0 0 var(--space-1);
	}

	.homework-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}

	.homework-meta {
		margin: var(--space-1) 0 0;
	}

	.links {
		margin: var(--space-1) 0 0;
		padding-left: var(--space-4);
		overflow-wrap: anywhere;
	}

	.history {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: var(--space-4) 0 0;
	}
</style>
