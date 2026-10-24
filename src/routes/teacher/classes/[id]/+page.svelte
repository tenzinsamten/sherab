<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Users from '@lucide/svelte/icons/users';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import CopyField from '$lib/components/CopyField.svelte';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import EnrollmentPanel from '$lib/components/EnrollmentPanel.svelte';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import { formatDay, formatInstant, isoDay, num } from '$lib/format';
	import { showToast } from '$lib/toast';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import { formatSchoolYear } from '$lib/school-year';
	import type { SkillArea, SkillLevel } from '$lib/supabase/database.types';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * A class as its teacher sees it, mobile-first story 7: the three class
	 * cards, attendance (each student row is one tap target, the save button
	 * stays above the bottom bar on a phone and tablet), the coming leave and
	 * the collapsible skill rows, then the class members (EnrollmentPanel,
	 * mobile-first story 8) inside the same new-UI root.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	const pending = createPending();

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
	// save it stays on the session just marked, and a later pick is kept.
	function nextSession(current: string): string {
		const ids = data.markableSessions.map((s) => s.id);
		const wanted = form?.success && form.action === 'attendance' ? form.sessionId : undefined;
		if (wanted && ids.includes(wanted)) return wanted;
		if (!ids.includes(current)) return ids[0] ?? '';
		return current;
	}
	let selectedSessionId = $state(untrack(() => nextSession('')));
	$effect.pre(() => {
		// Untracked: a user pick must not re-run this and force the saved
		// session back.
		const current = untrack(() => selectedSessionId);
		const next = nextSession(current);
		if (next !== current) selectedSessionId = next;
	});

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

	// #102: the sessions that already have a mark, and the selected session's
	// current mark per student (the latest one; none = not ticked).
	const markedSessionIds = $derived(new Set(data.markedSessionIds));

	/** The mark the form shows and posts as loaded: present, absent or none (''). */
	function loadedMark(studentId: string): 'present' | 'absent' | '' {
		const mark = data.currentMarks[`${selectedSessionId}:${studentId}`];
		return mark === undefined ? '' : mark ? 'present' : 'absent';
	}

	// The ticks not saved yet, valid only for what the list showed when they
	// were made: another session, other marks for this one, or a save (which
	// then shows what was saved) start again from the loaded marks. A reload
	// that changes no mark of this session (e.g. a skill save) keeps them.
	let attendanceSaves = $state(0);
	const loadedState = $derived(
		`${selectedSessionId}|${attendanceSaves}|${data.students
			.map((s) => `${s.id}:${loadedMark(s.id)}`)
			.join()}`
	);
	let ticks = $state<{ for: string; present: Record<string, boolean> }>({ for: '', present: {} });
	// Dropped as soon as the list shows something else, so picking another
	// session and coming back does not bring them back.
	$effect.pre(() => {
		const shown = loadedState;
		untrack(() => {
			if (ticks.for !== shown) ticks = { for: '', present: {} };
		});
	});

	function isPresent(studentId: string): boolean {
		const own = ticks.for === loadedState ? ticks.present[studentId] : undefined;
		return own ?? loadedMark(studentId) === 'present';
	}

	function setPresent(studentId: string, present: boolean) {
		if (ticks.for !== loadedState) ticks = { for: loadedState, present: {} };
		ticks.present[studentId] = present;
	}

	function sessionLabel(session: { id: string; day: string; startTime: string | null }): string {
		const label = session.startTime
			? `${session.day} · ${session.startTime.slice(0, 5)}`
			: session.day;
		return markedSessionIds.has(session.id)
			? m.roster_attendance_session_marked({ session: label })
			: label;
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
	// Forms submitted without a level (the form is `novalidate`: the error
	// shows under the field instead of the browser's bubble).
	const levelMissing = new SvelteSet<string>();
	const savingSkills = new SvelteSet<string>();

	function submitSkill(studentId: string, area: SkillArea): SubmitFunction {
		const key = skillKey(studentId, area);
		return ({ formElement, formData, cancel }) => {
			if (!formData.get('level')) {
				cancel();
				levelMissing.add(key);
				void tick().then(() => document.getElementById(levelId(studentId, area))?.focus());
				return;
			}
			if (savingSkills.has(key)) return cancel();
			savingSkills.add(key);
			return async ({ result, update }) => {
				try {
					// A success empties the form (its level and notes); an error keeps them.
					await update();
				} finally {
					savingSkills.delete(key);
				}
				if (result.type === 'success') {
					// Back on the emptied level, unless focus has moved elsewhere.
					const active = document.activeElement;
					const refocus =
						expandedStudents.has(studentId) &&
						(!active || active === document.body || formElement.contains(active));
					if (refocus) document.getElementById(levelId(studentId, area))?.focus();
				}
			};
		};
	}

	$effect(() => {
		if (!form?.success) return;
		if (form.action === 'attendance') {
			untrack(() => attendanceSaves++);
			if (form.failedStudentIds.length > 0) {
				showToast(
					'error',
					m.roster_attendance_saved_partial({
						date: isoDay(form.sessionDate),
						names: form.failedStudentIds.map(studentName).join(', ')
					})
				);
			} else {
				showToast('success', m.roster_attendance_saved({ date: isoDay(form.sessionDate) }));
			}
		}
		if (form.action === 'skillStatus') showToast('success', m.roster_skill_saved());
	});

	const classCard = `${ui.card} flex h-full flex-col gap-1 transition-colors group-hover:bg-muted`;
	const classCardLink = `${ui.tileLink} group min-w-0`;
	const fieldClass = 'flex min-w-0 flex-col gap-1.5';
	const fieldLabel = 'text-sm font-medium';
	const historyList = `history-list ${ui.rows} mt-1`;
	const historySubheading = 'mt-3 font-bold';
</script>

<svelte:head>
	<title>{data.class.name} — {m.roster_heading()} — Sherab</title>
</svelte:head>

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[{ label: m.nav_dashboard(), href: resolve('/teacher') }, { label: data.class.name }]}
		/>
	</div>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.roster_section_label()}</p>
			<h1 class={ui.heading}>{data.class.name}</h1>
			<p class="{ui.subtitle} wrap-break-word">
				{m.teacher_class_code_label({ code: data.class.code })}
			</p>
		</div>
	</header>

	<!-- #37: three equal cards, all clickable; one column on a phone. -->
	<ul class="grid gap-3 sm:grid-cols-3 md:gap-4" data-testid="class-cards">
		<li class="min-w-0">
			<a href="#roster" class={classCardLink}>
				<div class={classCard}>
					<p class="{ui.label} wrap-break-word">{m.dashboard_tile_students()}</p>
					<p class="{ui.stat} {data.students.length === 0 ? ui.muted : ''}">
						{num(data.students.length)}
					</p>
					<p class="{ui.muted} wrap-break-word">{m.class_card_students_note()}</p>
				</div>
			</a>
		</li>
		<li class="min-w-0">
			<a
				href={resolve('/teacher/classes/[id]/homework', { id: data.class.id })}
				class={classCardLink}
				data-tour="class-homework"
			>
				<div class={classCard}>
					<p class="{ui.label} wrap-break-word">{m.homework_heading()}</p>
					<p class="{ui.stat} {data.homeworkCounts.total === 0 ? ui.muted : ''}">
						{num(data.homeworkCounts.open)}
					</p>
					<p class="{ui.muted} wrap-break-word">
						{m.class_homework_count({
							open: num(data.homeworkCounts.open),
							total: num(data.homeworkCounts.total)
						})}
					</p>
				</div>
			</a>
		</li>
		<li class="min-w-0">
			<a
				href={resolve('/teacher/classes/[id]/syllabus', { id: data.class.id })}
				class={classCardLink}
			>
				<div class={classCard}>
					<p class="{ui.label} wrap-break-word">{m.syllabus_list_heading()}</p>
					<p class="{ui.stat} {data.syllabusCounts.total === 0 ? ui.muted : ''}">
						{num(data.syllabusCounts.total)}
					</p>
					<p class="{ui.muted} wrap-break-word">
						{data.syllabusCounts.hasCurrent
							? m.class_card_syllabus_added({ year: formatSchoolYear(data.currentYear) })
							: m.class_card_syllabus_missing({ year: formatSchoolYear(data.currentYear) })}
					</p>
				</div>
			</a>
		</li>
	</ul>

	<div id="roster" class="flex min-w-0 scroll-mt-6 flex-col gap-4 md:gap-6">
		{#if data.students.length === 0}
			<section class={ui.card}>
				<EmptyState header={m.roster_empty()} subHeader={m.roster_empty_body()} icon={Users}>
					<!-- #126: the next step: share the class code. -->
					<CopyField label={m.class_code_label()} value={data.class.code} />
				</EmptyState>
			</section>
		{:else}
			<section class={ui.card} aria-labelledby="attendance-heading">
				<h2 id="attendance-heading" class={ui.cardTitle}>{m.roster_attendance_heading()}</h2>
				<form
					method="POST"
					action="?/markAttendance"
					use:enhance={pending.submit('attendance', { reset: false })}
				>
					<div
						class="{fieldClass} mb-4 md:max-w-sm"
						data-tour={data.markableSessions.length > 0 ? 'class-session' : undefined}
					>
						{#if data.markableSessions.length === 0}
							<span class={fieldLabel}>{m.roster_attendance_session_label()}</span>
							<p class={ui.muted}>{m.roster_attendance_no_sessions()}</p>
						{:else}
							<Label for="sessionId" class={fieldLabel}>{m.roster_attendance_session_label()}</Label
							>
							<NativeSelect.Root
								id="sessionId"
								name="sessionId"
								class="w-full"
								required
								bind:value={selectedSessionId}
							>
								{#each data.markableSessions as session (session.id)}
									<NativeSelect.Option
										value={session.id}
										selected={session.id === selectedSessionId}
										>{sessionLabel(session)}</NativeSelect.Option
									>
								{/each}
							</NativeSelect.Root>
						{/if}
					</div>
					<ul class="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="attendance-list">
						{#each data.students as student (student.id)}
							{@const answer = leaveFor(student.id)}
							<li class="min-w-0">
								<!-- `loaded`: the mark the list shows when nothing is ticked yet.
								     It is posted, so the save writes only changes. -->
								<input type="hidden" name="studentIds" value={student.id} />
								<input type="hidden" name="loaded_{student.id}" value={loadedMark(student.id)} />
								<label
									class="attendance-row flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
									data-student-id={student.id}
								>
									<input
										type="checkbox"
										name="present_{student.id}"
										class="size-5 shrink-0 accent-primary"
										checked={isPresent(student.id)}
										onchange={(event) => setPresent(student.id, event.currentTarget.checked)}
										aria-labelledby="attendance-name-{student.id}"
										aria-describedby={answer ? `attendance-leave-${student.id}` : undefined}
									/>
									<span
										id="attendance-name-{student.id}"
										class="min-w-0 flex-1 font-medium wrap-break-word">{student.displayName}</span
									>
									{#if answer}
										<!-- The badge is what is seen; the checkbox is described by the
										     full text, read once. -->
										<Badge
											variant={answer === 'coming' ? 'success-outline' : 'warning'}
											aria-hidden="true"
											data-testid="leave-badge"
										>
											{leaveLabel(answer)}
										</Badge>
										<span id="attendance-leave-{student.id}" class="sr-only"
											>{m.roster_leave_label()}: {leaveLabel(answer)}</span
										>
									{/if}
								</label>
							</li>
						{/each}
					</ul>
					<!-- One-handed: the save stays reachable above the bottom bar. -->
					<div
						class="sticky bottom-[var(--bottom-nav-height,calc(4.5rem_+_env(safe-area-inset-bottom)))] z-10 -mx-4 mt-4 border-t border-border bg-card px-4 py-3 md:-mx-6 md:px-6 xl:bottom-0"
					>
						<Button
							type="submit"
							class="{ui.touch} w-full gap-2 md:w-auto"
							disabled={data.markableSessions.length === 0 || data.attendanceError || pending.busy}
							aria-busy={pending.is('attendance') || undefined}
							data-tour={data.markableSessions.length > 0 ? 'class-attendance-save' : undefined}
						>
							{#if pending.is('attendance')}
								<LoaderCircle class="animate-spin" aria-hidden="true" />
							{/if}
							{m.roster_attendance_submit()}
						</Button>
					</div>
				</form>
			</section>

			<!-- #106: leave parents have given for the coming sessions. -->
			<section class={ui.card} aria-labelledby="upcoming-leave-heading">
				<h2 id="upcoming-leave-heading" class={ui.cardTitle}>
					{m.roster_upcoming_leave_heading()}
				</h2>
				{#if data.upcomingLeave.length === 0}
					<p class={ui.muted}>{m.roster_upcoming_leave_empty()}</p>
				{:else}
					<ul class={ui.rows}>
						{#each data.upcomingLeave as session (session.sessionId)}
							<li class="py-3 first:pt-0 last:pb-0">
								<p class="upcoming-leave-day mb-2 font-bold wrap-break-word">
									{formatDay(session.day, {
										weekday: 'long',
										day: 'numeric',
										month: 'long',
										year: 'numeric'
									})}{session.startTime ? ` · ${num(session.startTime.slice(0, 5))}` : ''}
								</p>
								<ul class="flex flex-col gap-2">
									{#each session.entries as entry (entry.studentId)}
										<li
											class="flex flex-wrap items-center gap-2"
											data-testid="upcoming-leave-entry"
										>
											<span class="min-w-0 wrap-break-word">{studentName(entry.studentId)}</span>
											<Badge variant="warning">{leaveLabel(entry.answer)}</Badge>
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class={ui.card} aria-labelledby="skills-heading">
				<h2 id="skills-heading" class={ui.cardTitle} data-tour="class-skills">
					{m.roster_skills_heading()}
				</h2>
				<ul class={ui.rows}>
					{#each data.students as student (student.id)}
						{@const open = expandedStudents.has(student.id)}
						<li class="py-1">
							<h3 class="text-base">
								<!-- The whole summary line is the disclosure button. -->
								<button
									type="button"
									class="student-toggle group flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-lg py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
									aria-expanded={open}
									aria-controls={openedStudents.has(student.id)
										? `skills-panel-${student.id}`
										: undefined}
									data-student-id={student.id}
									data-tour="class-skill-student"
									onclick={() => toggleStudent(student.id)}
								>
									<ChevronRight
										class="mt-0.5 size-5 shrink-0 text-muted-foreground group-aria-expanded:rotate-90 motion-safe:transition-transform"
										aria-hidden="true"
									/>
									<span class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
										<span id="student-title-{student.id}" class="text-lg font-bold wrap-break-word"
											>{student.displayName}</span
										>
										<span class="skill-summary min-w-0 font-normal wrap-break-word {ui.muted}"
											>{skillSummary(student.id)}</span
										>
									</span>
								</button>
							</h3>
							{#if openedStudents.has(student.id)}
								<div
									id="skills-panel-{student.id}"
									class="pb-3 pl-7"
									hidden={!open}
									role="group"
									aria-labelledby="student-title-{student.id}"
								>
									<p class="mb-2">
										<a
											href={resolve('/teacher/classes/[id]/students/[studentId]/badges', {
												id: data.class.id,
												studentId: student.id
											})}
											class="{ui.link} inline-flex min-h-11 items-center gap-1"
											aria-label={m.badge_page_heading_of({ name: student.displayName })}
											data-testid="student-badges-link"
										>
											<Trophy class="size-4" aria-hidden="true" />
											{m.badge_page_link()}
										</a>
									</p>
									<div class="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
										{#each skillAreas as area (area)}
											{@const key = skillKey(student.id, area)}
											{@const missing = levelMissing.has(key)}
											{@const errorId = `${levelId(student.id, area)}-error`}
											<form
												method="POST"
												action="?/setSkillStatus"
												use:enhance={submitSkill(student.id, area)}
												class="skill-form flex min-w-0 flex-col gap-3"
												data-skill-area={area}
												novalidate
											>
												<input type="hidden" name="studentId" value={student.id} />
												<input type="hidden" name="skillArea" value={area} />
												<div class={fieldClass}>
													<Label for={levelId(student.id, area)} class={fieldLabel}
														>{skillLabel(area)}</Label
													>
													<NativeSelect.Root
														id={levelId(student.id, area)}
														name="level"
														class="w-full"
														required
														aria-invalid={missing ? 'true' : undefined}
														aria-describedby={missing ? errorId : undefined}
														onchange={(event) => {
															if (event.currentTarget.value) levelMissing.delete(key);
														}}
													>
														<NativeSelect.Option value="">
															{m.roster_level_placeholder()}
														</NativeSelect.Option>
														{#each skillLevels as level (level)}
															<NativeSelect.Option value={level}
																>{levelLabel(level)}</NativeSelect.Option
															>
														{/each}
													</NativeSelect.Root>
													{#if missing}
														<p id={errorId} class={ui.error} role="alert">
															{m.roster_error_invalid_level()}
														</p>
													{/if}
												</div>
												<div class={fieldClass}>
													<Label for="notes-{student.id}-{area}" class={fieldLabel}
														>{m.roster_notes_placeholder()}</Label
													>
													<Input
														id="notes-{student.id}-{area}"
														name="notes"
														aria-describedby="notes-hint-{student.id}-{area}"
													/>
													<small
														id="notes-hint-{student.id}-{area}"
														class="text-xs leading-snug {ui.muted}"
													>
														{m.roster_notes_parent_hint()}
													</small>
												</div>
												<Button
													variant="secondary"
													type="submit"
													class="{ui.touch} w-full gap-2 md:w-fit"
													disabled={savingSkills.has(key)}
													aria-busy={savingSkills.has(key) || undefined}
												>
													{#if savingSkills.has(key)}
														<LoaderCircle class="animate-spin" aria-hidden="true" />
													{/if}
													{m.roster_set_status()}
												</Button>
											</form>
										{/each}
									</div>

									<h4 class="mt-4 text-lg font-bold">{m.roster_col_history()}</h4>
									<p class={historySubheading}>{m.roster_skills_heading()}</p>
									{#if skillHistoryFor(student.id).length === 0}
										<p class="mt-1 {ui.muted}">{m.roster_history_empty()}</p>
									{:else}
										<ul class={historyList}>
											{#each skillHistoryFor(student.id) as entry (entry.id)}
												<li class="py-1.5 wrap-break-word">
													<strong>{skillLabel(entry.skillArea)}</strong> — {levelLabel(entry.level)}
													<span class={ui.muted}>
														· {formatInstant(entry.recordedAt, true)}
													</span>
													{#if entry.notes}
														<p class="mt-1 {ui.muted}">{entry.notes}</p>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}

									<p class={historySubheading}>{m.roster_attendance_heading()}</p>
									{#if attendanceHistoryFor(student.id).length === 0}
										<p class="mt-1 {ui.muted}">{m.roster_history_empty()}</p>
									{:else}
										<ul class={historyList}>
											{#each attendanceHistoryFor(student.id) as entry (entry.id)}
												<li class="py-1.5">
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
