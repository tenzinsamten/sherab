<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/ix';
	import EnrollmentPanel from '$lib/components/EnrollmentPanel.svelte';
	import { ixFieldError, ixValue } from '$lib/ix-fields';
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
	// #66: the picker is an <ix-select>, which takes its form value only on
	// load and on user picks. A pick updates `selectedSessionId` through
	// onvalueChange; when the page sets it instead (first load, the session
	// list changing), `sessionSelectKey` remounts the select with it.
	let selectedSessionId = $state('');
	let sessionSelectKey = $state(0);
	$effect.pre(() => {
		const ids = data.markableSessions.map((s) => s.id);
		const wanted = form?.success && form.action === 'attendance' ? form.sessionId : undefined;
		// Untracked: a user pick must not re-run this and force the saved
		// session back.
		const current = untrack(() => selectedSessionId);
		let next = current;
		if (wanted && ids.includes(wanted)) next = wanted;
		else if (!ids.includes(next)) next = ids[0] ?? '';
		if (next !== current) {
			selectedSessionId = next;
			untrack(() => sessionSelectKey++);
		}
	});

	function onSessionPick(event: CustomEvent<string | string[]>) {
		const value = Array.isArray(event.detail) ? event.detail[0] : event.detail;
		selectedSessionId = value ?? '';
	}

	// Story 7-4: the selected session's current leave answer per student.
	function leaveFor(studentId: string) {
		return selectedSessionId ? data.leaveAnswers[`${selectedSessionId}:${studentId}`] : undefined;
	}

	function leaveLabel(answer: string | undefined): string {
		if (answer === 'coming') return m.leave_answer_coming();
		if (answer === 'on_leave') return m.leave_answer_on_leave();
		if (answer === 'sick') return m.leave_answer_sick();
		return m.leave_answer_none();
	}

	function sessionLabel(session: { day: string; startTime: string | null }): string {
		return session.startTime ? `${session.day} · ${session.startTime.slice(0, 5)}` : session.day;
	}

	// ── Skill status (#66) ────────────────────────────────────────────────
	// Collapsed student rows, as the class schedules on /calendar: each row
	// shows a one-line summary, and its three forms render once the row has
	// been opened, then stay mounted (hidden while collapsed) so unsaved
	// edits survive collapsing it.
	const expandedStudents = new SvelteSet<string>();
	const openedStudents = new SvelteSet<string>();
	function toggleStudent(studentId: string) {
		if (expandedStudents.has(studentId)) expandedStudents.delete(studentId);
		else {
			expandedStudents.add(studentId);
			openedStudents.add(studentId);
		}
	}

	/** "Language: Learning · Song: No entry yet · Dance: Confident" */
	function skillSummary(studentId: string): string {
		return skillAreas
			.map((area) => {
				const level = currentLevel(studentId, area);
				return `${skillLabel(area)}: ${level ? levelLabel(level) : m.roster_no_entry_yet()}`;
			})
			.join(' · ');
	}

	const skillKey = (studentId: string, area: SkillArea) => `${studentId}:${area}`;
	const levelId = (studentId: string, area: SkillArea) => `level-${studentId}-${area}`;
	// Bumped after a successful save of that one form, remounting it: iX
	// fields don't take part in form reset, and the remount empties them.
	const skillFormVersions = new SvelteMap<string, number>();
	// Forms submitted without a level (<ix-select required> doesn't block a
	// submit by itself).
	const levelMissing = new SvelteSet<string>();
	const savingSkills = new SvelteSet<string>();

	function submitSkill(studentId: string, area: SkillArea): SubmitFunction {
		const key = skillKey(studentId, area);
		return ({ formElement, formData, cancel }) => {
			if (!formData.get('level')) {
				cancel();
				levelMissing.add(key);
				return;
			}
			if (savingSkills.has(key)) return cancel();
			savingSkills.add(key);
			return async ({ result, update }) => {
				try {
					await update({ reset: false });
				} finally {
					savingSkills.delete(key);
				}
				if (result.type === 'success') {
					// The remount drops focus: put it back on the new select, but
					// only if the row is still open and focus hasn't moved elsewhere.
					const active = document.activeElement;
					const refocus =
						expandedStudents.has(studentId) &&
						(!active || active === document.body || formElement.contains(active));
					skillFormVersions.set(key, (skillFormVersions.get(key) ?? 0) + 1);
					if (refocus) focusField(levelId(studentId, area));
				}
			};
		};
	}

	/** Focus a (remounted) iX field, which is focusable only once it has loaded. */
	async function focusField(id: string) {
		await tick();
		const field = document.getElementById(id) as
			(HTMLElement & { componentOnReady?: () => Promise<unknown> }) | null;
		if (!field) return;
		await customElements.whenDefined(field.localName);
		await field.componentOnReady?.();
		field.focus();
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
						{#if data.markableSessions.length === 0}
							<span class="field-label">{m.roster_attendance_session_label()}</span>
							<p class="muted" style="margin: 0;">{m.roster_attendance_no_sessions()}</p>
						{:else}
							{#key sessionSelectKey}
								<ix-select
									id="sessionId"
									name="sessionId"
									label={m.roster_attendance_session_label()}
									required
									onvalueChange={onSessionPick}
									{@attach ixValue(untrack(() => selectedSessionId))}
								>
									{#each data.markableSessions as session (session.id)}
										<ix-select-item value={session.id} label={sessionLabel(session)}
										></ix-select-item>
									{/each}
								</ix-select>
							{/key}
						{/if}
					</div>
					<div class="check-list" style="margin-bottom: var(--space-4);">
						{#each data.students as student (student.id)}
							<input type="hidden" name="studentIds" value={student.id} />
							<div class="attendance-row">
								<ix-checkbox name="present_{student.id}" label={student.displayName}></ix-checkbox>
								{#if leaveFor(student.id)}
									{@const answer = leaveFor(student.id)}
									<ix-pill
										variant={answer === 'coming' ? 'success' : 'warning'}
										outline={answer === 'coming' || undefined}
										aria-label="{m.roster_leave_label()}: {leaveLabel(answer)}"
									>
										{leaveLabel(answer)}
									</ix-pill>
								{/if}
							</div>
						{/each}
					</div>
					<ix-button type="submit" disabled={data.markableSessions.length === 0}
						>{m.roster_attendance_submit()}</ix-button
					>
				</form>
			</section>

			<section class="card" aria-labelledby="skills-heading">
				<h2 id="skills-heading">{m.roster_skills_heading()}</h2>
				<ul class="row-list">
					{#each data.students as student (student.id)}
						{@const open = expandedStudents.has(student.id)}
						<li class="student-row">
							<h3 class="student-heading">
								<button
									type="button"
									class="student-toggle"
									aria-expanded={open}
									aria-controls={openedStudents.has(student.id)
										? `skills-panel-${student.id}`
										: undefined}
									data-student-id={student.id}
									onclick={() => toggleStudent(student.id)}
								>
									<ix-icon class="student-chevron" name="chevron-right" size="16" aria-hidden="true"
									></ix-icon>
									<span class="student-toggle-text">
										<span id="student-title-{student.id}" class="row-title"
											>{student.displayName}</span
										>
										<span class="skill-summary muted">{skillSummary(student.id)}</span>
									</span>
								</button>
							</h3>
							{#if openedStudents.has(student.id)}
								<div
									id="skills-panel-{student.id}"
									hidden={!open}
									role="group"
									aria-labelledby="student-title-{student.id}"
								>
									<div class="skill-forms">
										{#each skillAreas as area (area)}
											{@const key = skillKey(student.id, area)}
											{@const missing = levelMissing.has(key)}
											{#key skillFormVersions.get(key) ?? 0}
												<form
													method="POST"
													action="?/setSkillStatus"
													use:enhance={submitSkill(student.id, area)}
													class="skill-form"
													data-skill-area={area}
													novalidate
												>
													<input type="hidden" name="studentId" value={student.id} />
													<input type="hidden" name="skillArea" value={area} />
													<div class="field">
														<ix-select
															id={levelId(student.id, area)}
															name="level"
															label={skillLabel(area)}
															i18n-placeholder={m.roster_level_placeholder()}
															required
															onvalueChange={() => levelMissing.delete(key)}
															{@attach ixFieldError(
																missing ? `${levelId(student.id, area)}-error` : undefined
															)}
														>
															{#each skillLevels as level (level)}
																<ix-select-item value={level} label={levelLabel(level)}
																></ix-select-item>
															{/each}
														</ix-select>
														{#if missing}
															<p
																id="{levelId(student.id, area)}-error"
																class="field-error"
																role="alert"
															>
																{m.roster_error_invalid_level()}
															</p>
														{/if}
													</div>
													<div class="field">
														<ix-input
															id="notes-{student.id}-{area}"
															name="notes"
															label={m.roster_notes_placeholder()}
															{@attach ixFieldError(undefined, [
																`notes-hint-${student.id}-${area}`
															])}
														></ix-input>
														<small id="notes-hint-{student.id}-{area}" class="muted notes-hint">
															{m.roster_notes_parent_hint()}
														</small>
													</div>
													<ix-button
														variant="secondary"
														type="submit"
														loading={savingSkills.has(key) || undefined}
														disabled={savingSkills.has(key) || undefined}
														>{m.roster_set_status()}</ix-button
													>
												</form>
											{/key}
										{/each}
									</div>

									<h4 class="history-heading">{m.roster_col_history()}</h4>
									<p class="history-subheading">{m.roster_skills_heading()}</p>
									{#if skillHistoryFor(student.id).length === 0}
										<p class="muted history-empty">{m.roster_history_empty()}</p>
									{:else}
										<ul class="history-list">
											{#each skillHistoryFor(student.id) as entry (entry.id)}
												<li>
													<strong>{skillLabel(entry.skillArea)}</strong> — {levelLabel(entry.level)}
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

									<p class="history-subheading">{m.roster_attendance_heading()}</p>
									{#if attendanceHistoryFor(student.id).length === 0}
										<p class="muted history-empty">{m.roster_history_empty()}</p>
									{:else}
										<ul class="history-list">
											{#each attendanceHistoryFor(student.id) as entry (entry.id)}
												<li>
													{entry.sessionDate} —
													{entry.present ? m.roster_present() : m.roster_absent()}
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
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
	.attendance-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.notes-hint {
		font-size: 0.75rem;
		line-height: 1.3;
	}

	.field-label {
		color: var(--theme-color-soft-text);
		font-size: var(--theme-font-size-default);
	}

	/* Skill status: collapsible student rows (#66), as on /calendar. */
	.row-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
	}
	.row-list > li {
		padding: var(--space-2) 0;
	}
	.row-list > li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}
	.student-heading {
		margin: 0;
		font-size: inherit;
	}
	/* The whole summary line is the disclosure button. */
	.student-toggle {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		width: 100%;
		min-height: 2.75rem;
		padding: var(--space-1) 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.student-toggle:focus-visible {
		outline: 2px solid var(--theme-color-focus-bdr);
		outline-offset: 2px;
	}
	.student-chevron {
		flex: none;
		margin-top: 0.3rem;
		transition: transform 150ms ease;
	}
	.student-toggle[aria-expanded='true'] .student-chevron {
		transform: rotate(90deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.student-chevron {
			transition: none;
		}
	}
	.student-toggle-text {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-3);
	}
	.row-title {
		font-weight: var(--theme-font-weight-bold);
		font-size: var(--theme-font-size-l);
	}
	.skill-summary {
		font-weight: normal;
	}
	.skill-forms {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
		margin-top: var(--space-3);
	}
	.skill-form .field {
		margin-bottom: var(--space-2);
	}
	.skill-form .field-error {
		margin: 0;
	}
	.history-heading {
		margin: var(--space-4) 0 0;
		font-size: var(--theme-font-size-l);
	}
	.history-subheading {
		margin: var(--space-2) 0 0;
		font-weight: var(--theme-font-weight-bold);
	}
	.history-empty {
		margin: var(--space-1) 0 0;
	}
	.history-list {
		list-style: none;
		padding: 0;
		margin: var(--space-1) 0 0;
	}
	.history-list > li {
		border-bottom: 1px solid var(--theme-color-soft-bdr);
		padding: var(--space-1) 0;
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
