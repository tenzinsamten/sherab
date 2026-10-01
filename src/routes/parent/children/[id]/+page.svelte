<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { ixFieldError, ixValue } from '$lib/ix-fields';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import StudentProgressTiles from '$lib/components/StudentProgressTiles.svelte';
	import type { LeaveRangeOutcome, SkillArea, SkillLevel } from '$lib/supabase/database.types';
	import type { ActionData, PageProps } from './$types';

	/**
	 * Stories 7-4, 7-5: a parent's leave page for one approved child. Each
	 * session from yesterday on shows its current answer and, until it
	 * starts, Coming / On leave. On leave first asks the database how it will
	 * count (preview_leave) and saves only after the parent confirms. Sick is
	 * offered for yesterday's and today's sessions; a Sick answer shows its
	 * decision, and a decided session has no controls.
	 *
	 * Detail-page follow-up (deferred from 7-3): four link-based tabs
	 * (?tab=overview|homework|sessions|record), all read-only apart from the
	 * leave and deletion forms, which post back to the tab they sit on.
	 *
	 * B11 (#57): "Plan a leave period" sets On leave (or back to Coming) for
	 * every session in a from / to period, all classes or one, after a
	 * preview dialog that lists what happens to each session.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const tabs = $derived([
		{ id: 'overview' as const, label: m.child_tab_overview() },
		{ id: 'homework' as const, label: m.student_class_homework_heading() },
		{ id: 'sessions' as const, label: m.leave_sessions_label() },
		{ id: 'record' as const, label: m.child_tab_record() }
	]);

	const baseHref = $derived(resolve('/parent/children/[id]', { id: data.child.id }));

	function tabHref(tab: string, donePage = 1): string {
		return donePage > 1 ? `${baseHref}?tab=${tab}&done=${donePage}` : `${baseHref}?tab=${tab}`;
	}

	const skillAreas: SkillArea[] = ['language', 'song', 'dance'];

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

	// A timestamp as a Berlin calendar date (same on server and client).
	function formatInstant(iso: string): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: 'Europe/Berlin'
			}).format(new Date(iso));
		} catch {
			return iso.slice(0, 10);
		}
	}

	const pending = createPending();

	// Wall-clock dates: format as UTC so no time zone shifts the day.
	function formatDay(date: string): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), {
				weekday: 'short',
				day: 'numeric',
				month: 'long',
				timeZone: 'UTC'
			}).format(new Date(`${date}T00:00:00Z`));
		} catch {
			return date;
		}
	}

	function answerLabel(answer: string | null): string {
		if (answer === 'coming') return m.leave_answer_coming();
		if (answer === 'on_leave') return m.leave_answer_on_leave();
		if (answer === 'sick') return m.leave_answer_sick();
		return m.leave_answer_none();
	}

	function decisionLabel(decision: string | null): string {
		if (decision === 'approved') return m.leave_decision_approved();
		if (decision === 'rejected') return m.leave_decision_rejected();
		return m.leave_decision_pending();
	}

	function classificationLabel(classification: string | null): string {
		return classification === 'planned' ? m.leave_class_planned() : m.leave_class_short_notice();
	}

	// The On leave preview waiting for confirmation (one session at a time).
	let preview = $state<{ sessionId: string; classification: 'planned' | 'short_notice' } | null>(
		null
	);
	$effect.pre(() => {
		const f = form as ActionData;
		if (f && 'action' in f && f.action === 'preview') {
			preview = { sessionId: f.sessionId, classification: f.preview };
		} else {
			preview = null;
		}
	});

	let errorFor = $derived(
		form && 'error' in form && form.error
			? { sessionId: form.sessionId, message: form.error }
			: null
	);

	$effect(() => {
		if (form && 'action' in form && form.action === 'setLeave' && form.success) {
			showToast('success', m.leave_saved());
		}
		if (form && 'action' in form && form.action === 'requestDeletion' && form.success) {
			showToast('success', m.deletion_requested());
		}
	});

	// ── B11: leave period ─────────────────────────────────────────────────
	type ModalElement = HTMLElement & {
		showModal(): Promise<void>;
		closeModal(reason?: unknown): Promise<void>;
	};
	type RangeResult = Extract<NonNullable<ActionData>, { action: 'previewLeaveRange' }>;

	const CHANGING: readonly LeaveRangeOutcome[] = ['planned', 'short_notice', 'coming'];

	let rangeModal = $state<HTMLElement>();
	let rangeOpen = $state(false);
	let rangePreview = $state<RangeResult | null>(null);
	let rangeAnswer = $state<'on_leave' | 'coming'>('on_leave');

	// The fields' values as last posted (kept after an error or a preview).
	let rangeValues = $derived(
		form && 'range' in form && form.range
			? form.range
			: { from: '', to: '', classId: null, answer: 'on_leave' as const }
	);
	// A range error is dropped once the dialog it was shown in is closed.
	let dismissedRangeForm = $state<unknown>(null);
	let rangeError = $derived(
		form && form !== dismissedRangeForm && 'rangeError' in form && form.rangeError
			? { field: form.rangeField ?? null, message: form.rangeError }
			: null
	);
	// The card shows errors only while the dialog is closed (the dialog has its own).
	let fieldError = $derived(rangeOpen ? null : rangeError);
	// Set when the dialog is closed so the dates can be fixed: keep that error.
	let closingForDates = false;

	let rangeCounts = $derived.by(() => {
		const rows = rangePreview?.rows ?? [];
		const count = (outcome: LeaveRangeOutcome) => rows.filter((r) => r.outcome === outcome).length;
		const changing = rows.filter((r) => CHANGING.includes(r.outcome)).length;
		return {
			total: rows.length,
			planned: count('planned'),
			short: count('short_notice'),
			coming: count('coming'),
			changing,
			skipped: rows.length - changing
		};
	});

	function pickRangeAnswer(event: CustomEvent<string>) {
		if (event.detail === 'on_leave' || event.detail === 'coming') rangeAnswer = event.detail;
	}

	function outcomeLabel(outcome: LeaveRangeOutcome): string {
		switch (outcome) {
			case 'planned':
				return m.leave_range_outcome_planned();
			case 'short_notice':
				return m.leave_range_outcome_short_notice();
			case 'coming':
				return m.leave_range_outcome_coming();
			case 'already_on_leave':
				return m.leave_range_outcome_already_on_leave();
			case 'already_coming':
				return m.leave_range_outcome_already_coming();
			case 'started':
				return m.leave_range_outcome_started();
			case 'cancelled':
				return m.leave_range_outcome_cancelled();
			case 'decided':
				return m.leave_range_outcome_decided();
			case 'sick':
				return m.leave_range_outcome_sick();
			default:
				return m.leave_range_outcome_skipped();
		}
	}

	function outcomeVariant(outcome: LeaveRangeOutcome): string {
		if (outcome === 'planned' || outcome === 'short_notice') return 'warning';
		if (outcome === 'coming') return 'success';
		return 'neutral';
	}

	async function openRangeModal() {
		await tick();
		const modal = rangeModal as
			(ModalElement & { componentOnReady?: () => Promise<unknown> }) | undefined;
		if (!modal) return;
		await customElements.whenDefined('ix-modal');
		await modal.componentOnReady?.();
		// The <dialog> is in ix-modal's shadow DOM: name it directly.
		modal.shadowRoot
			?.querySelector('dialog')
			?.setAttribute('aria-label', m.leave_range_dialog_title());
		rangeOpen = true;
		await modal.showModal();
	}

	function closeRangeModal() {
		void (rangeModal as ModalElement | undefined)?.closeModal();
	}

	function onRangeClosed() {
		rangeOpen = false;
		if (!closingForDates) dismissedRangeForm = form;
		closingForDates = false;
		void tick().then(() => document.getElementById('range-preview')?.focus());
	}

	// A new preview opens the dialog; a saved period closes it with a toast.
	let lastRangeForm: unknown;
	$effect(() => {
		const f = form as ActionData;
		if (!f || f === lastRangeForm) return;
		lastRangeForm = f;
		if ('action' in f && f.action === 'previewLeaveRange') {
			rangePreview = f;
			rangeAnswer = f.range.answer;
			void openRangeModal();
		} else if ('action' in f && f.action === 'setLeaveRange' && f.success) {
			showToast('success', m.leave_range_saved({ count: f.changed, skipped: f.skipped }));
			if (rangeOpen) closeRangeModal();
			rangePreview = null;
		} else if ('rangeField' in f && f.rangeField === 'dates' && rangeOpen) {
			// The period no longer holds (e.g. its start has passed): close the
			// dialog so the dates can be fixed, keeping the error on them.
			closingForDates = true;
			closeRangeModal();
		}
	});

	// Story 7-6: a deletion request is sent only after a confirm step.
	let deletionForm: HTMLFormElement | undefined = $state();
	async function requestDeletion() {
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.deletion_confirm({ name: data.child.name }),
			m.deletion_request(),
			m.common_cancel()
		);
		if (!ok) return;
		await tick();
		deletionForm?.requestSubmit();
	}
</script>

<svelte:head>
	<title>{data.child.name} — {m.parent_kicker()} — Sherab</title>
</svelte:head>

<div class="page">
	<PageBreadcrumb
		items={[
			{ label: m.nav_dashboard(), href: resolve('/parent') },
			// On Overview the child level is the current page itself: no link.
			{ label: data.child.name, href: data.tab === 'overview' ? undefined : baseHref },
			{ label: tabs.find((tab) => tab.id === data.tab)?.label ?? m.child_tab_overview() }
		]}
	/>
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.parent_kicker()}</p>
			<h1 class="page-heading">{data.child.name}</h1>
		</div>
	</header>

	<nav class="tabs" aria-label={m.child_tabs_label()}>
		<ul>
			{#each tabs as tab (tab.id)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tabHref() builds on resolve() and only adds ?tab=. -->
					<a href={tabHref(tab.id)} aria-current={data.tab === tab.id ? 'page' : undefined}>
						{tab.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	{#if data.tab === 'overview'}
		<StudentProgressTiles
			streak={data.streak}
			badges={data.badges}
			loadError={data.errors.summary}
		/>

		<section class="card" aria-labelledby="team-heading">
			<h2 id="team-heading">{m.leaderboard_heading()}</h2>
			{#if data.errors.team}
				<p class="muted section-error" role="alert">{m.child_section_error()}</p>
			{:else}
				<p class="team-line">
					<span class="section-label">{m.child_team_label()}</span>
					{#if data.team}
						<strong class="stat-tile-value"
							>{m.student_team_rank({ rank: data.team.rank, total: data.team.total })}</strong
						>
						<span class="muted">{data.team.name}</span>
					{:else}
						<span class="muted">{m.child_team_none()}</span>
					{/if}
				</p>
				{#if data.leaderboard.length === 0}
					<p class="muted empty">{m.leaderboard_empty()}</p>
				{:else}
					<ol class="leaderboard">
						{#each data.leaderboard as row, index (row.teamId)}
							<li class:own={row.teamId === data.teamId}>
								<span class="rank">{index + 1}</span>
								<span class="team-name">
									{row.teamName}
									{#if row.teamId === data.teamId}
										<ix-pill variant="primary"
											>{m.child_team_marker({ name: data.child.name })}</ix-pill
										>
									{/if}
								</span>
								<span>{m.leaderboard_streak_weeks({ count: row.totalStreak })}</span>
							</li>
						{/each}
					</ol>
				{/if}
			{/if}
		</section>

		<section class="card" aria-labelledby="teachers-heading">
			<h2 id="teachers-heading">{m.child_teachers_heading()}</h2>
			{#if data.errors.teachers}
				<p class="muted section-error" role="alert">{m.child_section_error()}</p>
			{/if}
			{#if data.teachers.length === 0}
				{#if !data.errors.teachers}
					<p class="muted empty">{m.parent_card_no_classes()}</p>
				{/if}
			{:else}
				<ul class="plain-list">
					{#each data.teachers as cls (cls.classId)}
						<li>
							<strong>{cls.className}</strong>
							<span class="muted">
								{cls.teachers.length > 0
									? m.student_class_taught_by({
											names: cls.teachers.map((t) => t.name).join(', ')
										})
									: m.student_class_no_teachers()}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card" aria-labelledby="deletion-heading">
			<h2 id="deletion-heading">{m.deletion_heading()}</h2>
			<p class="muted">{m.deletion_intro({ name: data.child.name })}</p>
			{#if data.deletionLoadError}
				<ix-empty-state header={m.load_error_generic()} icon="info"></ix-empty-state>
			{:else}
				{#if data.deletion}
					<p role="status">
						<ix-pill variant={data.deletion.status === 'pending' ? 'neutral' : 'alarm'}>
							{data.deletion.status === 'pending'
								? m.deletion_status_pending()
								: m.deletion_status_rejected()}
						</ix-pill>
					</p>
				{/if}
				{#if data.deletion?.status !== 'pending'}
					<ix-button
						variant="danger-secondary"
						icon="trashcan"
						loading={pending.is('requestDeletion') || undefined}
						disabled={pending.busy || undefined}
						onclick={requestDeletion}
					>
						{m.deletion_request()}
					</ix-button>
					<form
						bind:this={deletionForm}
						method="POST"
						action="?tab=overview&/requestDeletion"
						use:enhance={pending.submit('requestDeletion')}
						hidden
					></form>
				{/if}
			{/if}
			{#if form && 'deletionError' in form && form.deletionError}
				<p class="field-error" role="alert">{form.deletionError}</p>
			{/if}
		</section>
	{:else if data.tab === 'homework'}
		<section class="card" aria-labelledby="open-heading">
			<h2 id="open-heading">
				{m.parent_card_open()}{data.errors.open ? '' : ` (${data.homework.open.length})`}
			</h2>
			{#if data.errors.open}
				<p class="muted section-error" role="alert">{m.child_section_error()}</p>
			{/if}
			{#if data.homework.open.length === 0}
				{#if !data.errors.open}
					<p class="muted empty">{m.student_homework_empty()}</p>
				{/if}
			{:else}
				{@render homeworkList(data.homework.open)}
			{/if}
		</section>

		<section class="card" aria-labelledby="done-heading">
			<h2 id="done-heading">{m.child_done_heading()}</h2>
			{#if data.errors.done}
				<p class="muted section-error" role="alert">{m.child_section_error()}</p>
			{/if}
			{#if data.homework.done.length === 0}
				{#if !data.errors.done}
					<p class="muted empty">{m.student_done_empty()}</p>
				{/if}
			{:else}
				{@render homeworkList(data.homework.done)}
				<Pager
					page={data.homework.donePage}
					pageCount={data.homework.donePageCount}
					hrefFor={(n) => tabHref('homework', n)}
				/>
			{/if}
		</section>
	{:else if data.tab === 'sessions'}
		{#if data.rangeLoadError}
			<section class="card" aria-labelledby="range-heading">
				<h2 id="range-heading">{m.leave_range_heading()}</h2>
				<ix-empty-state header={m.load_error_generic()} icon="info"></ix-empty-state>
			</section>
		{:else if data.rangeClasses.length > 0}
			<section class="card" aria-labelledby="range-heading">
				<h2 id="range-heading">{m.leave_range_heading()}</h2>
				<p id="range-intro" class="muted">{m.leave_range_intro()}</p>
				<form
					method="POST"
					action="?tab=sessions&/previewLeaveRange"
					use:enhance={pending.submit('rangePreview', { reset: false })}
					novalidate
				>
					<div class="range-dates">
						<div class="field">
							<ix-date-input
								id="range-from"
								name="from"
								label={m.leave_range_from()}
								format="yyyy-MM-dd"
								required
								{@attach ixValue(rangeValues.from)}
								{@attach ixFieldError(
									fieldError?.field === 'dates' ? 'range-dates-error' : undefined,
									['range-intro']
								)}
							></ix-date-input>
						</div>
						<div class="field">
							<ix-date-input
								id="range-to"
								name="to"
								label={m.leave_range_to()}
								format="yyyy-MM-dd"
								required
								{@attach ixValue(rangeValues.to)}
								{@attach ixFieldError(
									fieldError?.field === 'dates' ? 'range-dates-error' : undefined,
									['range-intro']
								)}
							></ix-date-input>
						</div>
					</div>
					{#if fieldError?.field === 'dates'}
						<p id="range-dates-error" class="field-error" role="alert">{fieldError.message}</p>
					{/if}
					<div class="field">
						<ix-select
							id="range-class"
							name="classId"
							label={m.leave_range_class()}
							{@attach ixValue(rangeValues.classId ?? 'all')}
							{@attach ixFieldError(
								fieldError?.field === 'class' ? 'range-class-error' : undefined
							)}
						>
							<ix-select-item value="all" label={m.leave_range_all_classes()}></ix-select-item>
							{#each data.rangeClasses as cls (cls.id)}
								<ix-select-item value={cls.id} label={cls.name}></ix-select-item>
							{/each}
						</ix-select>
						{#if fieldError?.field === 'class'}
							<p id="range-class-error" class="field-error" role="alert">{fieldError.message}</p>
						{/if}
					</div>
					<div class="field">
						<ix-radio-group
							id="range-answer"
							label={m.leave_range_answer()}
							value={rangeAnswer}
							onvalueChange={pickRangeAnswer}
							{@attach ixFieldError(
								fieldError?.field === 'answer' ? 'range-answer-error' : undefined
							)}
						>
							<ix-radio name="answer" value="on_leave" label={m.leave_answer_on_leave()}></ix-radio>
							<ix-radio name="answer" value="coming" label={m.leave_answer_coming()}></ix-radio>
						</ix-radio-group>
						{#if fieldError?.field === 'answer'}
							<p id="range-answer-error" class="field-error" role="alert">{fieldError.message}</p>
						{/if}
					</div>
					{#if fieldError && fieldError.field === null}
						<p class="field-error" role="alert">{fieldError.message}</p>
					{/if}
					<ix-button
						id="range-preview"
						type="submit"
						loading={pending.is('rangePreview') || undefined}
						disabled={pending.busy || undefined}
					>
						{m.leave_range_preview()}
					</ix-button>
				</form>
			</section>

			<ix-modal
				bind:this={rangeModal}
				size="600"
				ondialogClose={onRangeClosed}
				ondialogDismiss={onRangeClosed}
			>
				<!-- svelte-ignore a11y_unknown_aria_attribute -->
				<ix-modal-header aria-label-close-icon-button={m.calendar_dialog_close()}>
					{m.leave_range_dialog_title()}
				</ix-modal-header>
				<ix-modal-content>
					{#if rangePreview}
						{@const range = rangePreview.range}
						<p class="range-period">
							<strong
								>{m.leave_range_period({
									from: formatDay(range.from),
									to: formatDay(range.to)
								})}</strong
							>
							<span class="muted">
								· {range.classId
									? (data.rangeClasses.find((c) => c.id === range.classId)?.name ?? '')
									: m.leave_range_all_classes()}
								· {range.answer === 'coming' ? m.leave_answer_coming() : m.leave_answer_on_leave()}
							</span>
						</p>
						{#if range.to > rangePreview.listEnd}
							<p class="range-beyond muted">
								{m.leave_range_beyond_list({ date: formatDay(rangePreview.listEnd) })}
							</p>
						{/if}
						{#if rangeCounts.total === 0}
							<p class="range-summary" role="status">{m.leave_range_empty()}</p>
						{:else}
							<p class="range-summary" role="status">
								{range.answer === 'coming'
									? m.leave_range_summary_coming({
											total: rangeCounts.total,
											coming: rangeCounts.coming,
											skipped: rangeCounts.skipped
										})
									: m.leave_range_summary_on_leave({
											total: rangeCounts.total,
											planned: rangeCounts.planned,
											short: rangeCounts.short,
											skipped: rangeCounts.skipped
										})}
							</p>
							<ul class="plain-list range-list">
								{#each rangePreview.rows as row (row.sessionId)}
									<li class="row">
										<span>
											<time datetime={row.day}>{formatDay(row.day)}</time>
											<span class="muted">· {row.className}</span>
										</span>
										<ix-pill
											variant={outcomeVariant(row.outcome)}
											outline={!CHANGING.includes(row.outcome) || undefined}
										>
											{outcomeLabel(row.outcome)}
										</ix-pill>
									</li>
								{/each}
							</ul>
						{/if}
						{#if rangeError && rangeOpen}
							<p class="field-error" role="alert">{rangeError.message}</p>
						{/if}
					{/if}
				</ix-modal-content>
				<ix-modal-footer>
					<ix-button variant="secondary" onclick={closeRangeModal}>
						{m.common_cancel()}
					</ix-button>
					{#if rangePreview}
						<form
							method="POST"
							action="?tab=sessions&/setLeaveRange"
							use:enhance={pending.submit('rangeSave', { reset: false })}
							class="inline-form"
						>
							<input type="hidden" name="from" value={rangePreview.range.from} />
							<input type="hidden" name="to" value={rangePreview.range.to} />
							<input type="hidden" name="classId" value={rangePreview.range.classId ?? 'all'} />
							<input type="hidden" name="answer" value={rangePreview.range.answer} />
							<ix-button
								type="submit"
								variant="primary"
								loading={pending.is('rangeSave') || undefined}
								disabled={pending.busy || rangeCounts.changing === 0 || undefined}
							>
								{m.leave_range_save()}
							</ix-button>
						</form>
					{/if}
				</ix-modal-footer>
			</ix-modal>
		{/if}

		<section class="card">
			<h2>{m.leave_sessions_label()}</h2>
			<p class="muted">{m.leave_intro()}</p>
			{#if data.loadError}
				<ix-empty-state header={m.load_error_generic()} icon="info"></ix-empty-state>
			{:else if data.sessions.length === 0}
				<ix-empty-state header={m.leave_empty()} icon="calendar"></ix-empty-state>
			{:else}
				<ul class="sessions" aria-label={m.leave_sessions_label()}>
					{#each data.sessions as session (session.id)}
						<li class="session">
							<div class="session-info">
								<p class="session-when">
									<strong><time datetime={session.day}>{formatDay(session.day)}</time></strong>
									<span>
										{session.startTime ?? m.calendar_status_unset()}
										{#if session.durationMinutes}
											· {m.leave_duration({ minutes: session.durationMinutes })}
										{/if}
									</span>
								</p>
								<p class="muted session-class">{session.className}</p>
							</div>
							<div class="session-answer">
								<span class="sr-only">{m.leave_answer_label()}:</span>
								{#if session.answer === 'on_leave'}
									<ix-pill variant="warning">
										{answerLabel(session.answer)} · {classificationLabel(session.classification)}
									</ix-pill>
								{:else if session.answer === 'coming'}
									<ix-pill variant="success" outline>{answerLabel(session.answer)}</ix-pill>
								{:else if session.answer === 'sick'}
									<ix-pill
										variant={session.decision === 'approved'
											? 'success'
											: session.decision === 'rejected'
												? 'alarm'
												: 'neutral'}
									>
										{answerLabel(session.answer)} · {decisionLabel(session.decision)}
									</ix-pill>
								{:else}
									<ix-pill variant="neutral" outline>{answerLabel(null)}</ix-pill>
								{/if}
							</div>
							{#if session.decision}
								<!-- Story 7-5: a decided Sick locks the session's answers. -->
							{:else if session.open || session.sickOpen}
								<div class="session-controls">
									{#if session.open && preview?.sessionId === session.id}
										<p class="preview" role="status">
											{preview.classification === 'planned'
												? m.leave_preview_planned()
												: m.leave_preview_short_notice()}
										</p>
										<form
											method="POST"
											action="?tab=sessions&/setLeave"
											use:enhance={pending.submit(`confirm:${session.id}`)}
											class="inline-form"
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<input type="hidden" name="answer" value="on_leave" />
											<ix-button
												type="submit"
												variant="primary"
												loading={pending.is(`confirm:${session.id}`) || undefined}
												disabled={pending.busy || undefined}
											>
												{m.leave_confirm()}
											</ix-button>
											<ix-button
												variant="tertiary"
												disabled={pending.busy || undefined}
												onclick={() => (preview = null)}
											>
												{m.leave_keep()}
											</ix-button>
										</form>
									{:else if session.open}
										<form
											method="POST"
											action="?tab=sessions&/setLeave"
											use:enhance={pending.submit(`coming:${session.id}`)}
											class="inline-form"
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<input type="hidden" name="answer" value="coming" />
											<ix-button
												type="submit"
												variant={session.answer === 'coming' ? 'primary' : 'secondary'}
												loading={pending.is(`coming:${session.id}`) || undefined}
												disabled={pending.busy || undefined}
											>
												{m.leave_answer_coming()}
											</ix-button>
										</form>
										<form
											method="POST"
											action="?tab=sessions&/preview"
											use:enhance={pending.submit(`preview:${session.id}`)}
											class="inline-form"
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<ix-button
												type="submit"
												variant={session.answer === 'on_leave' ? 'primary' : 'secondary'}
												loading={pending.is(`preview:${session.id}`) || undefined}
												disabled={pending.busy || undefined}
											>
												{m.leave_answer_on_leave()}
											</ix-button>
										</form>
									{/if}
									{#if session.sickOpen && preview?.sessionId !== session.id}
										<form
											method="POST"
											action="?tab=sessions&/setLeave"
											use:enhance={pending.submit(`sick:${session.id}`)}
											class="inline-form"
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<input type="hidden" name="answer" value="sick" />
											<ix-button
												type="submit"
												variant={session.answer === 'sick' ? 'primary' : 'secondary'}
												loading={pending.is(`sick:${session.id}`) || undefined}
												disabled={pending.busy || undefined}
											>
												{m.leave_answer_sick()}
											</ix-button>
										</form>
									{/if}
								</div>
							{:else}
								<p class="muted session-started">{m.leave_started()}</p>
							{/if}
							{#if errorFor?.sessionId === session.id}
								<p class="field-error session-error" role="alert">{errorFor.message}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<section class="card" aria-labelledby="attendance-heading">
			<h2 id="attendance-heading">{m.child_attendance_heading()}</h2>
			{#if data.errors.attendance}
				<p class="muted section-error" role="alert">{m.child_section_error()}</p>
			{:else if data.attendance.length === 0}
				<p class="muted empty">{m.child_attendance_empty()}</p>
			{:else}
				<ul class="plain-list">
					{#each data.attendance as entry, i (`${entry.sessionDate}:${entry.classId}:${i}`)}
						<li class="row">
							<span>
								<time datetime={entry.sessionDate}>{formatDay(entry.sessionDate)}</time>
								<span class="muted">· {entry.className}</span>
							</span>
							{#if entry.present}
								<ix-pill variant="success" outline>{m.roster_present()}</ix-pill>
							{:else}
								<ix-pill variant="alarm" outline>{m.roster_absent()}</ix-pill>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card" aria-labelledby="skills-heading">
			<h2 id="skills-heading">{m.roster_skills_heading()}</h2>
			{#if data.errors.skills}
				<p class="muted section-error" role="alert">{m.child_section_error()}</p>
			{:else if data.skills.length === 0}
				<p class="muted empty">{m.child_skills_empty()}</p>
			{:else}
				{#each data.skills as cls (cls.classId)}
					<div class="skill-class">
						<h3>{cls.className ?? m.student_class_former()}</h3>
						<dl class="skill-grid">
							{#each skillAreas as area (area)}
								<div>
									<dt class="muted">{skillLabel(area)}</dt>
									<dd class:muted={!cls.current[area]}>
										{cls.current[area]
											? levelLabel(cls.current[area].level)
											: m.roster_no_entry_yet()}
									</dd>
								</div>
							{/each}
						</dl>
						<details>
							<summary>{m.roster_view_history()}</summary>
							{#if cls.history.length === 0}
								<p class="muted">{m.roster_history_empty()}</p>
							{:else}
								<ul class="plain-list">
									{#each cls.history as entry (entry.id)}
										<li>
											<strong>{skillLabel(entry.skillArea)}</strong> — {levelLabel(entry.level)}
											<span class="muted">
												· <time datetime={entry.recordedAt}>{formatInstant(entry.recordedAt)}</time>
											</span>
											{#if entry.notes}
												<p class="note">{entry.notes}</p>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</details>
					</div>
				{/each}
			{/if}
		</section>
	{/if}
</div>

{#snippet homeworkList(items: typeof data.homework.open)}
	<ul class="plain-list">
		{#each items as item (item.instanceId)}
			<li class="homework">
				<p class="homework-title">
					<strong lang={item.contentLanguage}>{item.title}</strong>
					{#if item.overdue}
						<ix-pill variant="alarm">{m.student_homework_overdue_label()}</ix-pill>
					{/if}
					{#if item.status === 'reviewed'}
						<ix-pill variant="success">{m.student_homework_status_reviewed()}</ix-pill>
					{:else if item.status === 'done'}
						<ix-pill variant="info">{m.student_homework_status_done()}</ix-pill>
					{/if}
				</p>
				<p class="muted homework-meta">
					{item.className ?? m.student_class_former()} · {m.student_homework_due_label({
						date: formatDay(item.dueDate)
					})}
				</p>
				{#if item.referenceLinks.length > 0}
					<ul class="links">
						{#each item.referenceLinks as link, i (i)}
							<li>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external teacher-supplied URL, opens externally. -->
								<a href={link.url} target="_blank" rel="noopener noreferrer"
									>{link.label ?? link.url}</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<style>
	.tabs {
		margin-bottom: var(--space-4);
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
		overflow-x: auto;
	}

	.tabs ul {
		display: flex;
		gap: var(--space-1);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tabs a {
		display: inline-block;
		padding: var(--space-2) var(--space-3);
		color: inherit;
		text-decoration: none;
		white-space: nowrap;
		border-bottom: 3px solid transparent;
	}

	.tabs a:hover,
	.tabs a:focus-visible {
		text-decoration: underline;
	}

	.tabs a[aria-current='page'] {
		font-weight: 700;
		border-bottom-color: var(--theme-color-primary, currentColor);
	}

	.plain-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.plain-list > li {
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
	}

	.plain-list > li:last-child {
		border-bottom: none;
	}

	.plain-list > li.row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
	}

	.empty,
	.section-error {
		margin: 0;
	}

	.homework-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}

	.homework-meta {
		margin: var(--space-1) 0 0;
	}

	.links {
		margin: var(--space-1) 0 0;
		padding-left: var(--space-4);
		overflow-wrap: anywhere;
	}

	.team-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		margin: 0 0 var(--space-3);
	}

	.team-line .section-label {
		margin: 0;
	}

	.leaderboard {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.leaderboard li {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-2);
		border-radius: var(--theme-default-border-radius, 4px);
	}

	.leaderboard li.own {
		font-weight: 700;
		background: var(--theme-color-component-1, rgba(0, 0, 0, 0.05));
	}

	.team-name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.skill-class + .skill-class {
		margin-top: var(--space-4);
	}

	.skill-class h3 {
		margin: 0 0 var(--space-2);
	}

	.skill-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
	}

	.skill-grid dd {
		margin: 0;
		font-weight: 700;
	}

	.note {
		margin: var(--space-1) 0 0;
		white-space: pre-line;
	}

	.sessions {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.session {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2) var(--space-4);
		align-items: center;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
	}

	.session:last-child {
		border-bottom: none;
	}

	.session-when {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
	}

	.session-class {
		margin: 0;
	}

	.session-controls,
	.session-started,
	.session-error {
		grid-column: 1 / -1;
		margin: 0;
	}

	.session-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.inline-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.preview {
		flex-basis: 100%;
		margin: 0;
	}

	.range-dates {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0 var(--space-4);
	}

	.range-period,
	.range-beyond,
	.range-summary {
		margin: 0 0 var(--space-2);
	}

	.range-list {
		max-height: 50vh;
		overflow-y: auto;
	}
</style>
