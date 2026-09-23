<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
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
		return (
			Boolean(assignment.pausedAt) || Boolean(assignment.endsOn && assignment.endsOn <= data.today)
		);
	}

	function seriesStatusLabel(assignment: (typeof data.assignments)[number]): string | null {
		if (!assignment.isRecurring) return null;
		if (assignment.pausedAt) return m.homework_series_paused_label();
		if (assignment.endsOn && assignment.endsOn <= data.today) {
			return m.homework_series_ended_label({ date: assignment.endsOn });
		}
		return null;
	}

	$effect(() => {
		if (!form?.success) return;
		switch (form.action) {
			case 'createAssignment':
				if (form.recurring)
					showToast('success', m.homework_created_recurring_success({ title: form.title }));
				else if (form.failedStudentIds.length > 0)
					showToast(
						'error',
						m.homework_created_partial({
							title: form.title,
							count: form.targetCount,
							names: form.failedStudentIds.map(studentName).join(', ')
						})
					);
				else
					showToast(
						'success',
						m.homework_created_success({ title: form.title, count: form.targetCount })
					);
				break;
			case 'markDone':
				showToast('success', m.homework_mark_done_success());
				break;
			case 'markReviewed':
				showToast('success', m.homework_mark_reviewed_success());
				break;
			case 'archiveInstance':
				showToast('success', m.homework_archived_success());
				break;
			case 'editSeries':
				showToast('success', m.homework_series_edit_success());
				break;
			case 'pauseSeries':
				showToast('success', m.homework_series_paused_success());
				break;
			case 'endSeries':
				showToast('success', m.homework_series_ended_success());
				break;
		}
	});
</script>

<svelte:head>
	<title>{m.homework_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.homework_section_label()}</p>
			<h1 class="page-heading">{m.homework_heading()}</h1>
			<p class="page-subtitle">{data.class.name}</p>
		</div>
		<ix-button variant="secondary" href={resolve('/teacher/classes/[id]', { id: data.class.id })}>
			{m.homework_back_to_roster()}
		</ix-button>
	</header>

	<section class="card">
		<h2>{m.homework_create_heading()}</h2>
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

			<ix-button type="submit" disabled={creatingAssignment || undefined}
				>{m.homework_create_submit()}</ix-button
			>
		</form>
	</section>

	<section class="card">
		<h2>{m.homework_assignments_heading()}</h2>
		{#if data.assignments.length === 0}
			<p style="color: var(--theme-color-soft-text); margin:0;">{m.homework_empty()}</p>
		{:else}
			<ul
				style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap: var(--space-4);"
			>
				{#each data.assignments as assignment (assignment.id)}
					<li
						style="border-bottom: 2px solid var(--theme-color-soft-bdr); padding-bottom: var(--space-4);"
					>
						<div
							style="display:flex; align-items:center; justify-content:space-between; gap: var(--space-2); flex-wrap:wrap;"
						>
							<h3
								style="margin: 0; font-size: var(--theme-font-size-l); display:flex; align-items:center; gap: var(--space-2);"
							>
								{assignment.title}
								{#if assignment.isRecurring}
									<ix-pill variant="neutral" outline
										><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
									>
								{/if}
							</h3>
							<span
								style="font-size: var(--theme-font-size-default); color: var(--theme-color-soft-text);"
							>
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
									style="font-size: var(--theme-font-size-default);"
								>
									{m.homework_reference_link_open()}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</p>
						{/if}

						{#if seriesStatusLabel(assignment)}
							<p
								style="font-weight:700; font-size: var(--theme-font-size-default); margin: var(--space-1) 0;"
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
										<label for={`edit-offset-${assignment.id}`}
											>{m.homework_due_offset_label()}</label
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
									<ix-button variant="secondary" type="submit"
										>{m.homework_series_edit_submit()}</ix-button
									>
								</form>

								{#if !isSeriesInactive(assignment)}
									<div style="display:flex; gap: var(--space-2); margin-top: var(--space-3);">
										<form method="POST" action="?/pauseSeries" use:enhance>
											<input type="hidden" name="assignmentId" value={assignment.id} />
											<ix-button variant="secondary" type="submit"
												>{m.homework_series_pause_action()}</ix-button
											>
										</form>
										<form method="POST" action="?/endSeries" use:enhance>
											<input type="hidden" name="assignmentId" value={assignment.id} />
											<ix-button variant="secondary" type="submit"
												>{m.homework_series_end_action()}</ix-button
											>
										</form>
									</div>
								{/if}
							</details>
						{/if}

						{#if assignment.instances.length === 0}
							<p
								style="color: var(--theme-color-soft-text); font-size: var(--theme-font-size-default); margin: var(--space-2) 0 0 0;"
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
													<ix-pill variant="neutral">{m.homework_archived_label()}</ix-pill>
												{:else if instance.students.some((s) => s.overdue)}
													<ix-pill variant="alarm">{m.homework_overdue_label()}</ix-pill>
												{/if}
											</td>
										</tr>
										<tr>
											<td
												colspan="4"
												style="border-bottom: 2px solid var(--theme-color-soft-bdr); padding-top:0;"
											>
												<details>
													<summary>{m.homework_student_status_heading()}</summary>
													<ul style="list-style:none; padding:0; margin: var(--space-2) 0 0 0;">
														{#each instance.students as student (student.studentId)}
															<li
																style="border-bottom: 1px solid var(--theme-color-soft-bdr); padding: var(--space-2) 0;"
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
																			<ix-pill variant="alarm">{m.homework_overdue_label()}</ix-pill
																			>
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
																					<ix-button
																						variant="secondary"
																						type="submit"
																						aria-label={m.homework_mark_done_for({
																							name: student.displayName
																						})}>{m.homework_mark_done()}</ix-button
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
																					<ix-button
																						variant="secondary"
																						type="submit"
																						aria-label={m.homework_mark_reviewed_for({
																							name: student.displayName
																						})}>{m.homework_mark_reviewed()}</ix-button
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
															<ix-button variant="secondary" type="submit"
																>{m.homework_archive_action()}</ix-button
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
	</section>
</div>
