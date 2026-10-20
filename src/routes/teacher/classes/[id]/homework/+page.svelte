<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import { formatDay, isoDay, num } from '$lib/format';
	import { showToast } from '$lib/ix';
	import * as m from '$lib/paraglide/messages.js';
	import type { SkillArea } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * A class's homework list, mobile-first story 7b: Open / Archived / All
	 * filter links, a card of stacked whole-row links, the shared pager.
	 */
	let { data }: PageProps = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

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
		{ value: 'open' as const, label: m.homework_filter_open({ count: num(data.counts.open) }) },
		{
			value: 'archived' as const,
			label: m.homework_filter_archived({ count: num(data.counts.archived) })
		},
		{ value: 'all' as const, label: m.homework_filter_all({ count: num(data.counts.all) }) }
	]);

	let emptyText = $derived(
		data.filter === 'open'
			? m.homework_empty_open()
			: data.filter === 'archived'
				? m.homework_empty_archived()
				: m.homework_empty()
	);

	// The create page redirects here with ?created=<count>[&failed=<n>], or
	// ?created=weekly&visible=<now|tomorrow|YYYY-MM-DD> (#96: when students
	// see the first week).
	// Show the toast once, then drop the params so a refresh doesn't repeat it.
	$effect(() => {
		const created = page.url.searchParams.get('created');
		if (created === null) return;
		const failed = Number(page.url.searchParams.get('failed') ?? '0');
		untrack(() => {
			if (created === 'weekly') {
				const visible = page.url.searchParams.get('visible') ?? '';
				if (visible === 'now') showToast('success', m.homework_created_weekly_now());
				else if (/^\d{4}-\d{2}-\d{2}$/.test(visible))
					showToast('success', m.homework_created_weekly_from({ date: formatDay(visible) }));
				else if (visible === 'tomorrow') showToast('success', m.homework_created_weekly_tomorrow());
				else showToast('success', m.homework_created_weekly());
			} else if (failed > 0)
				showToast(
					'error',
					m.homework_created_partial_count({ count: num(created), failed: num(failed) })
				);
			else if (created === '0') showToast('success', m.homework_created_empty());
			else showToast('success', m.homework_created_count({ count: num(created) }));

			const url = new URL(page.url);
			url.searchParams.delete('created');
			url.searchParams.delete('failed');
			url.searchParams.delete('visible');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes.
			replaceState(url, page.state);
		});
	});
</script>

<svelte:head>
	<title>{m.homework_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/teacher') },
				{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
				{ label: m.homework_heading() }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.homework_section_label()}</p>
			<h1 class={ui.heading}>{m.homework_heading()}</h1>
			<p class="{ui.subtitle} wrap-break-word">{data.class.name}</p>
		</div>
		<Button
			href={resolve('/teacher/classes/[id]/homework/new', { id: data.class.id })}
			class="{ui.touch} w-full gap-2 sm:w-auto"
			data-tour="homework-create"
		>
			<Plus aria-hidden="true" />
			{m.homework_create_button()}
		</Button>
	</header>

	<nav
		class="flex flex-wrap gap-2"
		aria-label={m.homework_filter_label()}
		data-tour="homework-filter"
	>
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

	<section class={ui.card}>
		{#if data.items.length === 0}
			<p class={ui.muted}>{emptyText}</p>
		{:else}
			<ul class={ui.rows}>
				{#each data.items as item, i (item.id)}
					<li data-testid="homework-row" data-tour={i === 0 ? 'homework-row' : undefined}>
						<a
							class="group flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-lg py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							href={resolve('/teacher/classes/[id]/homework/[assignmentId]', {
								id: data.class.id,
								assignmentId: item.id
							})}
						>
							<span class="flex flex-wrap items-center gap-2 text-lg font-bold">
								<span
									lang={item.contentLanguage}
									class="min-w-0 wrap-break-word group-hover:underline group-focus-visible:underline"
									data-testid="homework-row-title">{item.title}</span
								>
								{#if item.isRecurring}
									<Badge variant="outline"
										><RepeatIcon /> {m.homework_recurring_badge_label()}</Badge
									>
								{/if}
								{#if item.archived}
									<Badge variant="secondary">{m.homework_archived_label()}</Badge>
								{:else if item.overdue}
									<Badge variant="alarm">{m.homework_overdue_label()}</Badge>
								{/if}
							</span>
							<span class="{ui.muted} wrap-break-word">
								{skillLabel(item.skillArea)}
								{#if item.nextDue}
									· {m.homework_row_due({ date: isoDay(item.nextDue) })}
								{/if}
								· {m.homework_row_done({
									done: num(item.latestDone),
									total: num(item.latestTotal)
								})}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<Pager page={data.page} pageCount={data.pageCount} hrefFor={(n) => pageHref(data.filter, n)} />
</div>
