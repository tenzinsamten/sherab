<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import { showToast } from '$lib/ix';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	$effect(() => {
		if (form?.success) showToast('success', m.student_homework_mark_done_success());
	});

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	function badgeEntryLabel(badge: {
		badgeType: 'attendance' | 'homework';
		milestone: number;
	}): string {
		return badge.badgeType === 'homework'
			? m.student_badges_entry_homework({ count: badge.milestone })
			: m.student_badges_entry_attendance({ count: badge.milestone });
	}
</script>

<svelte:head>
	<title>{m.student_homework_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.student_section_label()}</p>
			<h1 class="page-heading">{m.student_homework_heading()}</h1>
		</div>
	</header>

	<div class="tile-grid" style="margin-bottom: var(--space-4);">
		<ix-card variant="outline" passive>
			<ix-card-content>
				<p class="section-label">{m.student_streak_label()}</p>
				{#if data.loadError}
					<!-- A failed fetch is unknown state, not a truthful zero: the
					     layout shows the error toast, and this tile shows no value
					     rather than the "no streak yet" copy. -->
					<p class="stat-tile-value muted">—</p>
				{:else if data.streak && data.streak.currentStreak > 0}
					<p
						class="stat-tile-value"
						aria-label={m.student_streak_aria_label({ count: data.streak.currentStreak })}
					>
						{m.student_streak_weeks({ count: data.streak.currentStreak })}
					</p>
				{:else}
					<p class="muted" style="margin:0;">{m.student_streak_empty()}</p>
				{/if}
			</ix-card-content>
		</ix-card>

		<ix-card variant="outline" passive>
			<ix-card-content>
				<p class="section-label">{m.student_badges_label()}</p>
				{#if data.loadError}
					<p class="stat-tile-value muted">—</p>
				{:else if data.badges.length > 0}
					<ul
						style="list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap: var(--space-1);"
					>
						{#each data.badges as badge (`${badge.badgeType}-${badge.milestone}`)}
							<li><ix-pill variant="primary" icon="trophy">{badgeEntryLabel(badge)}</ix-pill></li>
						{/each}
					</ul>
				{:else}
					<p class="muted" style="margin:0;">{m.student_badges_empty()}</p>
				{/if}
			</ix-card-content>
		</ix-card>
	</div>

	{#if data.items.length === 0}
		<ix-empty-state header={m.student_homework_empty()} icon="tasks-open"></ix-empty-state>
	{:else}
		<ul class="homework-list">
			{#each data.items as item (item.instanceId)}
				<li class="card">
					<p class="section-label">{skillLabel(item.skillArea)}</p>
					<h2 class="actions" style="margin: 0 0 var(--space-2);">
						{item.title}
						{#if item.isRecurring}
							<ix-pill variant="neutral" outline
								><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
							>
						{/if}
					</h2>
					<p class="actions muted" style="margin: 0 0 var(--space-2);">
						{m.student_homework_due_label({ date: item.dueDate })}
						{#if item.overdue}
							<ix-pill variant="alarm">{m.student_homework_overdue_label()}</ix-pill>
						{/if}
					</p>
					{#if item.description}
						<p class="homework-description">{item.description}</p>
					{/if}
					{#if item.referenceLinks.length > 0}
						<ul class="homework-links">
							{#each item.referenceLinks as link, i (i)}
								<li>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
									<a href={link.url} target="_blank" rel="noopener noreferrer">
										{link.label ?? m.student_homework_reference_link()}
									</a>
								</li>
							{/each}
						</ul>
					{/if}

					<div class="actions" style="justify-content:space-between;">
						{#if item.status === 'reviewed'}
							<ix-pill variant="success">{m.student_homework_status_reviewed()}</ix-pill>
						{:else if item.status === 'done'}
							<ix-pill variant="info">{m.student_homework_status_done()}</ix-pill>
						{:else}
							<ix-pill variant="neutral">{m.student_homework_status_assigned()}</ix-pill>
						{/if}

						{#if item.status === 'assigned'}
							<form method="POST" action="?/markDone" use:enhance>
								<input type="hidden" name="instanceId" value={item.instanceId} />
								<ix-button type="submit">{m.student_homework_mark_done()}</ix-button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.homework-description {
		margin: 0 0 var(--space-2);
		white-space: pre-line;
	}

	.homework-links {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-4);
	}

	.homework-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.homework-list .card + .card {
		margin-top: 0;
	}
</style>
