<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import CopyField from '$lib/components/CopyField.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import StudentHomeworkRows from '$lib/components/StudentHomeworkRows.svelte';
	import SyllabusFiles from '$lib/components/SyllabusFiles.svelte';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import { num } from '$lib/format';
	import { showToast } from '$lib/toast';
	import * as m from '$lib/paraglide/messages.js';
	import { formatSchoolYear } from '$lib/school-year';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * A student's class (#45, #53), mobile-first story 4: teachers and the
	 * join code (copy button), the syllabus sections with their text, links
	 * and files, the class's homework with To do / Done filter links and a
	 * pager, and the classmates. Sections stack on a phone; homework and
	 * classmates sit side by side from 80em.
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

	let classHref = $derived(resolve('/student/classes/[classId]', { classId: data.class.id }));

	function pageHref(filter: Filter, pageNumber: number): string {
		const parts: string[] = [];
		if (filter !== 'todo') parts.push(`filter=${filter}`);
		if (pageNumber > 1) parts.push(`page=${pageNumber}`);
		return parts.length > 0 ? `${classHref}?${parts.join('&')}` : classHref;
	}

	let filters = $derived([
		{ value: 'todo' as const, label: m.student_filter_todo({ count: num(data.counts.todo) }) },
		{ value: 'done' as const, label: m.student_filter_done({ count: num(data.counts.done) }) }
	]);
</script>

<svelte:head>
	<title>{data.class.name} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_my_classes(), href: resolve('/student/classes') },
				{ label: data.class.name }
			]}
		/>
	</div>
	<header class={ui.header}>
		<div class="flex min-w-0 flex-col gap-2">
			<div>
				<p class={ui.kicker}>{m.nav_my_classes()}</p>
				<h1 class={ui.heading}>{data.class.name}</h1>
			</div>
			<p class="{ui.muted} max-w-prose">
				{data.teachers.length > 0
					? m.student_class_taught_by({ names: data.teachers.map((t) => t.name).join(', ') })
					: m.student_class_no_teachers()}
			</p>
			<!-- #53: the join code, to share with someone who wants to join. -->
			<CopyField label={m.class_code_label()} value={data.class.code} />
		</div>
	</header>

	<section class={ui.card} aria-labelledby="syllabus-heading">
		<h2 id="syllabus-heading" class={ui.cardTitle}>
			{data.syllabus
				? m.student_syllabus_heading({ year: formatSchoolYear(data.syllabus.schoolYear) })
				: m.syllabus_heading()}
		</h2>
		<!-- The syllabus's sections in the teacher's order (0038), each in its own language. -->
		<div class={ui.rows}>
			{#each data.syllabus?.sections ?? [] as section (section.id)}
				<div
					class="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0"
					data-testid="syllabus-section"
				>
					<h3 lang={section.contentLanguage} class="text-lg font-bold wrap-anywhere">
						{section.title}
					</h3>
					{#if section.content}
						<RichText content={section.content} lang={section.contentLanguage} />
					{/if}
					<TextWithLinks links={section.links} />
					<SyllabusFiles files={section.files} sectionId={section.id} />
				</div>
			{:else}
				<p class={ui.muted}>{m.student_syllabus_empty()}</p>
			{/each}
		</div>
	</section>

	<div class="grid items-start gap-4 md:gap-6 xl:grid-cols-[2fr_1fr]">
		<section class={ui.card} aria-labelledby="class-homework-heading">
			<h2 id="class-homework-heading" class={ui.cardTitle}>{m.student_class_homework_heading()}</h2>
			<nav class="mb-2 flex flex-wrap gap-2" aria-label={m.student_class_homework_heading()}>
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
			{#if data.items.length === 0}
				<p class="{ui.muted} pt-2">
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

		<section class={ui.card} aria-labelledby="classmates-heading">
			<h2 id="classmates-heading" class={ui.cardTitle}>
				{m.student_classmates_heading({ count: num(data.classmates.length) })}
			</h2>
			{#if data.classmates.length === 0}
				<p class={ui.muted}>{m.student_classmates_empty()}</p>
			{:else}
				<ul class="flex flex-wrap gap-x-4 gap-y-2" data-testid="classmates">
					{#each data.classmates as person (person.id)}
						<li class="wrap-break-word">{person.name}</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
