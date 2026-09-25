<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import { showToast } from '$lib/ix';
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

	// Back to the list the student came from (To do or Done).
	let backHref = $derived(
		page.url.searchParams.get('from') === 'done'
			? `${resolve('/student')}?filter=done`
			: resolve('/student')
	);
</script>

<svelte:head>
	<title>{data.item.title} — {m.student_homework_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{data.className ?? m.student_class_former()}</p>
			<h1 class="page-heading actions">
				{data.item.title}
				{#if data.item.isRecurring}
					<ix-pill variant="neutral" outline
						><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
					>
				{/if}
			</h1>
			<p class="page-subtitle actions">
				{skillLabel(data.item.skillArea)} · {m.student_homework_due_label({
					date: data.item.dueDate
				})}
				{#if data.item.overdue}
					<ix-pill variant="alarm">{m.student_homework_overdue_label()}</ix-pill>
				{/if}
			</p>
		</div>
		<ix-button variant="secondary" href={backHref}>{m.student_homework_back()}</ix-button>
	</header>

	<section class="card">
		<TextWithLinks
			text={data.item.description}
			links={data.item.referenceLinks}
			empty={m.student_homework_no_details()}
		/>

		<div class="actions status-row">
			{#if data.item.status === 'reviewed'}
				<ix-pill variant="success">{m.student_homework_status_reviewed()}</ix-pill>
			{:else if data.item.status === 'done'}
				<ix-pill variant="info">{m.student_homework_status_done()}</ix-pill>
			{:else}
				<ix-pill variant="neutral">{m.student_homework_status_assigned()}</ix-pill>
				{#if !data.archived}
					<form method="POST" action="?/markDone" use:enhance={pending.submit('done')}>
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
