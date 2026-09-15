<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const skillAreas: SkillArea[] = ['language', 'song', 'dance'];
	let targetMode = $state<'all' | 'subset'>('all');
	let creatingAssignment = $state(false);

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	function studentName(studentId: string): string {
		return data.students.find((s) => s.id === studentId)?.displayName ?? studentId;
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
		{form.failedStudentIds.length > 0
			? m.homework_created_partial({
					title: form.title,
					count: form.targetCount,
					names: form.failedStudentIds.map(studentName).join(', ')
				})
			: m.homework_created_success({ title: form.title, count: form.targetCount })}
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
			<label for="dueDate">{m.homework_due_date_label()}</label>
			<input id="dueDate" name="dueDate" type="date" required />
		</div>
		<div class="field">
			<label for="referenceLink">{m.homework_reference_link_label()}</label>
			<input id="referenceLink" name="referenceLink" type="text" />
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
		<table>
			<thead>
				<tr>
					<th>{m.homework_col_title()}</th>
					<th>{m.homework_col_skill()}</th>
					<th>{m.homework_col_due()}</th>
					<th>{m.homework_col_done()}</th>
					<th>{m.homework_col_reviewed()}</th>
					<th>{m.homework_col_status()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.assignments as assignment (assignment.id)}
					<tr>
						<td>
							{assignment.title}
							{#if assignment.referenceLink}
								<br />
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
							{/if}
						</td>
						<td>{skillLabel(assignment.skillArea)}</td>
						<td>{assignment.dueDate ?? '—'}</td>
						<td>{assignment.doneCount} / {assignment.students.length}</td>
						<td>{assignment.reviewedCount} / {assignment.students.length}</td>
						<td>
							{#if assignment.archivedAt}
								<span
									style="color: var(--color-muted-foreground); font-size: var(--text-sm); text-transform:uppercase;"
								>
									{m.homework_archived_label()}
								</span>
							{:else if assignment.students.some((s) => s.overdue)}
								<span style="font-weight:700; font-size: var(--text-sm); text-transform:uppercase;">
									{m.homework_overdue_label()}
								</span>
							{/if}
						</td>
					</tr>
					<tr>
						<td colspan="6" style="border-bottom: 2px solid var(--color-border); padding-top:0;">
							<details>
								<summary>{m.homework_student_status_heading()}</summary>
								<ul style="list-style:none; padding:0; margin: var(--space-2) 0 0 0;">
									{#each assignment.students as student (student.studentId)}
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
												{#if !assignment.archivedAt}
													<span style="display:flex; gap: var(--space-2);">
														{#if !student.doneAt}
															<form method="POST" action="?/markDone" use:enhance>
																<input
																	type="hidden"
																	name="instanceId"
																	value={assignment.instanceId}
																/>
																<input type="hidden" name="studentId" value={student.studentId} />
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
																	value={assignment.instanceId}
																/>
																<input type="hidden" name="studentId" value={student.studentId} />
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
								{#if !assignment.archivedAt}
									<form
										method="POST"
										action="?/archiveInstance"
										use:enhance
										style="margin-top: var(--space-3);"
									>
										<input type="hidden" name="instanceId" value={assignment.instanceId} />
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
</div>
