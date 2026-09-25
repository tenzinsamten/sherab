<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import SyllabusForm from '$lib/components/SyllabusForm.svelte';
	import TextWithLinks from '$lib/components/TextWithLinks.svelte';
	import type { SkillArea, SkillLevel } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const skillAreas: SkillArea[] = ['language', 'song', 'dance'];
	const skillLevels: SkillLevel[] = ['not_started', 'learning', 'confident'];

	function skillLabel(area: SkillArea): string {
		if (area === 'language') return m.roster_skill_language();
		if (area === 'song') return m.roster_skill_song();
		return m.roster_skill_dance();
	}

	function levelLabel(level: SkillLevel): string {
		if (level === 'not_started') return m.roster_level_not_started();
		if (level === 'learning') return m.roster_level_learning();
		return m.roster_level_confident();
	}

	function currentLevel(studentId: string, area: SkillArea): SkillLevel | null {
		return data.currentSkills[`${studentId}:${area}`]?.level ?? null;
	}

	function skillHistoryFor(studentId: string) {
		return data.skillHistory.filter((r) => r.studentId === studentId);
	}

	function attendanceHistoryFor(studentId: string) {
		return data.attendance.filter((r) => r.studentId === studentId);
	}

	function studentName(studentId: string): string {
		return data.students.find((s) => s.id === studentId)?.displayName ?? studentId;
	}

	const today = new Date().toISOString().slice(0, 10);

	$effect(() => {
		if (!form?.success) return;
		if (form.action === 'attendance') {
			if (form.failedStudentIds.length > 0) {
				showToast(
					'error',
					m.roster_attendance_saved_partial({
						date: form.sessionDate,
						names: form.failedStudentIds.map(studentName).join(', ')
					})
				);
			} else {
				showToast('success', m.roster_attendance_saved({ date: form.sessionDate }));
			}
		}
		if (form.action === 'skillStatus') showToast('success', m.roster_skill_saved());
		if (form.action === 'syllabus') showToast('success', m.syllabus_saved());
	});
</script>

