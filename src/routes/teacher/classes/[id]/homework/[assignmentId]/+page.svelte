<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import LinkRows from '$lib/components/LinkRows.svelte';
	import RepeatIcon from '$lib/components/RepeatIcon.svelte';
	import { createPending } from '$lib/pending.svelte';
	import type { SkillArea } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();
	let assignment = $derived(data.assignment);

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	// Single source of truth for "is this series currently inactive"
	// (review finding #8), reused by seriesStatusLabel() and the pause/end
	// buttons' visibility guard.
	function isSeriesInactive(a: typeof data.assignment): boolean {
		return Boolean(a.pausedAt) || Boolean(a.endsOn && a.endsOn <= data.today);
	}

	function seriesStatusLabel(a: typeof data.assignment): string | null {
		if (!a.isRecurring) return null;
		if (a.pausedAt) return m.homework_series_paused_label();
		if (a.endsOn && a.endsOn <= data.today) {
			return m.homework_series_ended_label({ date: a.endsOn });
		}
		return null;
	}

	// Only shows toasts: it must not write any state it reads (#30).
	$effect(() => {
		if (!form?.success) return;
		switch (form.action) {
			case 'markDone':
				showToast('success', m.homework_mark_done_success());
				break;
			case 'markReviewed':
				showToast('success', m.homework_mark_reviewed_success());
				break;
			case 'archiveInstance':
				showToast('success', m.homework_archived_success());
				break;
			case 'editAssignment':
				showToast('success', m.homework_edit_success());
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
	<title>{assignment.title} — {m.homework_heading()} — {data.class.name} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.homework_section_label()} · {skillLabel(assignment.skillArea)}</p>
			<h1 class="page-heading" style="display:flex; align-items:center; gap: var(--space-2);">
				{assignment.title}
				{#if assignment.isRecurring}
					<ix-pill variant="neutral" outline
						><RepeatIcon /> {m.homework_recurring_badge_label()}</ix-pill
					>
				{/if}
			</h1>
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
		{#if assignment.description}
			<p class="homework-description">{assignment.description}</p>
		{/if}

		{#if assignment.referenceLinks.length > 0}
			<ul class="homework-links">
				{#each assignment.referenceLinks as link, i (i)}
					<li>
						<!-- eslint-disable svelte/no-navigation-without-resolve -- external teacher-supplied URL, not an internal route (Boundaries: no URL validation, opens externally). -->
						<a href={link.url} target="_blank" rel="noopener noreferrer">
							{link.label ?? link.url}
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
		{/if}

		{#if seriesStatusLabel(assignment)}
			<p
				style="font-weight:700; font-size: var(--theme-font-size-default); margin: var(--space-1) 0;"
			>
				{seriesStatusLabel(assignment)}
			</p>
		{/if}

		<details style="margin: var(--space-2) 0;">
			<summary>{m.homework_edit_heading()}</summary>
			<form
				method="POST"
				action="?/editAssignment"
				use:enhance={pending.submit('edit')}
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
					<label for={`edit-description-${assignment.id}`}>{m.homework_description_label()}</label>
					<textarea
						id={`edit-description-${assignment.id}`}
						name="description"
						rows="4"
						maxlength="2000"
						value={assignment.description ?? ''}></textarea>
				</div>
				<LinkRows idPrefix={`edit-${assignment.id}`} links={assignment.referenceLinks} />
				{#if assignment.isRecurring}
					<div class="field">
						<label for={`edit-offset-${assignment.id}`}>{m.homework_due_offset_label()}</label>
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
				{/if}
				<ix-button
					variant="secondary"
					type="submit"
					loading={pending.is('edit') || undefined}
					disabled={pending.busy || undefined}>{m.homework_edit_submit()}</ix-button
				>
			</form>

			{#if assignment.isRecurring && !isSeriesInactive(assignment)}
				<div style="display:flex; gap: var(--space-2); margin-top: var(--space-3);">
					<form method="POST" action="?/pauseSeries" use:enhance={pending.submit('pause')}>
						<input type="hidden" name="assignmentId" value={assignment.id} />
						<ix-button
							variant="secondary"
							type="submit"
							loading={pending.is('pause') || undefined}
							disabled={pending.busy || undefined}>{m.homework_series_pause_action()}</ix-button
						>
					</form>
					<form method="POST" action="?/endSeries" use:enhance={pending.submit('end')}>
						<input type="hidden" name="assignmentId" value={assignment.id} />
						<ix-button
							variant="secondary"
							type="submit"
							loading={pending.is('end') || undefined}
							disabled={pending.busy || undefined}>{m.homework_series_end_action()}</ix-button
						>
					</form>
				</div>
			{/if}
		</details>

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
									{#if instance.students.length === 0 && assignment.wholeClass}
										<p class="muted" style="margin: var(--space-2) 0 0 0;">
											{m.homework_no_students_yet()}
										</p>
									{/if}
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
															<ix-pill variant="alarm">{m.homework_overdue_label()}</ix-pill>
														{/if}
													</span>
													{#if !instance.archivedAt}
														<span style="display:flex; gap: var(--space-2);">
															{#if !student.doneAt}
																<form
																	method="POST"
																	action="?/markDone"
																	use:enhance={pending.submit(
																		`done:${instance.id}:${student.studentId}`
																	)}
																>
																	<input type="hidden" name="instanceId" value={instance.id} />
																	<input type="hidden" name="studentId" value={student.studentId} />
																	<ix-button
																		variant="secondary"
																		type="submit"
																		loading={pending.is(
																			`done:${instance.id}:${student.studentId}`
																		) || undefined}
																		disabled={pending.busy || undefined}
																		aria-label={m.homework_mark_done_for({
																			name: student.displayName
																		})}>{m.homework_mark_done()}</ix-button
																	>
																</form>
															{/if}
															{#if student.doneAt && !student.reviewedAt}
																<form
																	method="POST"
																	action="?/markReviewed"
																	use:enhance={pending.submit(
																		`reviewed:${instance.id}:${student.studentId}`
																	)}
																>
																	<input type="hidden" name="instanceId" value={instance.id} />
																	<input type="hidden" name="studentId" value={student.studentId} />
																	<ix-button
																		variant="secondary"
																		type="submit"
																		loading={pending.is(
																			`reviewed:${instance.id}:${student.studentId}`
																		) || undefined}
																		disabled={pending.busy || undefined}
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
											use:enhance={pending.submit(`archive:${instance.id}`)}
											style="margin-top: var(--space-3);"
										>
											<input type="hidden" name="instanceId" value={instance.id} />
											<ix-button
												variant="secondary"
												type="submit"
												loading={pending.is(`archive:${instance.id}`) || undefined}
												disabled={pending.busy || undefined}
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
	</section>
</div>

<style>
	.homework-description {
		margin: 0 0 var(--space-2);
		white-space: pre-line;
	}

	.homework-links {
		margin: var(--space-1) 0;
		padding-left: var(--space-4);
		font-size: var(--theme-font-size-default);
	}
</style>
