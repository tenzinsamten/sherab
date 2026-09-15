<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
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
</script>

<svelte:head>
	<title>{data.class.name} — {m.roster_heading()} — Sherab</title>
</svelte:head>

<p class="section-label">{m.roster_section_label()}</p>
<h1>{data.class.name}</h1>
<p style="color: var(--color-muted-foreground);">
	{m.teacher_class_code_label({ code: data.class.code })}
</p>
<p>
	<a
		class="btn-outline btn"
		style="text-decoration:none;"
		href={resolve('/teacher/classes/[id]/homework', { id: data.class.id })}
		>{m.homework_heading()}</a
	>
</p>

{#if data.loadError}
	<p class="banner-error" role="alert">{m.load_error_generic()}</p>
{/if}
{#if form?.error}
	<p class="banner-error" role="alert">{form.error}</p>
{/if}
{#if form?.success && form.action === 'attendance'}
	{#if form.failedStudentIds.length > 0}
		<p class="banner-error" role="alert">
			{m.roster_attendance_saved_partial({
				date: form.sessionDate,
				names: form.failedStudentIds.map(studentName).join(', ')
			})}
		</p>
	{:else}
		<p class="banner-success" role="status">
			{m.roster_attendance_saved({ date: form.sessionDate })}
		</p>
	{/if}
{/if}
{#if form?.success && form.action === 'skillStatus'}
	<p class="banner-success" role="status">{m.roster_skill_saved()}</p>
{/if}

{#if data.students.length === 0}
	<div class="card">
		<p style="color: var(--color-muted-foreground); margin: 0;">{m.roster_empty()}</p>
	</div>
{:else}
	<div class="card" style="margin-bottom: var(--space-6);">
		<h2 style="margin-top:0; font-size: var(--text-lg);">{m.roster_attendance_heading()}</h2>
		<form method="POST" action="?/markAttendance" use:enhance>
			<div class="field">
				<label for="sessionDate">{m.roster_attendance_date_label()}</label>
				<input
					id="sessionDate"
					name="sessionDate"
					type="date"
					required
					value={form?.sessionDate ?? today}
				/>
			</div>
			<ul style="list-style:none; padding:0; margin: var(--space-3) 0;">
				{#each data.students as student (student.id)}
					<li
						style="display:flex; align-items:center; gap: var(--space-2); padding: var(--space-1) 0;"
					>
						<input type="hidden" name="studentIds" value={student.id} />
						<label style="display:flex; align-items:center; gap: var(--space-2);">
							<input type="checkbox" name="present_{student.id}" />
							{student.displayName}
						</label>
					</li>
				{/each}
			</ul>
			<button class="btn" type="submit">{m.roster_attendance_submit()}</button>
		</form>
	</div>

	<div class="card">
		<h2 style="margin-top:0; font-size: var(--text-lg);">{m.roster_skills_heading()}</h2>
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
								<p style="margin: 0 0 var(--space-2) 0; font-weight:700;">
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
									style="display:flex; flex-direction:column; gap: var(--space-1); min-width: 140px;"
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
									<button class="btn btn-outline" type="submit">{m.roster_set_status()}</button>
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
									<p style="color: var(--color-muted-foreground);">{m.roster_history_empty()}</p>
								{:else}
									<ul style="list-style:none; padding:0; margin: var(--space-1) 0 0 0;">
										{#each skillHistoryFor(student.id) as entry (entry.id)}
											<li
												style="border-bottom: 1px solid var(--color-border); padding: var(--space-1) 0;"
											>
												<strong>{skillLabel(entry.skillArea)}</strong> — {levelLabel(entry.level)}
												<span
													style="color: var(--color-muted-foreground); font-size: var(--text-sm);"
												>
													· {new Date(entry.recordedAt).toLocaleString()}
												</span>
												{#if entry.notes}
													<p
														style="margin: var(--space-1) 0 0 0; color: var(--color-muted-foreground);"
													>
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
									<p style="color: var(--color-muted-foreground);">{m.roster_history_empty()}</p>
								{:else}
									<ul style="list-style:none; padding:0; margin: var(--space-1) 0 0 0;">
										{#each attendanceHistoryFor(student.id) as entry (entry.id)}
											<li
												style="border-bottom: 1px solid var(--color-border); padding: var(--space-1) 0;"
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
{/if}
