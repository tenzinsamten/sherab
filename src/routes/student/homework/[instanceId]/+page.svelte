<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { isoDay } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import { confirmWith, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

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
</script>

<svelte:head>
	<title>{data.item.title} — {m.student_homework_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[{ label: m.nav_my_homework(), href: listHref }, { label: data.item.title }]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">
				{#if data.className}
					<a href={resolve('/student/classes/[classId]', { classId: data.item.classId })}>
						{data.className}
					</a>
				{:else}
					{m.student_class_former()}
				{/if}
			</p>
			<h1 class="page-heading actions">
				<span lang={data.item.contentLanguage}>{data.item.title}</span>
				{#if data.item.isRecurring}
					<ix-pill variant="neutral" outline
						><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
					>
				{/if}
			</h1>
			<p class="page-subtitle actions">
				{skillLabel(data.item.skillArea)} · {m.student_homework_due_label({
					date: isoDay(data.item.dueDate)
				})}
				{#if data.item.overdue}
					<ix-pill variant="alarm">{m.student_homework_overdue_label()}</ix-pill>
				{/if}
			</p>
		</div>
	</header>

	<section class="card">
		{#if data.item.content}
			<RichText content={data.item.content} lang={data.item.contentLanguage} />
		{/if}
		<TextWithLinks
			links={data.item.referenceLinks}
			empty={data.item.content ? '' : m.student_homework_no_details()}
		/>

		<div class="actions status-row">
			{#if data.item.status === 'reviewed'}
				<ix-pill variant="success">{m.student_homework_status_reviewed()}</ix-pill>
			{:else if data.item.status === 'done'}
				<ix-pill variant="info">{m.student_homework_status_done()}</ix-pill>
			{:else}
				<ix-pill variant="neutral">{m.student_homework_status_assigned()}</ix-pill>
				{#if !data.archived}
					<form
						method="POST"
						action="?/markDone"
						use:enhance={pending.submit('done', {
							confirm: confirmWith(
								m.student_homework_mark_done_confirm({ title: data.item.title }),
								m.student_homework_mark_done()
							)
						})}
					>
						<input type="hidden" name="instanceId" value={data.item.instanceId} />
						<ix-button
							type="submit"
							loading={pending.is('done') || undefined}
							disabled={pending.busy || undefined}
						>
							{m.student_homework_mark_done()}
						</ix-button>
					</form>
				{/if}
			{/if}
		</div>
	</section>
</div>

<style>
	.status-row {
		justify-content: space-between;
		margin-top: var(--space-4);
	}
</style>
