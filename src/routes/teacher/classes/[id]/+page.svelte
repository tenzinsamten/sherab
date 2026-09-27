<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import EnrollmentPanel from '$lib/components/EnrollmentPanel.svelte';
	import { formatSchoolYear } from '$lib/school-year';
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

	// Story 6-2: the picker defaults to the latest markable session; after a
	// save it stays on the session just marked.
	let selectedSessionId = $state('');
	$effect.pre(() => {
		const ids = data.markableSessions.map((s) => s.id);
		const wanted = form?.success && form.action === 'attendance' ? form.sessionId : undefined;
		if (wanted && ids.includes(wanted)) selectedSessionId = wanted;
		else if (!ids.includes(selectedSessionId)) selectedSessionId = ids[0] ?? '';
	});

	function sessionLabel(session: { day: string; startTime: string | null }): string {
		return session.startTime ? `${session.day} · ${session.startTime.slice(0, 5)}` : session.day;
	}

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
	</header>

	<!-- #37: three equal cards (the grid stretches every card to the row's height),
	     all clickable. -->
	<div class="class-cards">
		<a href="#roster" class="tile-link">
			<ix-card variant="outline">
				<ix-card-content>
					<p class="section-label">{m.dashboard_tile_students()}</p>
					<p class={data.students.length === 0 ? 'stat-tile-value muted' : 'stat-tile-value'}>
						{data.students.length}
					</p>
					<p class="muted card-note">{m.class_card_students_note()}</p>
				</ix-card-content>
			</ix-card>
		</a>
		<a href={resolve('/teacher/classes/[id]/homework', { id: data.class.id })} class="tile-link">
			<ix-card variant="outline">
				<ix-card-content>
					<p class="section-label">{m.homework_heading()}</p>
					<p class={data.homeworkCounts.total === 0 ? 'stat-tile-value muted' : 'stat-tile-value'}>
						{data.homeworkCounts.open}
					</p>
					<p class="muted card-note">
						{m.class_homework_count({
							open: data.homeworkCounts.open,
							total: data.homeworkCounts.total
						})}
					</p>
				</ix-card-content>
			</ix-card>
		</a>
		<a href={resolve('/teacher/classes/[id]/syllabus', { id: data.class.id })} class="tile-link">
			<ix-card variant="outline">
				<ix-card-content>
					<p class="section-label">{m.syllabus_list_heading()}</p>
					<p class={data.syllabusCounts.total === 0 ? 'stat-tile-value muted' : 'stat-tile-value'}>
						{data.syllabusCounts.total}
					</p>
					<p class="muted card-note">
						{data.syllabusCounts.hasCurrent
							? m.class_card_syllabus_added({ year: formatSchoolYear(data.currentYear) })
							: m.class_card_syllabus_missing({ year: formatSchoolYear(data.currentYear) })}
					</p>
				</ix-card-content>
			</ix-card>
		</a>
	</div>

	<div id="roster">
		{#if data.students.length === 0}
			<ix-empty-state header={m.roster_empty()} icon="user-group"></ix-empty-state>
		{:else}
			<section class="card">
				<h2>{m.roster_attendance_heading()}</h2>
				<form method="POST" action="?/markAttendance" use:enhance>
					<div class="field form-narrow">
						<label for="sessionId">{m.roster_attendance_session_label()}</label>
						{#if data.markableSessions.length === 0}
							<p class="muted" style="margin: 0;">{m.roster_attendance_no_sessions()}</p>
						{:else}
							<select id="sessionId" name="sessionId" required bind:value={selectedSessionId}>
								{#each data.markableSessions as session (session.id)}
									<option value={session.id}>{sessionLabel(session)}</option>
								{/each}
							</select>
						{/if}
					</div>
					<div class="check-list" style="margin-bottom: var(--space-4);">
						{#each data.students as student (student.id)}
							<input type="hidden" name="studentIds" value={student.id} />
							<ix-checkbox name="present_{student.id}" label={student.displayName}></ix-checkbox>
						{/each}
					</div>
					<ix-button type="submit" disabled={data.markableSessions.length === 0}
						>{m.roster_attendance_submit()}</ix-button
					>
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
												<input
													type="text"
													name="notes"
													placeholder={m.roster_notes_placeholder()}
													aria-label={m.roster_notes_placeholder()}
													aria-describedby="notes-hint-{student.id}-{area}"
												/>
												<small id="notes-hint-{student.id}-{area}" class="muted notes-hint">
													{m.roster_notes_parent_hint()}
												</small>
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

	<EnrollmentPanel
		className={data.class.name}
		students={data.students}
		enrollable={data.enrollable}
	/>
</div>

<style>
	.notes-hint {
		font-size: 0.75rem;
		line-height: 1.3;
	}

	.class-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-6);
	}

	/* Equal size whatever the content: the link fills its grid cell and the
	   card fills the link. */
	.class-cards .tile-link,
	.class-cards ix-card {
		height: 100%;
	}

	.class-cards .section-label {
		margin: 0 0 var(--space-1);
	}

	.card-note {
		margin: 0;
	}

	#roster {
		scroll-margin-top: var(--space-6);
	}
</style>
