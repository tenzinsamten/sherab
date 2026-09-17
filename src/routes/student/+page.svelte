<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

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

<p class="section-label">{m.student_section_label()}</p>
<h1>{m.student_homework_heading()}</h1>

<div class="card" style="margin-bottom: var(--space-4);">
	<p class="section-label" style="margin-bottom: var(--space-1);">{m.student_streak_label()}</p>
	{#if data.loadError}
		<!-- A failed student_streaks fetch is unknown state, not a truthful
		     zero -- show the same error treatment used elsewhere on this page
		     rather than the empty-state copy, which would otherwise falsely
		     imply "confirmed no streak". -->
		<p class="banner-error" role="alert">{m.load_error_generic()}</p>
	{:else if data.streak && data.streak.currentStreak > 0}
		<p
			class="stat-tile-value"
			aria-label={m.student_streak_aria_label({ count: data.streak.currentStreak })}
		>
			{m.student_streak_weeks({ count: data.streak.currentStreak })}
		</p>
	{:else}
		<p style="margin: 0; color: var(--color-muted-foreground);">{m.student_streak_empty()}</p>
	{/if}
</div>

<div class="card" style="margin-bottom: var(--space-4);">
	<p class="section-label" style="margin-bottom: var(--space-1);">{m.student_badges_label()}</p>
	{#if data.loadError}
		<!-- A failed badges_earned fetch is unknown state, not a truthful
		     empty list -- show the same error treatment used elsewhere on this
		     page rather than the empty-state copy, which would otherwise
		     falsely imply "confirmed no badges". -->
		<p class="banner-error" role="alert">{m.load_error_generic()}</p>
	{:else if data.badges.length > 0}
		<ul
			style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap: var(--space-1);"
		>
			{#each data.badges as badge (`${badge.badgeType}-${badge.milestone}`)}
				<li>{badgeEntryLabel(badge)}</li>
			{/each}
		</ul>
	{:else}
		<p style="margin: 0; color: var(--color-muted-foreground);">{m.student_badges_empty()}</p>
	{/if}
</div>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if form?.success}
	<p class="banner-success" role="status">{m.student_homework_mark_done_success()}</p>
{/if}

{#if data.items.length === 0}
	<div class="card">
		<p style="color: var(--color-muted-foreground); margin: 0;">{m.student_homework_empty()}</p>
	</div>
{:else}
	<ul
		style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap: var(--space-4);"
	>
		{#each data.items as item (item.instanceId)}
			<li class="card">
				<p class="section-label" style="margin-bottom: var(--space-1);">
					{skillLabel(item.skillArea)}
				</p>
				<h2
					style="margin: 0 0 var(--space-2) 0; font-size: var(--text-lg); display:flex; align-items:center; gap: var(--space-2);"
				>
					{item.title}
					{#if item.isRecurring}
						<span class="badge-repeat">
							<RepeatIcon />
							{m.homework_recurring_badge_label()}
						</span>
					{/if}
				</h2>
				<p style="margin: 0 0 var(--space-2) 0; color: var(--color-muted-foreground);">
					{m.student_homework_due_label({ date: item.dueDate })}
					{#if item.overdue}
						<span
							style="color: var(--color-destructive); font-weight:700; text-transform:uppercase;"
						>
							· {m.student_homework_overdue_label()}
						</span>
					{/if}
				</p>
				{#if item.referenceLink}
					<p style="margin: 0 0 var(--space-2) 0;">
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
						<a href={item.referenceLink} target="_blank" rel="noopener noreferrer">
							{m.student_homework_reference_link()}
						</a>
					</p>
				{/if}

				<p style="font-weight:700; margin: 0 0 var(--space-2) 0;">
					{#if item.status === 'reviewed'}
						{m.student_homework_status_reviewed()}
					{:else if item.status === 'done'}
						{m.student_homework_status_done()}
					{:else}
						{m.student_homework_status_assigned()}
					{/if}
				</p>

				{#if item.status === 'assigned'}
					<form method="POST" action="?/markDone" use:enhance>
						<input type="hidden" name="instanceId" value={item.instanceId} />
						<button class="btn" type="submit">{m.student_homework_mark_done()}</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