<svelte:head>
	<title>{data.class.name} — {m.roster_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.roster_section_label()}</p>
			<h1 class="page-heading">{data.class.name}</h1>
			<p class="page-subtitle">{m.teacher_class_code_label({ code: data.class.code })}</p>
		</div>
		<ix-button
			variant="secondary"
			icon="tasks-open"
			href={resolve('/teacher/classes/[id]/homework', { id: data.class.id })}
		>
			{m.homework_heading()}
		</ix-button>
	</header>

	<div class="class-cards">
		<ix-card variant="outline" passive>
			<ix-card-content>
				<p class="section-label">{m.dashboard_tile_students()}</p>
				<p class={data.students.length === 0 ? 'stat-tile-value muted' : 'stat-tile-value'}>
					{data.students.length}
				</p>
			</ix-card-content>
		</ix-card>
		<a href={resolve('/teacher/classes/[id]/homework', { id: data.class.id })} class="tile-link">
			<ix-card variant="outline">
				<ix-card-content>
					<p class="section-label">{m.homework_heading()}</p>
					<p class={data.homeworkCounts.total === 0 ? 'stat-tile-value muted' : 'stat-tile-value'}>
						{data.homeworkCounts.open}
					</p>
					<p class="muted" style="margin:0;">
						{m.class_homework_count({
							open: data.homeworkCounts.open,
							total: data.homeworkCounts.total
						})}
					</p>
				</ix-card-content>
			</ix-card>
		</a>
		<ix-card variant="outline" passive class="syllabus-card">
			<ix-card-content>
				<p class="section-label">{m.syllabus_heading()}</p>
				<TextWithLinks
					text={data.class.syllabus}
					links={data.class.syllabusLinks}
					empty={m.syllabus_empty()}
				/>
				<details>
					<summary>{m.syllabus_edit()}</summary>
					<div style="margin-top: var(--space-3);">
						<SyllabusForm
							action="?/setSyllabus"
							idPrefix="syllabus"
							syllabus={data.class.syllabus}
							links={data.class.syllabusLinks}
						/>
					</div>
				</details>
			</ix-card-content>
		</ix-card>
	</div>

	{#if data.students.length === 0}
		<ix-empty-state header={m.roster_empty()} icon="user-group"></ix-empty-state>
	{:else}
		<section class="card">
			<h2>{m.roster_attendance_heading()}</h2>
			<form method="POST" action="?/markAttendance" use:enhance>
				<div class="field form-narrow">
					<label for="sessionDate">{m.roster_attendance_date_label()}</label>
					<input
						id="sessionDate"
						name="sessionDate"
						type="date"
						required
						value={form?.sessionDate ?? today}
					/>
				</div>
				<div class="check-list" style="margin-bottom: var(--space-4);">
					{#each data.students as student (student.id)}
						<input type="hidden" name="studentIds" value={student.id} />
						<ix-checkbox name="present_{student.id}" label={student.displayName}></ix-checkbox>
					{/each}
				</div>
				<ix-button type="submit">{m.roster_attendance_submit()}</ix-button>
			</form>
		</section>

		<section class="card">
			<h2>{m.roster_skills_heading()}</h2>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.roster_col_student()}</th>
							{#each skillAreas as area (area)}
								<th>{skillLabel(area)}</th>
							{/each}
							<th>{m.roster_col_history()}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.students as student (student.id)}
							<tr>
								<td>{student.displayName}</td>
								{#each skillAreas as area (area)}
									<td>
										<p
											style="margin: 0 0 var(--space-2) 0; font-weight:700;"
											class:muted={!currentLevel(student.id, area)}
										>
											{#if currentLevel(student.id, area)}
												{levelLabel(currentLevel(student.id, area)!)}
											{:else}
												{m.roster_no_entry_yet()}
											{/if}
										</p>
										<form
											method="POST"
											action="?/setSkillStatus"
											use:enhance
											class="field"
											style="gap: var(--space-1); min-width: 140px; margin:0;"
										>
											<input type="hidden" name="studentId" value={student.id} />
											<input type="hidden" name="skillArea" value={area} />
											<select name="level" required>
												<option value="" disabled selected>{m.roster_level_placeholder()}</option>
												{#each skillLevels as level (level)}
													<option value={level}>{levelLabel(level)}</option>
												{/each}
											</select>
											<input type="text" name="notes" placeholder={m.roster_notes_placeholder()} />
											<ix-button variant="secondary" type="submit"
												>{m.roster_set_status()}</ix-button
											>
										</form>
									</td>
								{/each}
								<td>
									<details>
										<summary>{m.roster_view_history()}</summary>
										<p style="font-weight:700; margin: var(--space-2) 0 0 0;">
											{m.roster_skills_heading()}
										</p>
										{#if skillHistoryFor(student.id).length === 0}
											<p class="muted">{m.roster_history_empty()}</p>
										{:else}
											<ul style="list-style:none; padding:0; margin: var(--space-1) 0 0 0;">
												{#each skillHistoryFor(student.id) as entry (entry.id)}
													<li
														style="border-bottom: 1px solid var(--theme-color-soft-bdr); padding: var(--space-1) 0;"
													>
														<strong>{skillLabel(entry.skillArea)}</strong> — {levelLabel(
															entry.level
														)}
														<span class="muted">
															· {new Date(entry.recordedAt).toLocaleString()}
														</span>
														{#if entry.notes}
															<p class="muted" style="margin: var(--space-1) 0 0 0;">
																{entry.notes}
															</p>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}

										<p style="font-weight:700; margin: var(--space-3) 0 0 0;">
											{m.roster_attendance_heading()}
										</p>
										{#if attendanceHistoryFor(student.id).length === 0}
											<p class="muted">{m.roster_history_empty()}</p>
										{:else}
											<ul style="list-style:none; padding:0; margin: var(--space-1) 0 0 0;">
												{#each attendanceHistoryFor(student.id) as entry (entry.id)}
													<li
														style="border-bottom: 1px solid var(--theme-color-soft-bdr); padding: var(--space-1) 0;"
													>
														{entry.sessionDate} —
														{entry.present ? m.roster_present() : m.roster_absent()}
													</li>
												{/each}
											</ul>
										{/if}
									</details>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>

<style>
	.class-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-6);
		align-items: start;
	}

	.class-cards .section-label {
		margin: 0 0 var(--space-1);
	}

	/* The syllabus holds text and a form, so it takes a full row. */
	.class-cards :global(.syllabus-card) {
		grid-column: 1 / -1;
	}
</style>
