<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Filter = 'open' | 'archived' | 'all';

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	let listHref = $derived(resolve('/teacher/classes/[id]/homework', { id: data.class.id }));

	function pageHref(filter: Filter, pageNumber: number): string {
		const parts: string[] = [];
		if (filter !== 'open') parts.push(`filter=${filter}`);
		if (pageNumber > 1) parts.push(`page=${pageNumber}`);
		return parts.length > 0 ? `${listHref}?${parts.join('&')}` : listHref;
	}

	let filters = $derived([
		{ value: 'open' as const, label: m.homework_filter_open({ count: data.counts.open }) },
		{
			value: 'archived' as const,
			label: m.homework_filter_archived({ count: data.counts.archived })
		},
		{ value: 'all' as const, label: m.homework_filter_all({ count: data.counts.all }) }
	]);

	let emptyText = $derived(
		data.filter === 'open'
			? m.homework_empty_open()
			: data.filter === 'archived'
				? m.homework_empty_archived()
				: m.homework_empty()
	);

	// The create page redirects here with ?created=<count|weekly>[&failed=<n>].
	// Show the toast once, then drop the params so a refresh doesn't repeat it.
	$effect(() => {
		const created = page.url.searchParams.get('created');
		if (created === null) return;
		const failed = Number(page.url.searchParams.get('failed') ?? '0');
		untrack(() => {
			if (created === 'weekly') showToast('success', m.homework_created_weekly());
			else if (failed > 0)
				showToast('error', m.homework_created_partial_count({ count: created, failed }));
			else if (created === '0') showToast('success', m.homework_created_empty());
			else showToast('success', m.homework_created_count({ count: created }));

			const url = new URL(page.url);
			url.searchParams.delete('created');
			url.searchParams.delete('failed');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes.
			replaceState(url, page.state);
		});
	});
</script>

<svelte:head>
	<title>{m.homework_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.homework_section_label()}</p>
			<h1 class="page-heading">{m.homework_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
		</div>
		<div class="actions">
			<ix-button variant="secondary" href={resolve('/teacher/classes/[id]', { id: data.class.id })}>
				{m.homework_back_to_roster()}
			</ix-button>
			<ix-button
				icon="add"
				href={resolve('/teacher/classes/[id]/homework/new', { id: data.class.id })}
			>
				{m.homework_create_button()}
			</ix-button>
		</div>
	</header>

	<nav
		class="actions"
		aria-label={m.homework_filter_label()}
		style="margin-bottom: var(--space-4);"
	>
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

	<section class="card">
		{#if data.items.length === 0}
			<p class="muted" style="margin:0;">{emptyText}</p>
		{:else}
			<ul class="homework-list">
				{#each data.items as item (item.id)}
					<li>
						<a
							class="homework-row"
							href={resolve('/teacher/classes/[id]/homework/[assignmentId]', {
								id: data.class.id,
								assignmentId: item.id
							})}
						>
							<span class="homework-row-title">
								{item.title}
								{#if item.isRecurring}
									<ix-pill variant="neutral" outline
										><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
									>
								{/if}
								{#if item.archived}
									<ix-pill variant="neutral">{m.homework_archived_label()}</ix-pill>
								{:else if item.overdue}
									<ix-pill variant="alarm">{m.homework_overdue_label()}</ix-pill>
								{/if}
							</span>
							<span class="muted homework-row-meta">
								{skillLabel(item.skillArea)}
								{#if item.nextDue}
									· {m.homework_row_due({ date: item.nextDue })}
								{/if}
								· {m.homework_row_done({ done: item.latestDone, total: item.latestTotal })}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.pageCount > 1}
		<nav
			class="pager"
			aria-label={m.homework_pager_status({ page: data.page, total: data.pageCount })}
		>
			<ix-button
				variant="secondary"
				disabled={data.page <= 1 || undefined}
				href={data.page > 1 ? pageHref(data.filter, data.page - 1) : undefined}
			>
				{m.homework_pager_prev()}
			</ix-button>
			<span class="muted"
				>{m.homework_pager_status({ page: data.page, total: data.pageCount })}</span
			>
			<ix-button
				variant="secondary"
				disabled={data.page >= data.pageCount || undefined}
				href={data.page < data.pageCount ? pageHref(data.filter, data.page + 1) : undefined}
			>
				{m.homework_pager_next()}
			</ix-button>
		</nav>
	{/if}
</div>

<style>
	.homework-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.homework-list li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}

	.homework-row {
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

	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
</style>
