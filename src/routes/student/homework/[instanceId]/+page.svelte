<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import HomeworkFiles from '$lib/components/HomeworkFiles.svelte';
	import MarkDoneForm from '$lib/components/MarkDoneForm.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import { isoDay } from '$lib/format';
	import { showToast } from '$lib/toast';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * One homework for the student (#43), mobile-first story 4: its class,
	 * title, skill and due date, the teacher's text and links, and the
	 * status with Mark done (asks first in an alert dialog; without
	 * JavaScript it posts directly).
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	$effect(() => {
		if (form?.success) showToast('success', m.student_homework_mark_done_success());
	});

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	// The "My homework" crumb leads back to the list the student came from
	// (To do or Done).
	let listHref = $derived(
		page.url.searchParams.get('from') === 'done'
			? `${resolve('/student/homework')}?filter=done`
			: resolve('/student/homework')
	);

	const statusClass = 'text-sm';
</script>

<svelte:head>
	<title>{data.item.title} — {m.student_homework_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[{ label: m.nav_my_homework(), href: listHref }, { label: data.item.title }]}
		/>
	</div>
	<header class={ui.header}>
		<div class="flex min-w-0 flex-col gap-2">
			<div>
				<p class={ui.kicker} data-testid="homework-class">
					{#if data.className}
						<a
							href={resolve('/student/classes/[classId]', { classId: data.item.classId })}
							class="{ui.link} inline-flex min-h-11 items-center normal-case"
						>
							{data.className}
						</a>
					{:else}
						{m.student_class_former()}
					{/if}
				</p>
				<h1 class="{ui.heading} flex flex-wrap items-center gap-2">
					<span lang={data.item.contentLanguage} class="min-w-0 wrap-break-word"
						>{data.item.title}</span
					>
					{#if data.item.isRecurring}
						<Badge variant="outline" class="text-sm font-medium">
							<RepeatIcon />
							{m.homework_recurring_badge_label()}
						</Badge>
					{/if}
				</h1>
			</div>
			<p class="{ui.muted} flex flex-wrap items-center gap-2" data-testid="homework-meta">
				<span>
					{skillLabel(data.item.skillArea)} · {m.student_homework_due_label({
						date: isoDay(data.item.dueDate)
					})}
				</span>
				{#if data.item.overdue}
					<Badge variant="alarm">{m.student_homework_overdue_label()}</Badge>
				{/if}
			</p>
		</div>
	</header>

	<section class="{ui.card} flex flex-col gap-4">
		{#if data.item.content}
			<RichText content={data.item.content} lang={data.item.contentLanguage} />
		{/if}
		<TextWithLinks
			links={data.item.referenceLinks}
			empty={data.item.content || data.files.length > 0 ? '' : m.student_homework_no_details()}
		/>
		<!-- #110: the homework's PDF files, the same on every copy. -->
		<HomeworkFiles files={data.files} />

		<div
			class="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between"
		>
			<!-- Focus lands here once Mark done is saved. -->
			<p id="homework-status" tabindex="-1" class="outline-none" data-testid="homework-status">
				{#if data.item.status === 'reviewed'}
					<Badge variant="success" class={statusClass}>{m.student_homework_status_reviewed()}</Badge
					>
				{:else if data.item.status === 'done'}
					<Badge variant="info" class={statusClass}>{m.student_homework_status_done()}</Badge>
				{:else}
					<Badge variant="secondary" class={statusClass}>
						{m.student_homework_status_assigned()}
					</Badge>
				{/if}
			</p>
			{#if data.item.status === 'assigned' && !data.archived}
				<MarkDoneForm
					instanceId={data.item.instanceId}
					title={data.item.title}
					{pending}
					class="w-full md:w-auto"
					focusAfter={() => document.getElementById('homework-status')}
				/>
			{/if}
		</div>
	</section>
</div>
