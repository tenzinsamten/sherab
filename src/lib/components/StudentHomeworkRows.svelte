<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import RepeatIcon from './RepeatIcon.svelte';

	/**
	 * A student's homework rows (#43, #46): each opens the homework detail
	 * page; open ones have a Mark done button posting to the page's
	 * `?/markDone` action. Used on the dashboard, My homework and class pages.
	 */
	let {
		items,
		fromDone = false
	}: {
		items: {
			instanceId: string;
			title: string;
			skillArea: SkillArea;
			dueDate: string;
			status: 'assigned' | 'done' | 'reviewed';
			overdue: boolean;
			isRecurring: boolean;
		}[];
		/** Rows listed under Done: the detail page's back link returns there. */
		fromDone?: boolean;
	} = $props();

	const pending = createPending();

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	function detailHref(instanceId: string): string {
		const href = resolve('/student/homework/[instanceId]', { instanceId });
		return fromDone ? `${href}?from=done` : href;
	}
</script>

<ul class="homework-list">
	{#each items as item (item.instanceId)}
		<li>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- detailHref() builds on resolve() and only adds ?from=done. -->
			<a class="homework-row" href={detailHref(item.instanceId)}>
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
					{skillLabel(item.skillArea)} · {m.student_homework_due_label({ date: item.dueDate })}
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

<style>
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
</style>
