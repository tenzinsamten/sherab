<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import { showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	type Filter = 'todo' | 'done';
	type Item = (typeof data.groups)[number]['items'][number];

	$effect(() => {
		if (form?.success) showToast('success', m.student_homework_mark_done_success());
	});

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	function badgeEntryLabel(badge: {
		badgeType: 'attendance' | 'homework';
		milestone: number;
	}): string {
		return badge.badgeType === 'homework'
			? m.student_badges_entry_homework({ count: badge.milestone })
			: m.student_badges_entry_attendance({ count: badge.milestone });
	}

	const listHref = resolve('/student');

	function pageHref(filter: Filter, pageNumber: number): string {
		const parts: string[] = [];
		if (filter !== 'todo') parts.push(`filter=${filter}`);
		if (pageNumber > 1) parts.push(`page=${pageNumber}`);
		return parts.length > 0 ? `${listHref}?${parts.join('&')}` : listHref;
	}

	function detailHref(item: Item): string {
		const href = resolve('/student/homework/[instanceId]', { instanceId: item.instanceId });
		return data.filter === 'done' ? `${href}?from=done` : href;
	}

	let filters = $derived([
		{ value: 'todo' as const, label: m.student_filter_todo({ count: data.counts.todo }) },
		{ value: 'done' as const, label: m.student_filter_done({ count: data.counts.done }) }
	]);
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

	<div class="tile-grid" style="margin-bottom: var(--space-4);">
		<ix-card variant="outline" passive>
			<ix-card-content>
				<p class="section-label">{m.student_streak_label()}</p>
				{#if data.loadError}
					<!-- A failed fetch is unknown state, not a truthful zero: the
					     layout shows the error toast, and this tile shows no value
					     rather than the "no streak yet" copy. -->
					<p class="stat-tile-value muted">—</p>
				{:else if data.streak && data.streak.currentStreak > 0}
					<p
						class="stat-tile-value"
						aria-label={m.student_streak_aria_label({ count: data.streak.currentStreak })}
					>
						{m.student_streak_weeks({ count: data.streak.currentStreak })}
					</p>
				{:else}
					<p class="muted" style="margin:0;">{m.student_streak_empty()}</p>
				{/if}
			</ix-card-content>
		</ix-card>

		<ix-card variant="outline" passive>
			<ix-card-content>
				<p class="section-label">{m.student_badges_label()}</p>
				{#if data.loadError}
					<p class="stat-tile-value muted">—</p>
				{:else if data.badges.length > 0}
					<ul
						style="list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap: var(--space-1);"
					>
						{#each data.badges as badge (`${badge.badgeType}-${badge.milestone}`)}
							<li><ix-pill variant="primary" icon="trophy">{badgeEntryLabel(badge)}</ix-pill></li>
						{/each}
					</ul>
				{:else}
					<p class="muted" style="margin:0;">{m.student_badges_empty()}</p>
				{/if}
			</ix-card-content>
		</ix-card>
	</div>

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
		<ix-empty-state
			header={data.filter === 'todo' ? m.student_no_classes() : m.student_done_empty()}
			icon="tasks-open"
		></ix-empty-state>
	{/if}

	{#each data.groups as group (group.classId)}
		<section class="card class-group">
			<div class="class-group-header">
				<h2>{group.name}</h2>
				{#if group.hasSyllabus}
					<a href={resolve('/student/classes/[classId]/syllabus', { classId: group.classId })}>
						{m.student_class_syllabus_link()}
					</a>
				{/if}
			</div>

			{#if group.items.length === 0}
				<p class="muted" style="margin:0;">{m.student_class_nothing_due()}</p>
			{:else}
				<ul class="homework-list">
					{#each group.items as item (item.instanceId)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- detailHref() builds on resolve() and only adds ?from=done. -->
							<a class="homework-row" href={detailHref(item)}>
								<span class="homework-row-title">
									{item.title}
									{#if item.isRecurring}
										<ix-pill variant="neutral" outline
											><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
										>
									{/if}
									{#if item.overdue}
										<ix-pill variant="alarm">{m.student_homework_overdue_label()}</ix-pill>
									{/if}
								</span>
								<span class="muted homework-row-meta">
									{skillLabel(item.skillArea)} · {m.student_homework_due_label({
										date: item.dueDate
									})}
								</span>
							</a>
							<div class="homework-row-side">
								{#if item.status === 'reviewed'}
									<ix-pill variant="success">{m.student_homework_status_reviewed()}</ix-pill>
								{:else if item.status === 'done'}
									<ix-pill variant="info">{m.student_homework_status_done()}</ix-pill>
								{:else}
									<form
										method="POST"
										action="?/markDone"
										use:enhance={pending.submit(`done:${item.instanceId}`)}
									>
										<input type="hidden" name="instanceId" value={item.instanceId} />
										<ix-button
											type="submit"
											variant="secondary"
											loading={pending.is(`done:${item.instanceId}`) || undefined}
											disabled={pending.busy || undefined}
										>
											{m.student_homework_mark_done()}
										</ix-button>
									</form>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}

	{#if data.filter === 'done' && data.pageCount > 1}
		<nav
			class="pager"
			aria-label={m.homework_pager_status({ page: data.page, total: data.pageCount })}
		>
			<ix-button
				variant="secondary"
				disabled={data.page <= 1 || undefined}
				href={data.page > 1 ? pageHref('done', data.page - 1) : undefined}
			>
				{m.homework_pager_prev()}
			</ix-button>
			<span class="muted"
				>{m.homework_pager_status({ page: data.page, total: data.pageCount })}</span
			>
			<ix-button
				variant="secondary"
				disabled={data.page >= data.pageCount || undefined}
				href={data.page < data.pageCount ? pageHref('done', data.page + 1) : undefined}
			>
				{m.homework_pager_next()}
			</ix-button>
		</nav>
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

	.homework-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.homework-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.homework-list li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}

	.homework-row {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		color: inherit;
		text-decoration: none;
	}

	.homework-row:hover .homework-row-title,
	.homework-row:focus-visible .homework-row-title {
		text-decoration: underline;
	}

	.homework-row-title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-weight: 700;
		font-size: var(--theme-font-size-l);
	}

	.homework-row-meta {
		font-size: var(--theme-font-size-default);
	}

	.homework-row-side {
		flex-shrink: 0;
	}

	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
</style>
