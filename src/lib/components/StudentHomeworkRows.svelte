<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { isoDay } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import type { ContentLanguage } from '$lib/rich-text';
	import type { SkillArea } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
	import MarkDoneForm from './MarkDoneForm.svelte';
	import RepeatIcon from './RepeatIcon.svelte';

	/**
	 * A student's homework rows (#43, #46): each opens the homework detail
	 * page; open ones have a Mark done button posting to the page's
	 * `?/markDone` action (asking first, MarkDoneForm). Used on the
	 * dashboard, My homework and class pages. Mobile-first story 4: stacked
	 * on a phone (the button full width under its row), side by side from
	 * 48em; its own `data-ui="new"` root.
	 */
	let {
		items,
		fromDone = false
	}: {
		items: {
			instanceId: string;
			title: string;
			/** Language the title is written in: selects its font (#74). */
			contentLanguage: ContentLanguage;
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

	const rowLinkId = (instanceId: string) => `homework-row-${instanceId}`;

	/**
	 * After Mark done: the row's link while the row is still listed; under
	 * To do it leaves the list, so the page heading.
	 */
	function focusTarget(instanceId: string): HTMLElement | null {
		const link = document.getElementById(rowLinkId(instanceId));
		if (link) return link;
		const heading = document.querySelector<HTMLElement>('main h1');
		if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
		return heading;
	}
</script>

<ul data-ui="new" class={ui.rows} data-testid="student-homework-list">
	{#each items as item (item.instanceId)}
		<li
			class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between md:gap-4"
			data-testid="homework-row"
			data-instance={item.instanceId}
		>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- detailHref() builds on resolve() and only adds ?from=done. -->
			<a
				id={rowLinkId(item.instanceId)}
				class="group flex min-w-0 flex-1 flex-col gap-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				href={detailHref(item.instanceId)}
			>
				<span class="flex flex-wrap items-center gap-2 text-lg font-bold">
					<span
						lang={item.contentLanguage}
						class="min-w-0 wrap-break-word group-hover:underline group-focus-visible:underline"
						>{item.title}</span
					>
					{#if item.isRecurring}
						<Badge variant="outline"><RepeatIcon /> {m.homework_recurring_badge_label()}</Badge>
					{/if}
					{#if item.overdue}
						<Badge variant="alarm">{m.student_homework_overdue_label()}</Badge>
					{/if}
				</span>
				<span class={ui.muted}>
					{skillLabel(item.skillArea)} · {m.student_homework_due_label({
						date: isoDay(item.dueDate)
					})}
				</span>
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<div class="shrink-0" data-testid="homework-status">
				{#if item.status === 'reviewed'}
					<Badge variant="success" class="text-sm">{m.student_homework_status_reviewed()}</Badge>
				{:else if item.status === 'done'}
					<Badge variant="info" class="text-sm">{m.student_homework_status_done()}</Badge>
				{:else}
					<MarkDoneForm
						instanceId={item.instanceId}
						title={item.title}
						{pending}
						variant="outline"
						class="w-full md:w-auto"
						focusAfter={() => focusTarget(item.instanceId)}
					/>
				{/if}
			</div>
		</li>
	{/each}
</ul>
