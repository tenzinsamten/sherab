<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const skillAreas: SkillArea[] = ['language', 'song', 'dance'];
	let targetMode = $state<'all' | 'subset'>('all');
	let assignmentMode = $state<'once' | 'weekly'>('once');
	let creatingAssignment = $state(false);

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	function studentName(studentId: string): string {
		return data.students.find((s) => s.id === studentId)?.displayName ?? studentId;
	}

	// Single source of truth for "is this series currently inactive"
	// (review finding #8) -- reused by seriesStatusLabel() and the
	// pause/end-buttons visibility guard below, which previously
	// re-implemented this same check independently.
	function isSeriesInactive(assignment: (typeof data.assignments)[number]): boolean {
		return Boolean(assignment.pausedAt) || Boolean(assignment.endsOn && assignment.endsOn <= data.today);
	}

	function seriesStatusLabel(assignment: (typeof data.assignments)[number]): string | null {
		if (!assignment.isRecurring) return null;
		if (assignment.pausedAt) return m.homework_series_paused_label();
		if (assignment.endsOn && assignment.endsOn <= data.today) {
			return m.homework_series_ended_label({ date: assignment.endsOn });
		}
		return null;
	}
</script>

<svelte:head>
	<title>{m.homework_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<p class="section-label">{m.homework_section_label()}</p>
<h1>{m.homework_heading()}</h1>
<p>
	<a
		class="btn-outline btn"
		style="text-decoration:none;"
		href={resolve('/teacher/classes/[id]', { id: data.class.id })}>{m.homework_back_to_roster()}</a
	>
</p>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if form?.success && form.action === 'createAssignment'}
	<p class="banner-success" role="status">
		{#if form.recurring}
			{m.homework_created_recurring_success({ title: form.title })}
		{:else if form.failedStudentIds.length > 0}
			{m.homework_created_partial({
				title: form.title,
				count: form.targetCount,
				names: form.failedStudentIds.map(studentName).join(', ')
			})}
		{:else}
			{m.homework_created_success({ title: form.title, count: form.targetCount })}
		{/if}
	</p>
{/if}
{#if form?.success && form.action === 'markDone'}
	<p class="banner-success" role="status">{m.homework_mark_done_success()}</p>
{/if}
{#if form?.success && form.action === 'markReviewed'}
	<p class="banner-success" role="status">{m.homework_mark_reviewed_success()}</p>
{/if}
{#if form?.success && form.action === 'archiveInstance'}
	<p class="banner-success" role="status">{m.homework_archived_success()}</p>
{/if}
{#if form?.success && form.action === 'editSeries'}
	<p class="banner-success" role="status">{m.homework_series_edit_success()}</p>
{/if}
{#if form?.success && form.action === 'pauseSeries'}
	<p class="banner-success" role="status">{m.homework_series_paused_success()}</p>
{/if}
{#if form?.success && form.action === 'endSeries'}
	<p class="banner-success" role="status">{m.homework_series_ended_success()}</p>
{/if}

<div class="card" style="margin-bottom: var(--space-6);">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.homework_create_heading()}</h2>
	<form
		method="POST"
		action="?/createAssignment"
		use:enhance={() => {
			creatingAssignment = true;
			return async ({ update }) => {
				await update();
				creatingAssignment = false;
			};
		}}
	>
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
			<label for="referenceLink">{m.homework_reference_link_label()}</label>
			<input id="referenceLink" name="referenceLink" type="text" />
		</div>

		<fieldset
			style="border: var(--border-clay-quiet); padding: var(--space-3); margin-bottom: var(--space-4);"
		>
			<legend class="section-label" style="margin:0;">{m.homework_mode_legend()}</legend>
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

			<fieldset
				style="border: var(--border-clay-quiet); padding: var(--space-3); margin-bottom: var(--space-4);"
			>
				<legend class="section-label" style="margin:0;">{m.homework_target_legend()}</legend>
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
			<p style="color: var(--color-muted-foreground); font-size: var(--text-sm);">
				{m.homework_recurring_note()}
			</p>
		{/if}

		<button class="btn" type="submit" disabled={creatingAssignment}
			>{m.homework_create_submit()}</button
		>
	</form>
</div>

<div class="card">
	<h2 style="margin-top:0; font-size: var(--text-lg);">{m.homework_assignments_heading()}</h2>
	{#if data.assignments.length === 0}
		<p style="color: var(--color-muted-foreground); margin:0;">{m.homework_empty()}</p>
	{:else}
		<ul
			style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap: var(--space-4);"
		>
			{#each data.assignments as assignment (assignment.id)}
				<li style="border-bottom: 2px solid var(--color-border); padding-bottom: var(--space-4);">
					<div
						style="display:flex; align-items:center; justify-content:space-between; gap: var(--space-2); flex-wrap:wrap;"
					>
						<h3
							style="margin: 0; font-size: var(--text-base); display:flex; align-items:center; gap: var(--space-2);"
						>
							{assignment.title}
							{#if assignment.isRecurring}
								<span class="badge-repeat" aria-hidden="false">
									<RepeatIcon />
									{m.homework_recurring_badge_label()}
								</span>
							{/if}
						</h3>
						<span style="font-size: var(--text-sm); color: var(--color-muted-foreground);">
							{skillLabel(assignment.skillArea)}
						</span>
					</div>

					{#if assignment.referenceLink}
						<p style="margin: var(--space-1) 0;">
							<!-- eslint-disable svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
							<a
								href={assignment.referenceLink}
								target="_blank"
								rel="noopener noreferrer"
								style="font-size: var(--text-sm);"
							>
								{m.homework_reference_link_open()}
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</p>
					{/if}

					{#if seriesStatusLabel(assignment)}
						<p
							style="font-weight:700; font-size: var(--text-sm); text-transform:uppercase; margin: var(--space-1) 0;"
						>
							{seriesStatusLabel(assignment)}
						</p>
					{/if}

					{#if assignment.isRecurring}
						<details style="margin: var(--space-2) 0;">
							<summary>{m.homework_series_edit_heading()}</summary>
							<form
								method="POST"
								action="?/editSeries"
								use:enhance
								style="margin-top: var(--space-3);"
							>
								<input type="hidden" name="assignmentId" value={assignment.id} />
								<div class="field">
									<label for={`edit-title-${assignment.id}`}>{m.homework_title_label()}</label>
									<input
										id={`edit-title-${assignment.id}`}
										name="title"
										type="text"
										value={assignment.title}
										required
									/>
								</div>
								<div class="field">
									<label for={`edit-link-${assignment.id}`}
										>{m.homework_reference_link_label()}</label
									>
									<input
										id={`edit-link-${assignment.id}`}
										name="referenceLink"
										type="text"
										value={assignment.referenceLink ?? ''}
									/>
								</div>
								<div class="field">
									<label for={`edit-offset-${assignment.id}`}>{m.homework_due_offset_label()}</label
									>
									<input
										id={`edit-offset-${assignment.id}`}
										name="dueOffsetDays"
										type="number"
										inputmode="numeric"
										min="0"
										max="365"
										step="1"
										value={assignment.dueOffsetDays ?? 0}
										required
									/>
								</div>
								<button class="btn-outline btn" type="submit"
									>{m.homework_series_edit_submit()}</button
								>
							</form>

							{#if !isSeriesInactive(assignment)}
								<div style="display:flex; gap: var(--space-2); margin-top: var(--space-3);">
									<form method="POST" action="?/pauseSeries" use:enhance>
										<input type="hidden" name="assignmentId" value={assignment.id} />
										<button class="btn-outline btn" type="submit"
											>{m.homework_series_pause_action()}</button
										>
									</form>
									<form method="POST" action="?/endSeries" use:enhance>
										<input type="hidden" name="assignmentId" value={assignment.id} />
										<button class="btn-outline btn" type="submit"
											>{m.homework_series_end_action()}</button
										>
									</form>
								</div>
							{/if}
						</details>
					{/if}

					{#if assignment.instances.length === 0}
						<p
							style="color: var(--color-muted-foreground); font-size: var(--text-sm); margin: var(--space-2) 0 0 0;"
						>
							{m.homework_instances_empty()}
						</p>
					{:else}
						<table style="margin-top: var(--space-2);">
							<thead>
								<tr>
									<th>{m.homework_col_due()}</th>
									<th>{m.homework_col_done()}</th>
									<th>{m.homework_col_reviewed()}</th>
									<th>{m.homework_col_status()}</th>
								</tr>
							</thead>
							<tbody>
								{#each assignment.instances as instance (instance.id)}
									<tr>
										<td>{instance.dueDate}</td>
										<td>{instance.doneCount} / {instance.students.length}</td>
										<td>{instance.reviewedCount} / {instance.students.length}</td>
										<td>
											{#if instance.archivedAt}
												<span
													style="color: var(--color-muted-foreground); font-size: var(--text-sm); text-transform:uppercase;"
												>
													{m.homework_archived_label()}
												</span>
											{:else if instance.students.some((s) => s.overdue)}
												<span
													style="font-weight:700; font-size: var(--text-sm); text-transform:uppercase;"
												>
													{m.homework_overdue_label()}
												</span>
											{/if}
										</td>
									</tr>
									<tr>
										<td
											colspan="4"
											style="border-bottom: 2px solid var(--color-border); padding-top:0;"
										>
											<details>
												<summary>{m.homework_student_status_heading()}</summary>
												<ul style="list-style:none; padding:0; margin: var(--space-2) 0 0 0;">
													{#each instance.students as student (student.studentId)}
														<li
															style="border-bottom: 1px solid var(--color-border); padding: var(--space-2) 0;"
														>
															<div
																style="display:flex; align-items:center; justify-content:space-between; gap: var(--space-2); flex-wrap:wrap;"
															>
																<span>
																	<strong>{student.displayName}</strong>
																	—
																	{#if student.reviewedAt}
																		{m.homework_status_reviewed()}
																	{:else if student.doneAt}
																		{m.homework_status_done()}
																	{:else}
																		{m.homework_status_assigned()}
																	{/if}
																	{#if student.overdue}
																		<span style="color: var(--color-destructive); font-weight:700;">
																			· {m.homework_overdue_label()}
																		</span>
																	{/if}
																</span>
																{#if !instance.archivedAt}
																	<span style="display:flex; gap: var(--space-2);">
																		{#if !student.doneAt}
																			<form method="POST" action="?/markDone" use:enhance>
																				<input
																					type="hidden"
																					name="instanceId"
																					value={instance.id}
																				/>
																				<input
																					type="hidden"
																					name="studentId"
																					value={student.studentId}
																				/>
																				<button
																					class="btn-outline btn"
																					type="submit"
																					aria-label={m.homework_mark_done_for({
																						name: student.displayName
																					})}>{m.homework_mark_done()}</button
																				>
																			</form>
																		{/if}
																		{#if student.doneAt && !student.reviewedAt}
																			<form method="POST" action="?/markReviewed" use:enhance>
																				<input
																					type="hidden"
																					name="instanceId"
																					value={instance.id}
																				/>
																				<input
																					type="hidden"
																					name="studentId"
																					value={student.studentId}
																				/>
																				<button
																					class="btn-outline btn"
																					type="submit"
																					aria-label={m.homework_mark_reviewed_for({
																						name: student.displayName
																					})}>{m.homework_mark_reviewed()}</button
																				>
																			</form>
																		{/if}
																	</span>
																{/if}
															</div>
														</li>
													{/each}
												</ul>
												{#if !instance.archivedAt}
													<form
														method="POST"
														action="?/archiveInstance"
														use:enhance
														style="margin-top: var(--space-3);"
													>
														<input type="hidden" name="instanceId" value={instance.id} />
														<button class="btn-outline btn" type="submit"
															>{m.homework_archive_action()}</button
														>
													</form>
												{/if}
											</details>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
