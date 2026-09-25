<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import LinkRows from '$lib/components/LinkRows.svelte';
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
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.homework_section_label()}</p>
			<h1 class="page-heading">{m.homework_create_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
		</div>
		<ix-button
			variant="secondary"
			href={resolve('/teacher/classes/[id]/homework', { id: data.class.id })}
		>
			{m.homework_back_to_list()}
		</ix-button>
	</header>

	<section class="card">
		<form method="POST" action="?/createAssignment" use:enhance={pending.submit('create')}>
			<div class="field">
				<label for="title">{m.homework_title_label()}</label>
				<input id="title" name="title" type="text" required />
			</div>
			<div class="field">
				<label for="skillArea">{m.homework_skill_area_label()}</label>
				<select id="skillArea" name="skillArea" required>
					{#each skillAreas as area (area)}
						<option value={area}>{skillLabel(area)}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="description">{m.homework_description_label()}</label>
				<textarea id="description" name="description" rows="4" maxlength="2000"></textarea>
			</div>
			<LinkRows idPrefix="create" />

			<fieldset class="check-list" style="margin-bottom: var(--space-4);">
				<legend>{m.homework_mode_legend()}</legend>
				<label
					style="display:flex; align-items:center; gap: var(--space-2); margin-bottom: var(--space-2);"
				>
					<input type="radio" name="mode" value="once" bind:group={assignmentMode} />
					{m.homework_mode_once()}
				</label>
				<label style="display:flex; align-items:center; gap: var(--space-2);">
					<input type="radio" name="mode" value="weekly" bind:group={assignmentMode} />
					{m.homework_mode_weekly()}
				</label>
			</fieldset>

			{#if assignmentMode === 'once'}
				<div class="field">
					<label for="dueDate">{m.homework_due_date_label()}</label>
					<input id="dueDate" name="dueDate" type="date" required />
				</div>

				<fieldset class="check-list" style="margin-bottom: var(--space-4);">
					<legend>{m.homework_target_legend()}</legend>
					<label
						style="display:flex; align-items:center; gap: var(--space-2); margin-bottom: var(--space-2);"
					>
						<input type="radio" name="targetMode" value="all" bind:group={targetMode} />
						{m.homework_target_all()}
					</label>
					<label
						style="display:flex; align-items:center; gap: var(--space-2); margin-bottom: var(--space-2);"
					>
						<input type="radio" name="targetMode" value="subset" bind:group={targetMode} />
						{m.homework_target_subset()}
					</label>
					{#if targetMode === 'subset'}
						<ul style="list-style:none; padding:0; margin: var(--space-2) 0 0 0;">
							{#each data.students as student (student.id)}
								<li style="padding: var(--space-1) 0;">
									<label style="display:flex; align-items:center; gap: var(--space-2);">
										<input type="checkbox" name="studentIds" value={student.id} />
										{student.displayName}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</fieldset>
			{:else}
				<div class="field">
					<label for="startDate">{m.homework_start_date_label()}</label>
					<input id="startDate" name="startDate" type="date" required />
				</div>
				<div class="field">
					<label for="dueOffsetDays">{m.homework_due_offset_label()}</label>
					<input
						id="dueOffsetDays"
						name="dueOffsetDays"
						type="number"
						inputmode="numeric"
						min="0"
						max="365"
						step="1"
						value="7"
						required
					/>
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
