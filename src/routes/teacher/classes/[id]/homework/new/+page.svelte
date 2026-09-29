<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import LinkRows from '$lib/components/LinkRows.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import { ixValue } from '$lib/ix-fields';
	import { createPending } from '$lib/pending.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const skillAreas: SkillArea[] = ['language', 'song', 'dance'];
	let targetMode = $state<'all' | 'subset'>('all');
	let assignmentMode = $state<'once' | 'weekly'>('once');
	// Success redirects to the list, which shows the toast; errors come from
	// the root layout's form-error toast.
	const pending = createPending();

	// <ix-radio-group> emits valueChange but doesn't update its own `value`:
	// the state here drives it (and which fields show).
	function pickMode(event: CustomEvent<string>) {
		if (event.detail === 'once' || event.detail === 'weekly') assignmentMode = event.detail;
	}
	function pickTarget(event: CustomEvent<string>) {
		if (event.detail === 'all' || event.detail === 'subset') targetMode = event.detail;
	}

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}
</script>

<svelte:head>
	<title>{m.homework_create_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.nav_dashboard(), href: resolve('/teacher') },
			{ label: data.class.name, href: resolve('/teacher/classes/[id]', { id: data.class.id }) },
			{
				label: m.homework_heading(),
				href: resolve('/teacher/classes/[id]/homework', { id: data.class.id })
			},
			{ label: m.breadcrumb_new_homework() }
		]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.homework_section_label()}</p>
			<h1 class="page-heading">{m.homework_create_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
		</div>
	</header>

	<section class="card">
		<form method="POST" action="?/createAssignment" use:enhance={pending.submit('create')}>
			<div class="field">
				<ix-input id="title" name="title" label={m.homework_title_label()} required></ix-input>
			</div>
			<div class="field">
				<ix-select
					id="skillArea"
					name="skillArea"
					label={m.homework_skill_area_label()}
					required
					{@attach ixValue(skillAreas[0])}
				>
					{#each skillAreas as area (area)}
						<ix-select-item value={area} label={skillLabel(area)}></ix-select-item>
					{/each}
				</ix-select>
			</div>
			<div class="field">
				<ix-textarea
					id="description"
					name="description"
					label={m.homework_description_label()}
					textarea-rows="4"
					max-length="2000"
					resize-behavior="vertical"
				></ix-textarea>
			</div>
			<LinkRows idPrefix="create" />

			<div class="field">
				<ix-radio-group
					id="mode"
					label={m.homework_mode_legend()}
					value={assignmentMode}
					onvalueChange={pickMode}
				>
					<ix-radio name="mode" value="once" label={m.homework_mode_once()}></ix-radio>
					<ix-radio name="mode" value="weekly" label={m.homework_mode_weekly()}></ix-radio>
				</ix-radio-group>
			</div>

			{#if assignmentMode === 'once'}
				<div class="field">
					<ix-date-input
						id="dueDate"
						name="dueDate"
						label={m.homework_due_date_label()}
						format="yyyy-MM-dd"
						required
					></ix-date-input>
				</div>

				<div class="field">
					<ix-radio-group
						id="targetMode"
						label={m.homework_target_legend()}
						value={targetMode}
						onvalueChange={pickTarget}
					>
						<ix-radio name="targetMode" value="all" label={m.homework_target_all()}></ix-radio>
						<ix-radio name="targetMode" value="subset" label={m.homework_target_subset()}
						></ix-radio>
					</ix-radio-group>
				</div>
				{#if targetMode === 'subset'}
					<fieldset class="check-list student-list">
						<legend class="sr-only">{m.homework_target_subset()}</legend>
						{#each data.students as student (student.id)}
							<ix-checkbox name="studentIds" value={student.id} label={student.displayName}
							></ix-checkbox>
						{/each}
					</fieldset>
				{/if}
			{:else}
				<div class="field">
					<ix-date-input
						id="startDate"
						name="startDate"
						label={m.homework_start_date_label()}
						format="yyyy-MM-dd"
						required
					></ix-date-input>
				</div>
				<div class="field">
					<ix-number-input
						id="dueOffsetDays"
						name="dueOffsetDays"
						label={m.homework_due_offset_label()}
						min="0"
						max="365"
						step="1"
						required
						{@attach ixValue(7)}
					></ix-number-input>
				</div>
				<p style="color: var(--theme-color-soft-text); font-size: var(--theme-font-size-default);">
					{m.homework_recurring_note()}
				</p>
			{/if}

			<ix-button
				type="submit"
				loading={pending.is('create') || undefined}
				disabled={pending.busy || undefined}>{m.homework_create_submit()}</ix-button
			>
		</form>
	</section>
</div>

<style>
	.student-list {
		margin-bottom: var(--space-4);
	}
	/* Whole label row is the click target (WCAG 2.2 target size). */
	.student-list ix-checkbox {
		min-height: 2.25rem;
	}
</style>
