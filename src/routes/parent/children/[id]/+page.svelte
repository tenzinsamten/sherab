<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import {
		formatDay as formatIsoDay,
		formatInstant as formatSchoolInstant,
		num
	} from '$lib/format';
	import { showToast } from '$lib/toast';
	import { createPending } from '$lib/pending.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import PageBreadcrumb from '$lib/components/PageBreadcrumb.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import StudentProgressTiles from '$lib/components/StudentProgressTiles.svelte';
	import { ui } from '$lib/ui/classes';
	import { cn } from '$lib/utils';
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
	 * preview that lists what happens to each session.
	 *
	 * Mobile-first story 3: built on the new component system. The period
	 * preview is a bottom sheet on a phone and a dialog from 48rem; without
	 * JavaScript it is shown in the page, under the form, and saves from
	 * there. The deletion request asks in an alert dialog. A session's
	 * answers are full-width buttons under the row on a phone.
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
	const formatInstant = (iso: string) => formatSchoolInstant(iso);

	const pending = createPending();

	// Without JavaScript (or before hydration) the period preview is shown in
	// the page instead of a dialog.
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// The preview is a bottom sheet on a phone, a dialog from 48rem (md).
	const wide = new MediaQuery('min-width: 48rem', false);
	let rangeWide = $state(false);

	// Wall-clock dates: format as UTC so no time zone shifts the day.
	const formatDay = (date: string) =>
		formatIsoDay(date, { weekday: 'short', day: 'numeric', month: 'long' });

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

	// A failed answer also shows as a toast (the root layout toasts `form.error`).
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
			// Focus moves to the pending status that replaces the button.
			focusNext = 'deletion-status';
		} else if (form && 'deletionError' in form && form.deletionError) {
			focusNext = 'deletion-request';
		}
	});

	// ── B11: leave period ─────────────────────────────────────────────────
	type RangeResult = Extract<NonNullable<ActionData>, { action: 'previewLeaveRange' }>;

	const CHANGING: readonly LeaveRangeOutcome[] = ['planned', 'short_notice', 'coming'];
	const ANSWERS = ['on_leave', 'coming'] as const;

	// The fields' values as last posted (kept after an error or a preview).
	let rangeValues = $derived(
		form && 'range' in form && form.range
			? form.range
			: { from: '', to: '', classId: null, answer: 'on_leave' as const }
	);

	// The posted class, or All classes when it is no longer one of the child's.
	let rangeClass = $derived(
		data.rangeClasses.some((c) => c.id === rangeValues.classId) ? rangeValues.classId! : 'all'
	);

	let rangeOpen = $state(false);
	let rangePreview = $state.raw<RangeResult | null>(null);
	// The picked answer; follows what was last posted until the parent picks.
	let pickedAnswer = $state<'on_leave' | 'coming' | null>(null);
	let rangeAnswer = $derived(pickedAnswer ?? rangeValues.answer);

	// A preview posted without JavaScript: shown in the page (no dialog).
	let pagePreview = $derived(
		!hydrated && form && 'action' in form && form.action === 'previewLeaveRange' ? form : null
	);
	let pageSaved = $derived(
		!hydrated && form && 'action' in form && form.action === 'setLeaveRange' && form.success
			? form
			: null
	);
	let shownPreview = $derived(rangePreview ?? pagePreview);

	// A range error is dropped once the dialog it was shown in is closed.
	let dismissedRangeForm = $state.raw<unknown>(null);
	let rangeError = $derived(
		form && form !== dismissedRangeForm && 'rangeError' in form && form.rangeError
			? { field: form.rangeField ?? null, message: form.rangeError }
			: null
	);
	// The card shows errors only while the dialog is closed (the dialog has its own).
	let fieldError = $derived(rangeOpen ? null : rangeError);
	// Set when the dialog is closed so the dates can be fixed: keep that error.
	let closingForDates = false;
	// Whether the dialog's close has been handled (it can close two ways).
	let rangeShown = false;
	// Where focus goes once the dialog has closed.
	let focusAfterClose = 'range-preview';

	let rangeCounts = $derived.by(() => {
		const rows = shownPreview?.rows ?? [];
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

	/** A changing session solid (warning / success), one left as it is outlined. */
	function outcomeVariant(outcome: LeaveRangeOutcome): BadgeVariant {
		if (outcome === 'planned' || outcome === 'short_notice') return 'warning';
		if (outcome === 'coming') return 'success';
		return 'outline';
	}

	/** The field a range error belongs to, focused when the error comes in. */
	function errorFieldId(field: string | null): string {
		if (field === 'dates') return 'range-from';
		if (field === 'class') return 'range-class';
		if (field === 'answer') return `range-answer-${rangeAnswer}`;
		return 'range-preview';
	}

	function rangeClosed() {
		if (!rangeShown) return;
		rangeShown = false;
		focusAfterClose = closingForDates ? 'range-from' : 'range-preview';
		if (!closingForDates) dismissedRangeForm = form;
		closingForDates = false;
	}

	function closeRange() {
		rangeOpen = false;
		rangeClosed();
	}

	// A field or button to focus once nothing is pending: the Preview button
	// is disabled while the save that closed the dialog is still finishing.
	let focusNext = $state<string | null>(null);
	$effect(() => {
		if (!focusNext || pending.busy) return;
		const id = focusNext;
		focusNext = null;
		void tick().then(() => document.getElementById(id)?.focus());
	});

	function focusAfterRangeClose(event: Event) {
		event.preventDefault();
		focusNext = focusAfterClose;
	}

	// A new preview opens the dialog; a saved period closes it with a toast.
	let lastRangeForm: unknown;
	$effect(() => {
		const f = form as ActionData;
		if (!f || f === lastRangeForm) return;
		lastRangeForm = f;
		if ('action' in f && f.action === 'previewLeaveRange') {
			rangePreview = f;
			pickedAnswer = f.range.answer;
			rangeShown = true;
			// The variant is fixed while open: a rotation does not swap it.
			rangeWide = wide.current;
			rangeOpen = true;
		} else if ('action' in f && f.action === 'setLeaveRange' && f.success) {
			showToast('success', m.leave_range_saved({ count: num(f.changed), skipped: num(f.skipped) }));
			if (rangeOpen) closeRange();
		} else if ('rangeField' in f && f.rangeField === 'dates' && rangeOpen) {
			// The period no longer holds (e.g. its start has passed): close the
			// dialog so the dates can be fixed, keeping the error on them.
			closingForDates = true;
			closeRange();
		} else if ('rangeError' in f && f.rangeError && !rangeOpen) {
			// An error on the form: focus moves to the field it belongs to.
			focusNext = errorFieldId(f.rangeField ?? null);
		}
	});

	// Story 7-6: a deletion request is sent only after a confirm step.
	let deletionOpen = $state(false);
	let deletionForm: HTMLFormElement | undefined = $state();
	// Set by Confirm: the dialog's close must not focus the (now busy) button.
	let deletionConfirmed = false;

	function askDeletion(event: MouseEvent) {
		event.preventDefault();
		if (!pending.busy) deletionOpen = true;
	}

	async function confirmDeletion() {
		// A second tap during the close animation posts nothing more.
		if (!deletionOpen || pending.busy) return;
		deletionConfirmed = true;
		deletionOpen = false;
		await tick();
		deletionForm?.requestSubmit();
	}

	function deletionCloseFocus(event: Event) {
		if (!deletionConfirmed) return;
		deletionConfirmed = false;
		event.preventDefault();
	}

	function sessionTour(session: (typeof data.sessions)[number], target: string) {
		return !session.decision && (session.open || session.sickOpen) ? target : undefined;
	}

	const sectionError = `${ui.muted}`;
	const touchButton = `${ui.touch} w-full md:w-auto`;
	const fieldClass = 'flex min-w-0 flex-col gap-1.5';
	const fieldLabel = 'text-sm font-medium';
	const rowItem = 'flex flex-wrap items-center justify-between gap-2 py-3';
</script>

<svelte:head>
	<title>{data.child.name} — {m.parent_kicker()} — Sherab</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<div>
		<PageBreadcrumb
			items={[
				{ label: m.nav_dashboard(), href: resolve('/parent') },
				// On Overview the child level is the current page itself: no link.
				{ label: data.child.name, href: data.tab === 'overview' ? undefined : baseHref },
				{ label: tabs.find((tab) => tab.id === data.tab)?.label ?? m.child_tab_overview() }
			]}
		/>
		<header class={ui.header}>
			<div class="min-w-0">
				<p class={ui.kicker}>{m.parent_kicker()}</p>
				<h1 class={ui.heading}>{data.child.name}</h1>
			</div>
		</header>
	</div>

	<nav
		class="overflow-x-auto border-b border-border"
		aria-label={m.child_tabs_label()}
		data-tour="child-tabs"
	>
		<ul class="flex gap-1">
			{#each tabs as tab (tab.id)}
				<li data-tour={tab.id === 'sessions' ? 'child-tab-sessions' : undefined}>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- tabHref() builds on resolve() and only adds ?tab=. -->
					<a
						href={tabHref(tab.id)}
						aria-current={data.tab === tab.id ? 'page' : undefined}
						class="inline-flex min-h-11 items-center border-b-3 border-transparent px-3 whitespace-nowrap hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:border-primary aria-[current=page]:font-bold aria-[current=page]:text-primary"
					>
						{tab.label}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</li>
			{/each}
		</ul>
	</nav>

	{#if data.tab === 'overview'}
		<StudentProgressTiles
			streak={data.streak}
			badges={data.badges}
			badgeProgress={data.badgeProgress}
			progressLoadError={data.progressLoadError}
			loadError={data.errors.summary}
			seeAllHref={resolve('/parent/children/[id]/badges', { id: data.child.id })}
		/>

		<div class="grid items-start gap-4 md:grid-cols-2">
			<section class={ui.card} aria-labelledby="team-heading">
				<h2 id="team-heading" class={ui.cardTitle}>{m.leaderboard_heading()}</h2>
				{#if data.errors.team}
					<p class={sectionError} role="alert">{m.child_section_error()}</p>
				{:else}
					<p class="mb-3 flex flex-wrap items-baseline gap-2">
						<span class={ui.label}>{m.child_team_label()}</span>
						{#if data.team}
							<strong class="text-2xl font-bold tabular-nums"
								>{m.student_team_rank({
									rank: num(data.team.rank),
									total: num(data.team.total)
								})}</strong
							>
							<!-- #97: the parent may open their own child's team. -->
							{#if data.teamId}
								<a
									href={resolve('/teams/[teamId]', { teamId: data.teamId })}
									class={ui.link}
									aria-label={m.team_students_link_label({ team: data.team.name })}
									>{data.team.name}</a
								>
							{:else}
								<span class={ui.muted}>{data.team.name}</span>
							{/if}
						{:else}
							<span class={ui.muted}>{m.child_team_none()}</span>
						{/if}
					</p>
					{#if data.leaderboard.length === 0}
						<p class={ui.muted}>{m.leaderboard_empty()}</p>
					{:else}
						<ol class="flex flex-col gap-1" data-testid="child-leaderboard">
							{#each data.leaderboard as row, index (row.teamId)}
								{@const own = row.teamId === data.teamId}
								<li
									class={cn(
										'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md p-2',
										own && 'bg-muted font-bold'
									)}
									data-own={own || undefined}
								>
									<span class="tabular-nums">{num(index + 1)}</span>
									<span class="flex min-w-0 flex-wrap items-center gap-2 wrap-break-word">
										{row.teamName}
										{#if own}
											<Badge>{m.child_team_marker({ name: data.child.name })}</Badge>
										{/if}
									</span>
									<span class="text-right"
										>{num(m.leaderboard_streak_weeks({ count: row.totalStreak }))}</span
									>
								</li>
							{/each}
						</ol>
					{/if}
				{/if}
			</section>

			<section class={ui.card} aria-labelledby="teachers-heading">
				<h2 id="teachers-heading" class={ui.cardTitle}>{m.child_teachers_heading()}</h2>
				{#if data.errors.teachers}
					<p class={sectionError} role="alert">{m.child_section_error()}</p>
				{/if}
				{#if data.teachers.length === 0}
					{#if !data.errors.teachers}
						<p class={ui.muted}>{m.parent_card_no_classes()}</p>
					{/if}
				{:else}
					<ul class={ui.rows}>
						{#each data.teachers as cls (cls.classId)}
							<li class="flex flex-col gap-0.5 py-2">
								<strong class="wrap-break-word">{cls.className}</strong>
								<span class={ui.muted}>
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

			<section class="{ui.card} flex flex-col gap-3" aria-labelledby="deletion-heading">
				<h2 id="deletion-heading" class="text-lg leading-snug font-bold">{m.deletion_heading()}</h2>
				<p class={ui.muted}>{m.deletion_intro({ name: data.child.name })}</p>
				{#if data.deletionLoadError}
					<EmptyState header={m.load_error_generic()} icon={Info} />
				{:else}
					{#if data.deletion}
						<!-- Focus lands here once a confirmed request is saved. -->
						<p role="status" id="deletion-status" tabindex="-1" class="outline-none">
							<Badge variant={data.deletion.status === 'pending' ? 'secondary' : 'alarm'}>
								{data.deletion.status === 'pending'
									? m.deletion_status_pending()
									: m.deletion_status_rejected()}
							</Badge>
							{#if data.deletion.status === 'pending' && data.deletion.requestedBy}
								<!-- spec-second-parent story 2: both parents see who asked. -->
								<span class="{ui.muted} ms-2" data-testid="deletion-requested-by">
									{data.deletion.requestedBy.self
										? m.deletion_requested_by_you()
										: m.deletion_requested_by({ name: data.deletion.requestedBy.name })}
								</span>
							{/if}
						</p>
					{/if}
					{#if data.deletion?.status !== 'pending'}
						<!-- Without JavaScript the button posts the request directly;
						     with it, the click asks first in an alert dialog. -->
						<form
							bind:this={deletionForm}
							method="POST"
							action="?tab=overview&/requestDeletion"
							use:enhance={pending.submit('requestDeletion')}
						>
							<Button
								id="deletion-request"
								type="submit"
								variant="destructive"
								class={touchButton}
								disabled={pending.busy}
								aria-busy={pending.is('requestDeletion') || undefined}
								aria-haspopup="dialog"
								onclick={askDeletion}
							>
								{#if pending.is('requestDeletion')}
									{@render spinner('requestDeletion')}
								{:else}
									<Trash2 aria-hidden="true" />
								{/if}
								{m.deletion_request()}
							</Button>
						</form>
						<AlertDialog.Root bind:open={deletionOpen}>
							<AlertDialog.Content
								data-testid="deletion-confirm"
								onCloseAutoFocus={deletionCloseFocus}
							>
								<AlertDialog.Header>
									<AlertDialog.Title>{m.common_confirm_title()}</AlertDialog.Title>
									<AlertDialog.Description>
										{m.deletion_confirm({ name: data.child.name })}
									</AlertDialog.Description>
								</AlertDialog.Header>
								<AlertDialog.Footer>
									<AlertDialog.Cancel class={ui.touch}>{m.common_cancel()}</AlertDialog.Cancel>
									<AlertDialog.Action
										variant="destructive"
										class={ui.touch}
										disabled={pending.busy}
										onclick={() => void confirmDeletion()}
									>
										{m.deletion_request()}
									</AlertDialog.Action>
								</AlertDialog.Footer>
							</AlertDialog.Content>
						</AlertDialog.Root>
					{/if}
				{/if}
				{#if form && 'deletionError' in form && form.deletionError}
					<p class={ui.error} role="alert">{form.deletionError}</p>
				{/if}
			</section>
		</div>
	{:else if data.tab === 'homework'}
		<div class="grid items-start gap-4 md:grid-cols-2">
			<section class={ui.card} aria-labelledby="open-heading">
				<h2 id="open-heading" class={ui.cardTitle}>
					{m.parent_card_open()}{data.errors.open ? '' : ` (${data.homework.open.length})`}
				</h2>
				{#if data.errors.open}
					<p class={sectionError} role="alert">{m.child_section_error()}</p>
				{/if}
				{#if data.homework.open.length === 0}
					{#if !data.errors.open}
						<p class={ui.muted}>{m.student_homework_empty()}</p>
					{/if}
				{:else}
					{@render homeworkList(data.homework.open)}
				{/if}
			</section>

			<section class={ui.card} aria-labelledby="done-heading">
				<h2 id="done-heading" class={ui.cardTitle}>{m.child_done_heading()}</h2>
				{#if data.errors.done}
					<p class={sectionError} role="alert">{m.child_section_error()}</p>
				{/if}
				{#if data.homework.done.length === 0}
					{#if !data.errors.done}
						<p class={ui.muted}>{m.student_done_empty()}</p>
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
		</div>
	{:else if data.tab === 'sessions'}
		{#if data.rangeLoadError}
			<section class={ui.card} aria-labelledby="range-heading">
				<h2 id="range-heading" class={ui.cardTitle}>{m.leave_range_heading()}</h2>
				<EmptyState header={m.load_error_generic()} icon={Info} />
			</section>
		{:else if data.rangeClasses.length > 0}
			<section class={ui.card} aria-labelledby="range-heading">
				<h2 id="range-heading" class="text-lg leading-snug font-bold" data-tour="leave-range">
					{m.leave_range_heading()}
				</h2>
				<p id="range-intro" class="mt-1 mb-4 {ui.muted}">{m.leave_range_intro()}</p>
				<form
					method="POST"
					action="?tab=sessions&/previewLeaveRange"
					use:enhance={pending.submit('rangePreview', { reset: false })}
					novalidate
					class="flex flex-col gap-4"
				>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class={fieldClass}>
							<Label for="range-from" class={fieldLabel}>{m.leave_range_from()}</Label>
							<Input
								id="range-from"
								name="from"
								type="date"
								required
								value={rangeValues.from}
								aria-invalid={fieldError?.field === 'dates' ? 'true' : undefined}
								aria-describedby={fieldError?.field === 'dates'
									? 'range-intro range-dates-error'
									: 'range-intro'}
							/>
						</div>
						<div class={fieldClass}>
							<Label for="range-to" class={fieldLabel}>{m.leave_range_to()}</Label>
							<Input
								id="range-to"
								name="to"
								type="date"
								required
								value={rangeValues.to}
								aria-invalid={fieldError?.field === 'dates' ? 'true' : undefined}
								aria-describedby={fieldError?.field === 'dates'
									? 'range-intro range-dates-error'
									: 'range-intro'}
							/>
						</div>
						{#if fieldError?.field === 'dates'}
							<p id="range-dates-error" class="{ui.error} sm:col-span-2" role="alert">
								{fieldError.message}
							</p>
						{/if}
					</div>
					<div class={fieldClass}>
						<Label for="range-class" class={fieldLabel}>{m.leave_range_class()}</Label>
						<NativeSelect.Root
							id="range-class"
							name="classId"
							class="w-full"
							value={rangeClass}
							aria-invalid={fieldError?.field === 'class' ? 'true' : undefined}
							aria-describedby={fieldError?.field === 'class' ? 'range-class-error' : undefined}
						>
							<NativeSelect.Option value="all" selected={rangeClass === 'all'}
								>{m.leave_range_all_classes()}</NativeSelect.Option
							>
							{#each data.rangeClasses as cls (cls.id)}
								<NativeSelect.Option value={cls.id} selected={rangeClass === cls.id}
									>{cls.name}</NativeSelect.Option
								>
							{/each}
						</NativeSelect.Root>
						{#if fieldError?.field === 'class'}
							<p id="range-class-error" class={ui.error} role="alert">{fieldError.message}</p>
						{/if}
					</div>
					<fieldset
						id="range-answer"
						class={fieldClass}
						aria-describedby={fieldError?.field === 'answer' ? 'range-answer-error' : undefined}
					>
						<legend class="mb-1.5 {fieldLabel}">{m.leave_range_answer()}</legend>
						<div class="flex flex-col gap-2 sm:flex-row">
							{#each ANSWERS as answer (answer)}
								<label
									class="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-ring"
								>
									<!-- svelte-ignore a11y_role_supports_aria_props_implicit -->
									<input
										id="range-answer-{answer}"
										type="radio"
										name="answer"
										value={answer}
										checked={rangeAnswer === answer}
										onchange={() => (pickedAnswer = answer)}
										aria-invalid={fieldError?.field === 'answer' ? 'true' : undefined}
										class="size-5 shrink-0 accent-primary"
									/>
									<span
										>{answer === 'coming'
											? m.leave_answer_coming()
											: m.leave_answer_on_leave()}</span
									>
								</label>
							{/each}
						</div>
						{#if fieldError?.field === 'answer'}
							<p id="range-answer-error" class={ui.error} role="alert">{fieldError.message}</p>
						{/if}
					</fieldset>
					{#if fieldError && fieldError.field === null}
						<p class={ui.error} role="alert">{fieldError.message}</p>
					{/if}
					{#if pageSaved}
						<p role="status" class="font-medium text-success">
							{m.leave_range_saved({
								count: num(pageSaved.changed),
								skipped: num(pageSaved.skipped)
							})}
						</p>
					{/if}
					<div>
						<Button
							id="range-preview"
							type="submit"
							class={touchButton}
							disabled={pending.busy}
							aria-busy={pending.is('rangePreview') || undefined}
						>
							{@render spinner('rangePreview')}
							{m.leave_range_preview()}
						</Button>
					</div>
				</form>
			</section>

			{#if pagePreview}
				<!-- Without JavaScript: the preview in the page, saved from here. -->
				<section
					class="{ui.card} flex flex-col gap-3"
					aria-labelledby="range-page-heading"
					data-testid="range-preview-page"
				>
					<h2 id="range-page-heading" class="text-lg leading-snug font-bold">
						{m.leave_range_dialog_title()}
					</h2>
					{@render rangeSummary(pagePreview)}
					<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button variant="outline" class={touchButton} href={tabHref('sessions')}>
							{m.common_cancel()}
						</Button>
						{@render rangeSave(pagePreview)}
					</div>
				</section>
			{/if}

			<Dialog.Root bind:open={rangeOpen} onOpenChange={(open) => !open && rangeClosed()}>
				{#if rangeWide}
					<Dialog.Content
						data-testid="range-dialog"
						closeLabel={m.calendar_dialog_close()}
						class="flex max-h-[85dvh] flex-col gap-4 p-6 sm:max-w-xl"
						onCloseAutoFocus={focusAfterRangeClose}
					>
						<Dialog.Header class="pr-10">
							<Dialog.Title class="text-lg font-semibold"
								>{m.leave_range_dialog_title()}</Dialog.Title
							>
						</Dialog.Header>
						{@render rangeDialogBody()}
					</Dialog.Content>
				{:else}
					<Sheet.Content
						side="bottom"
						data-testid="range-sheet"
						closeLabel={m.calendar_dialog_close()}
						class="max-h-[90dvh] gap-3 rounded-t-lg px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
						onCloseAutoFocus={focusAfterRangeClose}
					>
						<Sheet.Header class="p-0 pr-12">
							<Sheet.Title class="text-lg font-semibold">{m.leave_range_dialog_title()}</Sheet.Title
							>
						</Sheet.Header>
						{@render rangeDialogBody()}
					</Sheet.Content>
				{/if}
			</Dialog.Root>
		{/if}

		<section class={ui.card} aria-labelledby="sessions-heading">
			<h2 id="sessions-heading" class="text-lg leading-snug font-bold">
				{m.leave_sessions_label()}
			</h2>
			<p class="mt-1 mb-2 {ui.muted}">{m.leave_intro()}</p>
			{#if data.loadError}
				<EmptyState header={m.load_error_generic()} icon={Info} />
			{:else if data.sessions.length === 0}
				<EmptyState header={m.leave_empty()} icon={CalendarDays} />
			{:else}
				<ul class={ui.rows} aria-label={m.leave_sessions_label()}>
					{#each data.sessions as session (session.id)}
						<!-- #101: the tour's three session steps point at one row, the first that can still be answered. -->
						<li
							class="flex flex-col gap-3 py-4 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-4"
							data-tour={sessionTour(session, 'session-row')}
							data-session={session.id}
						>
							<div class="min-w-0">
								<p class="flex flex-wrap gap-x-2">
									<strong><time datetime={session.day}>{formatDay(session.day)}</time></strong>
									<span>
										{session.startTime ?? m.calendar_status_unset()}
										{#if session.durationMinutes}
											· {m.leave_duration({ minutes: num(session.durationMinutes) })}
										{/if}
									</span>
								</p>
								<p class="{ui.muted} wrap-break-word">{session.className}</p>
							</div>
							<div
								class="flex flex-wrap items-center gap-x-2 gap-y-1"
								data-tour={sessionTour(session, 'session-answer')}
							>
								<span class="sr-only">{m.leave_answer_label()}:</span>
								{#if session.answer === 'on_leave'}
									<Badge variant="warning" class="text-sm">
										{answerLabel(session.answer)} · {classificationLabel(session.classification)}
									</Badge>
								{:else if session.answer === 'coming'}
									<Badge variant="success-outline" class="text-sm"
										>{answerLabel(session.answer)}</Badge
									>
								{:else if session.answer === 'sick'}
									<Badge
										class="text-sm"
										variant={session.decision === 'approved'
											? 'success'
											: session.decision === 'rejected'
												? 'alarm'
												: 'secondary'}
									>
										{answerLabel(session.answer)} · {decisionLabel(session.decision)}
									</Badge>
								{:else}
									<Badge variant="outline" class="text-sm">{answerLabel(null)}</Badge>
								{/if}
								{#if session.answer && session.answeredBy}
									<!-- spec-second-parent story 2: which parent set the answer. -->
									<span class="{ui.muted} text-sm" data-testid="leave-set-by">
										{session.answeredBy.self
											? m.leave_set_by_you()
											: m.leave_set_by({ name: session.answeredBy.name })}
									</span>
								{/if}
							</div>
							{#if session.decision}
								<!-- Story 7-5: a decided Sick locks the session's answers. -->
							{:else if session.open || session.sickOpen}
								<div
									class="flex flex-col gap-2 md:col-span-2 md:flex-row md:flex-wrap md:items-center"
									data-tour="session-controls"
								>
									{#if session.open && preview?.sessionId === session.id}
										<p class="md:basis-full" role="status">
											{preview.classification === 'planned'
												? m.leave_preview_planned()
												: m.leave_preview_short_notice()}
										</p>
										<form
											method="POST"
											action="?tab=sessions&/setLeave"
											use:enhance={pending.submit(`confirm:${session.id}`)}
											class="flex flex-col gap-2 md:flex-row"
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<input type="hidden" name="answer" value="on_leave" />
											<Button
												type="submit"
												class={touchButton}
												disabled={pending.busy}
												aria-busy={pending.is(`confirm:${session.id}`) || undefined}
											>
												{@render spinner(`confirm:${session.id}`)}
												{m.leave_confirm()}
											</Button>
											<Button
												variant="ghost"
												class={touchButton}
												disabled={pending.busy}
												onclick={() => (preview = null)}
											>
												{m.leave_keep()}
											</Button>
										</form>
									{:else if session.open}
										<form
											method="POST"
											action="?tab=sessions&/setLeave"
											use:enhance={pending.submit(`coming:${session.id}`)}
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<input type="hidden" name="answer" value="coming" />
											<Button
												type="submit"
												variant={session.answer === 'coming' ? 'default' : 'outline'}
												class={touchButton}
												disabled={pending.busy}
												aria-busy={pending.is(`coming:${session.id}`) || undefined}
											>
												{@render spinner(`coming:${session.id}`)}
												{m.leave_answer_coming()}
											</Button>
										</form>
										<form
											method="POST"
											action="?tab=sessions&/preview"
											use:enhance={pending.submit(`preview:${session.id}`)}
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<Button
												type="submit"
												variant={session.answer === 'on_leave' ? 'default' : 'outline'}
												class={touchButton}
												disabled={pending.busy}
												aria-busy={pending.is(`preview:${session.id}`) || undefined}
											>
												{@render spinner(`preview:${session.id}`)}
												{m.leave_answer_on_leave()}
											</Button>
										</form>
									{/if}
									{#if session.sickOpen && preview?.sessionId !== session.id}
										<form
											method="POST"
											action="?tab=sessions&/setLeave"
											use:enhance={pending.submit(`sick:${session.id}`)}
										>
											<input type="hidden" name="sessionId" value={session.id} />
											<input type="hidden" name="answer" value="sick" />
											<Button
												type="submit"
												variant={session.answer === 'sick' ? 'default' : 'outline'}
												class={touchButton}
												disabled={pending.busy}
												aria-busy={pending.is(`sick:${session.id}`) || undefined}
											>
												{@render spinner(`sick:${session.id}`)}
												{m.leave_answer_sick()}
											</Button>
										</form>
									{/if}
								</div>
							{:else}
								<p class="{ui.muted} md:col-span-2">{m.leave_started()}</p>
							{/if}
							{#if errorFor?.sessionId === session.id}
								<p class="{ui.error} md:col-span-2" role="alert">{errorFor.message}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<div class="grid items-start gap-4 md:grid-cols-2">
			<section class={ui.card} aria-labelledby="attendance-heading">
				<h2 id="attendance-heading" class={ui.cardTitle}>{m.child_attendance_heading()}</h2>
				{#if data.errors.attendance}
					<p class={sectionError} role="alert">{m.child_section_error()}</p>
				{:else if data.attendance.length === 0}
					<p class={ui.muted}>{m.child_attendance_empty()}</p>
				{:else}
					<ul class={ui.rows}>
						{#each data.attendance as entry, i (`${entry.sessionDate}:${entry.classId}:${i}`)}
							<li class={rowItem}>
								<span class="min-w-0">
									<time datetime={entry.sessionDate}>{formatDay(entry.sessionDate)}</time>
									<span class={ui.muted}>· {entry.className}</span>
								</span>
								{#if entry.present}
									<Badge variant="success-outline">{m.roster_present()}</Badge>
								{:else}
									<Badge variant="alarm-outline">{m.roster_absent()}</Badge>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class={ui.card} aria-labelledby="skills-heading">
				<h2 id="skills-heading" class={ui.cardTitle}>{m.roster_skills_heading()}</h2>
				{#if data.errors.skills}
					<p class={sectionError} role="alert">{m.child_section_error()}</p>
				{:else if data.skills.length === 0}
					<p class={ui.muted}>{m.child_skills_empty()}</p>
				{:else}
					<div class="flex flex-col gap-4">
						{#each data.skills as cls (cls.classId)}
							<div>
								<h3 class="mb-2 text-base font-bold">
									{cls.className ?? m.student_class_former()}
								</h3>
								<dl class="mb-2 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
									{#each skillAreas as area (area)}
										<div>
											<dt class={ui.muted}>{skillLabel(area)}</dt>
											<dd class={cn('font-bold', !cls.current[area] && ui.muted)}>
												{cls.current[area]
													? levelLabel(cls.current[area].level)
													: m.roster_no_entry_yet()}
											</dd>
										</div>
									{/each}
								</dl>
								<details>
									<summary class="cursor-pointer py-2.5 text-primary">
										{m.roster_view_history()}
									</summary>
									{#if cls.history.length === 0}
										<p class={ui.muted}>{m.roster_history_empty()}</p>
									{:else}
										<ul class={ui.rows}>
											{#each cls.history as entry (entry.id)}
												<li class="py-2">
													<strong>{skillLabel(entry.skillArea)}</strong> — {levelLabel(entry.level)}
													<span class={ui.muted}>
														· <time datetime={entry.recordedAt}
															>{formatInstant(entry.recordedAt)}</time
														>
													</span>
													{#if entry.notes}
														<p class="mt-1 whitespace-pre-line">{entry.notes}</p>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</details>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

{#snippet rangeSummary(shown: RangeResult)}
	{@const range = shown.range}
	<p>
		<strong
			>{m.leave_range_period({
				from: formatDay(range.from),
				to: formatDay(range.to)
			})}</strong
		>
		<span class={ui.muted}>
			· {range.classId
				? (data.rangeClasses.find((c) => c.id === range.classId)?.name ?? '')
				: m.leave_range_all_classes()}
			· {range.answer === 'coming' ? m.leave_answer_coming() : m.leave_answer_on_leave()}
		</span>
	</p>
	{#if range.to > shown.listEnd}
		<p class={ui.muted}>
			{m.leave_range_beyond_list({ date: formatDay(shown.listEnd) })}
		</p>
	{/if}
	{#if rangeCounts.total === 0}
		<p role="status">{m.leave_range_empty()}</p>
	{:else}
		<p role="status" data-testid="range-summary">
			{range.answer === 'coming'
				? m.leave_range_summary_coming({
						total: num(rangeCounts.total),
						coming: num(rangeCounts.coming),
						skipped: num(rangeCounts.skipped)
					})
				: m.leave_range_summary_on_leave({
						total: num(rangeCounts.total),
						planned: num(rangeCounts.planned),
						short: num(rangeCounts.short),
						skipped: num(rangeCounts.skipped)
					})}
		</p>
	{/if}
{/snippet}

{#snippet rangeRows(shown: RangeResult)}
	<ul class={ui.rows} data-testid="range-list">
		{#each shown.rows as row (row.sessionId)}
			<li class={rowItem}>
				<span class="min-w-0">
					<time datetime={row.day}>{formatDay(row.day)}</time>
					<span class={ui.muted}>· {row.className}</span>
				</span>
				<Badge variant={outcomeVariant(row.outcome)}>{outcomeLabel(row.outcome)}</Badge>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet rangeSave(shown: RangeResult)}
	<form
		method="POST"
		action="?tab=sessions&/setLeaveRange"
		use:enhance={pending.submit('rangeSave', { reset: false })}
	>
		<input type="hidden" name="from" value={shown.range.from} />
		<input type="hidden" name="to" value={shown.range.to} />
		<input type="hidden" name="classId" value={shown.range.classId ?? 'all'} />
		<input type="hidden" name="answer" value={shown.range.answer} />
		<Button
			type="submit"
			class={touchButton}
			disabled={pending.busy || rangeCounts.changing === 0}
			aria-busy={pending.is('rangeSave') || undefined}
		>
			{@render spinner('rangeSave')}
			{m.leave_range_save()}
		</Button>
	</form>
{/snippet}

<!-- The sheet's and the dialog's content: the summary and the list scroll,
     the actions stay in view. -->
{#snippet rangeDialogBody()}
	<div class="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 text-base">
		{#if rangePreview}
			{@render rangeSummary(rangePreview)}
			{#if rangeCounts.total > 0}
				{@render rangeRows(rangePreview)}
			{/if}
			{#if rangeError && rangeOpen}
				<p class={ui.error} role="alert">{rangeError.message}</p>
			{/if}
		{/if}
	</div>
	<div
		class="flex shrink-0 flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end"
	>
		<Button variant="outline" class={touchButton} onclick={closeRange}>
			{m.common_cancel()}
		</Button>
		{#if rangePreview}
			{@render rangeSave(rangePreview)}
		{/if}
	</div>
{/snippet}

{#snippet homeworkList(items: typeof data.homework.open)}
	<ul class={ui.rows}>
		{#each items as item (item.instanceId)}
			<li class="py-3">
				<p class="flex flex-wrap items-center gap-2">
					<strong lang={item.contentLanguage} class="min-w-0 wrap-break-word">{item.title}</strong>
					{#if item.overdue}
						<Badge variant="alarm">{m.student_homework_overdue_label()}</Badge>
					{/if}
					{#if item.status === 'reviewed'}
						<Badge variant="success">{m.student_homework_status_reviewed()}</Badge>
					{:else if item.status === 'done'}
						<Badge variant="info">{m.student_homework_status_done()}</Badge>
					{/if}
				</p>
				<p class="mt-1 {ui.muted}">
					{item.className ?? m.student_class_former()} · {m.student_homework_due_label({
						date: formatDay(item.dueDate)
					})}
				</p>
				{#if item.referenceLinks.length > 0}
					<ul class="mt-1 list-disc pl-5 wrap-anywhere">
						{#each item.referenceLinks as link, i (i)}
							<li>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external teacher-supplied URL, opens externally. -->
								<a href={link.url} target="_blank" rel="noopener noreferrer" class={ui.link}
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
