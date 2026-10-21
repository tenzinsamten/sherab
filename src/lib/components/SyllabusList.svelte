<script lang="ts">
	import { num } from '$lib/format';
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { createPending } from '$lib/pending.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import { ui } from '$lib/ui/classes';

	/**
	 * A class's syllabi, one per school year (#37), each with how many
	 * sections it has, plus the add form (posts
	 * `schoolYear` to `?/create`). Used by the teacher and admin syllabus
	 * pages; `hrefFor` builds each row's already-resolved detail link.
	 * Mobile-first story 8: its own `data-ui="new"` root, so it also works on
	 * the admin syllabus page, which is still iX; the year is a native select.
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
			sections: unknown[];
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

<div data-ui="new" class="flex min-w-0 flex-col gap-4 md:gap-6">
	<section class={ui.card}>
		{#if syllabi.length === 0}
			<p class={ui.muted}>{m.syllabus_empty()}</p>
		{:else}
			<ul class="{ui.rows} -my-2">
				{#each syllabi as s (s.id)}
					<li>
						<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefFor returns a resolve()d route. -->
						<a
							class="group flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-lg py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							href={hrefFor(s.id)}
							data-testid="syllabus-row"
						>
							<span
								class="flex flex-wrap items-center gap-2 text-lg font-bold wrap-break-word group-hover:underline"
							>
								{formatSchoolYear(s.schoolYear)}
								{#if s.schoolYear === currentYear}
									<Badge variant="success">{m.syllabus_current()}</Badge>
								{/if}
							</span>
							<span class={ui.muted}>
								{s.sections.length > 0
									? m.syllabus_section_count({ count: num(s.sections.length) })
									: m.syllabus_section_none()}
							</span>
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class={ui.card}>
		<h2 class={ui.cardTitle}>{m.syllabus_add_heading()}</h2>
		{#if addableYears.length === 0}
			<p class={ui.muted}>{m.syllabus_all_years_taken()}</p>
		{:else}
			<form
				method="POST"
				action="?/create"
				use:enhance={pending.submit('create')}
				class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end"
			>
				<div class="flex min-w-0 flex-col gap-1.5 sm:flex-1">
					<Label for="schoolYear">{m.syllabus_year_label()}</Label>
					<NativeSelect.Root id="schoolYear" name="schoolYear" class="w-full" required>
						{#each addableYears as year (year)}
							<NativeSelect.Option value={String(year)} selected={year === initialYear}
								>{formatSchoolYear(year)}</NativeSelect.Option
							>
						{/each}
					</NativeSelect.Root>
				</div>
				<Button
					type="submit"
					class="{ui.touch} w-full gap-2 sm:w-auto"
					aria-busy={pending.is('create') || undefined}
					disabled={pending.busy}
				>
					{#if pending.is('create')}
						<LoaderCircle class="animate-spin" aria-hidden="true" />
					{:else}
						<Plus aria-hidden="true" />
					{/if}
					{m.syllabus_add_submit()}
				</Button>
			</form>
		{/if}
	</section>
</div>
