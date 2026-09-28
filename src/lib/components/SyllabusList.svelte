<script lang="ts">
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import type { HomeworkReferenceLink } from '$lib/supabase/database.types';

	/**
	 * A class's syllabi, one per school year (#37), plus the add form (posts
	 * `schoolYear` to `?/create`). Used by the teacher and admin syllabus
	 * pages; `hrefFor` builds each row's already-resolved detail link.
	 */
	let {
		syllabi,
		currentYear,
		addableYears,
		hrefFor
	}: {
		syllabi: {
			id: string;
			schoolYear: number;
			content: string | null;
			links: HomeworkReferenceLink[];
		}[];
		currentYear: number;
		addableYears: number[];
		hrefFor: (syllabusId: string) => string;
	} = $props();

	const pending = createPending();

	// Preselect the current school year, else the first one (as a native
	// <select> would), so the required field is never empty.
	let initialYear = $derived(
		addableYears.includes(currentYear) ? currentYear : (addableYears[0] ?? currentYear)
	);

	function firstLine(text: string | null): string {
		return (
			(text ?? '')
				.split('\n')
				.find((l) => l.trim())
				?.trim() ?? ''
		);
	}

	// A delete redirects here with ?deleted=<year>: show the toast once.
	$effect(() => {
		const deleted = page.url.searchParams.get('deleted');
		if (deleted === null) return;
		untrack(() => {
			showToast('success', m.syllabus_deleted({ year: formatSchoolYear(Number(deleted)) }));
			const url = new URL(page.url);
			url.searchParams.delete('deleted');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes.
			replaceState(url, page.state);
		});
	});
</script>

<section class="card">
	{#if syllabi.length === 0}
		<p class="muted" style="margin:0;">{m.syllabus_empty()}</p>
	{:else}
		<ul class="syllabus-list">
			{#each syllabi as s (s.id)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- hrefFor returns a resolve()d route. -->
					<a class="syllabus-row" href={hrefFor(s.id)}>
						<span class="syllabus-row-title">
							{formatSchoolYear(s.schoolYear)}
							{#if s.schoolYear === currentYear}
								<ix-pill variant="success">{m.syllabus_current()}</ix-pill>
							{/if}
						</span>
						<span class="muted">
							{s.links.length > 0
								? m.syllabus_links_count({ count: s.links.length })
								: m.syllabus_no_links()}
							{#if firstLine(s.content)}
								· {firstLine(s.content)}
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>{m.syllabus_add_heading()}</h2>
	{#if addableYears.length === 0}
		<p class="muted" style="margin:0;">{m.syllabus_all_years_taken()}</p>
	{:else}
		<form
			method="POST"
			action="?/create"
			use:enhance={pending.submit('create')}
			class="actions"
			style="align-items:flex-end;"
		>
			<div class="field" style="margin:0;">
				<!-- Remounted when the preselected year changes: <ix-select> takes its
				     form value only when it loads. -->
				{#key initialYear}
					<ix-select
						id="schoolYear"
						name="schoolYear"
						label={m.syllabus_year_label()}
						required
						value={String(initialYear)}
					>
						{#each addableYears as year (year)}
							<ix-select-item value={String(year)} label={formatSchoolYear(year)}></ix-select-item>
						{/each}
					</ix-select>
				{/key}
			</div>
			<ix-button
				type="submit"
				icon="add"
				loading={pending.is('create') || undefined}
				disabled={pending.busy || undefined}>{m.syllabus_add_submit()}</ix-button
			>
		</form>
	{/if}
</section>

<style>
	.syllabus-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.syllabus-list li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}

	.syllabus-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		color: inherit;
		text-decoration: none;
	}

	.syllabus-row:hover .syllabus-row-title,
	.syllabus-row:focus-visible .syllabus-row-title {
		text-decoration: underline;
	}

	.syllabus-row-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 700;
		font-size: var(--theme-font-size-l);
	}
</style>
