<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { MediaQuery, SvelteSet } from 'svelte/reactivity';
	import { Calendar, DayGrid, Interaction, List } from '@event-calendar/core';
	import Ban from '@lucide/svelte/icons/ban';
	import CalendarArrowUp from '@lucide/svelte/icons/calendar-arrow-up';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDay as formatIsoDay, num } from '$lib/format';
	import { showToast } from '$lib/ix';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import { eventDomClass, toCalendarEvents, type CalendarEventProps } from '$lib/calendar-events';
	import ChildPicker from '$lib/components/ChildPicker.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ScheduleFields from '$lib/components/ScheduleFields.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { EmptyState } from '$lib/components/ui/empty-state/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { ui } from '$lib/ui/classes';
	import type { PageProps } from './$types';

	/**
	 * Calendar (Story 6-1, month grid #47, schedules 6-4): the selected
	 * month's class days as a Monday-first month grid (list view on a phone)
	 * rendered by @event-calendar/core. Clicking a session chip opens its
	 * dialog (edit for admin / the class's teachers, read-only for students);
	 * the admin clicks a day to add class days there or cancel / restore it,
	 * and the admin or a teacher clicks a class day to add an extra session.
	 * Below the grid, each editable class's schedule. Navigation goes through
	 * `?month=` so the server keeps scoping one month per load.
	 *
	 * Mobile-first story 5b: built on the new component system. The session
	 * and day dialogs are a bottom sheet on a phone and a dialog from 48rem;
	 * their fields are native date, time, number and select inputs; the
	 * library keeps its own CSS, themed in src/lib/ui/tailwind.css.
	 */
	let { data, form }: PageProps = $props();

	const pending = createPending();
	const confirm = createConfirm();
	const calendarHref = resolve('/calendar');
	// Phone below 48rem: list view and bottom sheets; from 48rem the month
	// grid and dialogs (the app's breakpoints, SPEC assumptions).
	const wide = new MediaQuery('min-width: 48rem', false);

	type Session = (typeof data.days)[number]['sessions'][number];

	// Wall-clock dates: format them as UTC so no time zone shifts the day.
	const format = (date: string, options: Intl.DateTimeFormatOptions) => formatIsoDay(date, options);
	const formatMonth = (month: string) => format(`${month}-01`, { month: 'long', year: 'numeric' });
	const formatDay = (date: string) =>
		format(date, { weekday: 'long', day: 'numeric', month: 'long' });

	/** A calendar-library local Date -> `YYYY-MM-DD`. */
	function isoDate(date: Date): string {
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const dd = String(date.getDate()).padStart(2, '0');
		return `${date.getFullYear()}-${mm}-${dd}`;
	}

	/** A duration in minutes as a number field's value: empty unless a finite number. */
	function minutesText(minutes: number | string | null | undefined): string {
		if (minutes === null || minutes === undefined) return '';
		if (typeof minutes === 'string' && minutes.trim() === '') return '';
		const n = Number(minutes);
		return Number.isFinite(n) ? String(n) : '';
	}

	// Story 7-4: the student's own answer, read-only. Sick shows as Sick here.
	function leaveLabel(answer: string | undefined): string {
		if (answer === 'coming') return m.leave_answer_coming();
		if (answer === 'on_leave') return m.leave_answer_on_leave();
		if (answer === 'sick') return m.leave_answer_sick();
		return m.leave_answer_none();
	}

	let monthLabel = $derived(formatMonth(data.month));

	// #105: the earliest date a day can be moved to (today and the past are fixed).
	let tomorrow = $derived(
		new Date(Date.parse(`${data.today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
	);

	// #58: a parent's view. `?child=` narrows to one approved child; month
	// navigation keeps it.
	let isParent = $derived(data.role === 'parent');
	function monthHref(month: string, child: string | null = data.selectedChild): string {
		const query = `month=${encodeURIComponent(month)}`;
		return child
			? `${calendarHref}?${query}&child=${encodeURIComponent(child)}`
			: `${calendarHref}?${query}`;
	}
	function childSessionsHref(childId: string): string {
		return `${resolve('/parent/children/[id]', { id: childId })}?tab=sessions`;
	}

	let schedulesByClass = $derived(new Map(data.classSchedules.map((c) => [c.id, c])));
	let classDayDates = $derived(new Set(data.days.map((d) => d.date)));

	// ── Class schedules (#66) ───────────────────────────────────────────────
	// Collapsed rows: each class shows a one-line summary, and its form (a
	// dozen fields) renders only while the row is expanded, so a school with
	// many classes still renders the grid.
	const expandedSchedules = new SvelteSet<string>();
	// Rows opened at least once keep their form mounted (hidden while
	// collapsed), so collapsing a row keeps its unsaved edits.
	const openedSchedules = new SvelteSet<string>();
	function toggleSchedule(classId: string) {
		if (expandedSchedules.has(classId)) expandedSchedules.delete(classId);
		else {
			expandedSchedules.add(classId);
			openedSchedules.add(classId);
		}
	}

	const WEEKDAY_SHORT = [
		m.calendar_weekday_1,
		m.calendar_weekday_2,
		m.calendar_weekday_3,
		m.calendar_weekday_4,
		m.calendar_weekday_5,
		m.calendar_weekday_6,
		m.calendar_weekday_7
	];
	const INTERVAL_LABELS: Record<number, () => string> = {
		2: m.calendar_schedule_interval_2,
		3: m.calendar_schedule_interval_3,
		4: m.calendar_schedule_interval_4
	};

	/** "Mon, Wed · 17:00 · 60 min · Every 2 weeks" (interval only when not weekly). */
	function scheduleSummary(cls: (typeof data.classSchedules)[number]): string {
		const parts = [
			cls.weekdays.length > 0
				? cls.weekdays.map((d) => WEEKDAY_SHORT[d - 1]?.() ?? String(d)).join(', ')
				: m.calendar_schedule_no_weekdays(),
			cls.startTime ?? m.calendar_status_unset()
		];
		if (cls.durationMinutes) {
			parts.push(m.calendar_schedule_duration_short({ minutes: num(cls.durationMinutes) }));
		}
		const interval = INTERVAL_LABELS[Number(cls.intervalWeeks ?? 1)];
		if (interval) parts.push(interval());
		return parts.join(' · ');
	}

	/** Whether clicking `iso` opens the day dialog: admin any day of the month, teachers class days. */
	function dayClickable(iso: string): boolean {
		if (!iso.startsWith(data.month)) return false;
		return data.isAdmin || (data.canEdit && classDayDates.has(iso));
	}

	function timeText(session: Session): string {
		if (!session.start) return m.calendar_status_unset();
		return session.end
			? m.calendar_time_range({ start: num(session.start), end: num(session.end) })
			: m.calendar_time_from({ start: num(session.start) });
	}

	function defaultHint(classId: string): string {
		const cls = schedulesByClass.get(classId);
		if (!cls?.startTime) return m.calendar_session_hint();
		return cls.durationMinutes
			? m.calendar_session_default_hint({
					start: num(cls.startTime),
					duration: num(cls.durationMinutes)
				})
			: m.calendar_session_default_hint_start({ start: num(cls.startTime) });
	}

	// ── Dialogs ─────────────────────────────────────────────────────────────
	let mounted = $state(false);
	let pageRoot = $state<HTMLElement>();
	let sessionOpen = $state(false);
	let dayOpen = $state(false);
	// Sheet or dialog: fixed while open, so a rotation does not swap it.
	let dialogWide = $state(false);
	let selectedSessionId = $state<string | null>(null);
	let selectedDate = $state<string | null>(null);
	// Errors in `form` from before a dialog was opened belong to another dialog.
	let formAtOpen = $state.raw<unknown>(null);
	// Where focus returns on close; `focusSelector` finds a re-rendered chip
	// or day button after the month data reloaded.
	let opener: HTMLElement | null = null;
	let focusSelector: string | null = null;

	let selected = $derived.by(() => {
		for (const day of data.days) {
			const session = day.sessions.find((s) => s.id === selectedSessionId);
			if (session) return { day, session };
		}
		return null;
	});
	// The header button always opens the add form, even on a class day.
	let dayAddOnly = $state(false);
	let selectedDay = $derived(
		selectedDate && !dayAddOnly ? (data.days.find((d) => d.date === selectedDate) ?? null) : null
	);
	let freshForm = $derived(form && form !== formAtOpen ? form : null);

	let sessionError = $derived(
		freshForm && 'sessionError' in freshForm && freshForm.sessionId === selectedSessionId
			? freshForm.sessionError
			: undefined
	);
	let addDaysError = $derived(
		freshForm && 'addDaysError' in freshForm ? freshForm.addDaysError : undefined
	);
	let extraError = $derived(
		freshForm && 'extraError' in freshForm && selectedDay && freshForm.dayId === selectedDay.id
			? freshForm.extraError
			: undefined
	);
	// Classes the caller may edit that have no session on the selected day yet.
	let extraClasses = $derived(
		selectedDay
			? data.classSchedules.filter((c) => !selectedDay.sessions.some((s) => s.classId === c.id))
			: []
	);

	// While closing (e.g. after a move or delete) no day means no title, not the add form's.
	let dayTitle = $derived(
		selectedDay ? formatDay(selectedDay.date) : dayOpen ? m.calendar_add_days_heading() : ''
	);

	function openSession(sessionId: string, from: HTMLElement | null) {
		if (sessionOpen || dayOpen) return;
		opener = from;
		focusSelector = `.${eventDomClass(sessionId)}`;
		selectedSessionId = sessionId;
		formAtOpen = page.form;
		dialogWide = wide.current;
		sessionOpen = true;
	}

	function openDay(date: string, from: HTMLElement | null, selector?: string, addOnly = false) {
		if (sessionOpen || dayOpen) return;
		opener = from;
		focusSelector = selector ?? `[data-date="${date}"]`;
		selectedDate = date;
		dayAddOnly = addOnly;
		formAtOpen = page.form;
		dialogWide = wide.current;
		dayOpen = true;
	}

	/**
	 * Bits moves focus on close; it goes back to the chip or day that opened
	 * the dialog instead, or to its re-rendered replacement once the month
	 * data has reloaded.
	 */
	function returnFocus(event: Event) {
		event.preventDefault();
		const from = opener;
		const selector = focusSelector;
		const find = () =>
			from && from.isConnected
				? from
				: selector
					? (pageRoot?.querySelector<HTMLElement>(selector) ?? null)
					: null;
		void tick().then(() => {
			const target = find();
			if (target) target.focus();
			else requestAnimationFrame(() => find()?.focus());
		});
	}

	// Success toasts for this page's actions (errors are toasted app-wide);
	// a successful action also closes the dialog it came from.
	let lastForm: unknown;
	$effect(() => {
		const f = page.form as { success?: boolean; action?: string; added?: number; existed?: number };
		if (!f || f === lastForm || !f.success) return;
		lastForm = f;
		const messages: Record<string, () => string> = {
			daysAdded: () =>
				m.calendar_days_added({ added: num(f.added ?? 0), existed: num(f.existed ?? 0) }),
			dayCancelled: m.calendar_day_cancelled,
			dayRestored: m.calendar_day_restored,
			dayMoved: m.calendar_day_moved,
			dayDeleted: m.calendar_day_deleted,
			scheduleSaved: m.calendar_schedule_saved,
			extraAdded: m.calendar_extra_added,
			sessionSaved: m.calendar_session_saved,
			sessionCancelled: m.calendar_session_cancelled,
			sessionRestored: m.calendar_session_restored
		};
		const message = f.action ? messages[f.action] : undefined;
		if (message) showToast('success', message());
		// The schedules are not in a dialog: saving one closes nothing.
		if (f.action !== 'scheduleSaved') {
			untrack(() => {
				if (sessionOpen) sessionOpen = false;
				if (dayOpen) dayOpen = false;
			});
		}
	});

	// ── Calendar ────────────────────────────────────────────────────────────
	const monthOf = (date: Date) => isoDate(date).slice(0, 7);

	type ClickedEvent = { extendedProps: Record<string, unknown> };

	function onEventClick({ event, el }: { event: ClickedEvent; el: HTMLElement }) {
		const props = event.extendedProps as CalendarEventProps;
		if (props.kind === 'session') openSession(props.session.id, el);
		else openDay(props.date, el, `.${eventDomClass(`day-${props.dayId}`)}`);
	}

	function onDateClick({ date, dayEl }: { date: Date; dayEl: HTMLElement }) {
		const iso = isoDate(date);
		// Neighbouring months' dates: their class days are not loaded.
		if (!dayClickable(iso)) return;
		openDay(iso, dayEl.querySelector<HTMLElement>(`[data-date="${iso}"]`));
	}

	// The library's prev / next / today buttons change its date; the month
	// itself always comes from the server via ?month=.
	function onDatesSet({ view }: { view: { currentStart: Date } }) {
		const month = monthOf(view.currentStart);
		if (month !== data.month) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- calendarHref is resolve()d.
			void goto(monthHref(month), { keepFocus: true, noScroll: true });
		}
	}

	function eventOrder(a: ClickedEvent, b: ClickedEvent): number {
		return (
			(a.extendedProps as CalendarEventProps).order - (b.extendedProps as CalendarEventProps).order
		);
	}

	const plugins = [DayGrid, List, Interaction];

	// Raw state: the component diffs options by key, so only replaced keys
	// update. The data-driven keys are kept in sync by the effect below.
	let options = $state.raw(
		untrack(() => ({
			view: wide.current ? 'dayGridMonth' : 'listMonth',
			firstDay: 1 as const,
			date: `${data.month}-01`,
			locale: getLocale(),
			// #80: browsers have no Tibetan date data, so the headings are written here.
			...(getLocale() === 'bo'
				? {
						dayHeaderFormat: (date: Date) => format(isoDate(date), { weekday: 'short' }),
						listDayFormat: (date: Date) => format(isoDate(date), { weekday: 'long' }),
						listDaySideFormat: (date: Date) =>
							format(isoDate(date), { day: 'numeric', month: 'long', year: 'numeric' })
					}
				: {}),
			headerToolbar: { start: 'prev,today,next', center: '', end: '' },
			buttonText: (text: Record<string, string>) => ({
				...text,
				today: m.calendar_this_month(),
				prev: m.calendar_prev_month(),
				next: m.calendar_next_month()
			}),
			dayMaxEvents: false,
			displayEventEnd: false,
			eventOrder,
			eventClick: onEventClick,
			dateClick: onDateClick,
			datesSet: onDatesSet,
			// The empty month is announced above the calendar instead.
			noEventsContent: '',
			// "Today" is the server's Berlin date, not the browser's.
			highlightedDates: [data.today],
			events: toCalendarEvents(data.days)
		}))
	);

	$effect(() => {
		const next = {
			events: toCalendarEvents(data.days),
			date: `${data.month}-01`,
			highlightedDates: [data.today]
		};
		// Read `options` untracked: this effect writes it, so tracking it
		// would re-run the effect forever.
		untrack(() => (options = { ...options, ...next }));
	});

	$effect(() => {
		const view = wide.current ? 'dayGridMonth' : 'listMonth';
		untrack(() => {
			if (options.view !== view) options = { ...options, view };
		});
	});

	let calendarWrap = $state<HTMLElement>();
	$effect(() => {
		// Name the library's toolbar <nav> once it renders (after mount).
		const wrap = calendarWrap;
		if (!mounted || !wrap) return;
		void tick().then(() =>
			wrap.querySelector('.ec-toolbar')?.setAttribute('aria-label', m.calendar_month_nav_label())
		);
	});

	onMount(() => {
		mounted = true;
	});

	let addStartDefault = $derived(
		data.today.startsWith(data.month) ? data.today : `${data.month}-01`
	);

	const touchButton = `${ui.touch} w-full md:w-auto`;
	const fieldClass = 'flex min-w-0 flex-col gap-1.5';
	const fieldLabel = 'text-sm font-medium';
	const subHeading = 'text-base leading-snug font-bold';
	const subSection = 'flex flex-col gap-3 border-t border-border pt-4';
	const sheetClass =
		'max-h-[90dvh] gap-3 rounded-t-lg px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]';
	const dialogClass = 'flex max-h-[85dvh] flex-col gap-4 p-6 md:max-w-lg';
	const titleClass = 'text-lg leading-snug font-semibold wrap-break-word';
</script>

<svelte:head>
	<title>{m.calendar_heading()} — Sherab</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet eventContent({ event }: { event: ClickedEvent })}
	{@const props = event.extendedProps as CalendarEventProps}
	<span class="chip-text">
		{#if props.kind === 'session'}
			<span class="chip-time">{props.session.start ?? m.calendar_status_unset()}</span>
			<span class="chip-title">{props.session.className}</span>
			{#if props.session.extra}
				<span class="chip-extra">{m.calendar_extra_label()}</span>
			{/if}
		{:else}
			<span class="chip-title">{m.calendar_class_day_chip()}</span>
		{/if}
		{#if props.cancelled}
			<span class="sr-only">, {m.calendar_status_cancelled()}</span>
		{/if}
	</span>
{/snippet}

{#snippet childAnswerList(sessionId: string)}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- childSessionsHref() builds on resolve() and only adds ?tab=. -->
	<ul class="flex flex-col gap-1" data-testid="child-answers">
		{#each data.childAnswers[sessionId] ?? [] as entry (entry.childId)}
			<li class="wrap-break-word">
				<a
					href={childSessionsHref(entry.childId)}
					class="inline-flex min-h-11 items-center {ui.link}"
					aria-label={m.calendar_child_answer_link_label({ name: entry.name })}>{entry.name}</a
				>: <span class="leave-answer">{leaveLabel(entry.answer ?? undefined)}</span>
			</li>
		{/each}
	</ul>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/snippet}

{#snippet dayCellContent({ date }: { date: Date })}
	{@const iso = isoDate(date)}
	{@const isToday = iso === data.today}
	{@const label = wide.current ? num(date.getDate()) : format(iso, { weekday: 'long' })}
	{#if dayClickable(iso)}
		<button
			type="button"
			class="day-button"
			class:today-mark={isToday}
			data-date={iso}
			aria-label={data.isAdmin
				? m.calendar_day_button_label({ date: formatDay(iso) })
				: m.calendar_day_details_label({ date: formatDay(iso) })}
			aria-current={isToday ? 'date' : undefined}
			onpointerdown={(event) => event.stopPropagation()}
			onclick={(event) => openDay(iso, event.currentTarget)}>{label}</button
		>
	{:else}
		<span class="day-number" class:today-mark={isToday}>{label}</span>
		{#if isToday}<span class="sr-only">, {m.calendar_today()}</span>{/if}
	{/if}
{/snippet}

<div
	data-ui="new"
	data-page="calendar"
	class={ui.page}
	data-hydrated={mounted || undefined}
	bind:this={pageRoot}
>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.calendar_heading()}</p>
			<h1 class={ui.heading} aria-live="polite">{monthLabel}</h1>
		</div>
		{#if data.isAdmin}
			<Button
				class="add-days-button {touchButton}"
				data-testid="add-days-button"
				aria-haspopup="dialog"
				onclick={(event: MouseEvent) =>
					openDay(addStartDefault, event.currentTarget as HTMLElement, '.add-days-button', true)}
			>
				<Plus aria-hidden="true" />
				{m.calendar_add_days_button()}
			</Button>
		{/if}
	</header>

	{#if data.isAdmin}
		<p class="-mt-2 {ui.muted}">{m.calendar_admin_click_hint()}</p>
	{/if}

	{#if isParent && data.children.length >= 2}
		<ChildPicker
			label={m.calendar_child_picker_label()}
			options={[
				{
					key: 'all',
					href: monthHref(data.month, null),
					label: m.calendar_all_children(),
					current: data.selectedChild === null
				},
				...data.children.map((child) => ({
					key: child.id,
					href: monthHref(data.month, child.id),
					label: child.name,
					current: data.selectedChild === child.id
				}))
			]}
		/>
	{/if}

	{#if isParent && data.children.length === 0 && !data.loadError}
		<p class={ui.muted} data-testid="parent-no-children">{m.calendar_parent_no_children()}</p>
	{/if}

	{#if data.loadError}
		<div class={ui.card} role="alert" data-testid="calendar-load-error">
			<EmptyState header={m.calendar_error_load()} icon={Info} />
		</div>
	{:else}
		{#if data.days.length === 0}
			<div data-testid="calendar-empty">
				<p>{m.calendar_empty()}</p>
				{#if data.isAdmin}<p class={ui.muted}>{m.calendar_empty_admin_hint()}</p>{/if}
			</div>
		{/if}
		<div class="calendar-wrap {ui.card} p-2 md:p-4" bind:this={calendarWrap}>
			{#if mounted}
				<Calendar {plugins} {options} {eventContent} {dayCellContent} />
			{/if}
		</div>
	{/if}

	{#if data.canEdit && data.classSchedules.length > 0}
		<section class={ui.card} aria-labelledby="schedules-heading" data-testid="schedules">
			<h2 id="schedules-heading" class={ui.cardTitle}>{m.calendar_schedules_heading()}</h2>
			<p class={ui.muted}>{m.calendar_schedules_intro()}</p>
			<ul class="mt-2 {ui.rows}">
				{#each data.classSchedules as cls (cls.id)}
					{@const errors =
						form && 'scheduleErrors' in form && form.classId === cls.id
							? form.scheduleErrors
							: undefined}
					{@const open = expandedSchedules.has(cls.id)}
					<li class="py-2">
						<h3>
							<button
								type="button"
								class="schedule-toggle group flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-lg py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								aria-expanded={open}
								aria-controls={openedSchedules.has(cls.id) ? `schedule-panel-${cls.id}` : undefined}
								data-class-id={cls.id}
								onclick={() => toggleSchedule(cls.id)}
							>
								<ChevronRight
									class="mt-1 size-4 shrink-0 transition-transform group-aria-expanded:rotate-90"
									aria-hidden="true"
								/>
								<span class="flex min-w-0 flex-wrap items-baseline gap-x-3">
									<span
										id="schedule-title-{cls.id}"
										class="text-lg leading-snug font-bold wrap-break-word">{cls.name}</span
									>
									<span class="schedule-summary {ui.muted}" data-testid="schedule-summary"
										>{scheduleSummary(cls)}</span
									>
								</span>
							</button>
						</h3>
						{#if openedSchedules.has(cls.id)}
							<!-- A display utility beats `hidden`, so it follows `open` too. -->
							<form
								id="schedule-panel-{cls.id}"
								hidden={!open}
								method="POST"
								action="?/setClassSchedule"
								use:enhance={pending.submit(`schedule:${cls.id}`, { reset: false })}
								class="schedule-form mt-3 flex-col gap-4 {open ? 'flex' : 'hidden'}"
								data-class-id={cls.id}
								aria-labelledby="schedule-title-{cls.id}"
								novalidate
							>
								<input type="hidden" name="classId" value={cls.id} />
								<ScheduleFields
									idPrefix="schedule-{cls.id}"
									weekdays={cls.weekdays}
									startTime={cls.startTime}
									durationMinutes={cls.durationMinutes}
									startsOn={cls.startsOn}
									endsOn={cls.endsOn}
									intervalWeeks={cls.intervalWeeks}
									errors={errors ?? {}}
								/>
								<div>
									<Button
										type="submit"
										variant="secondary"
										class={touchButton}
										aria-busy={pending.is(`schedule:${cls.id}`) || undefined}
										disabled={pending.busy}
									>
										{@render spinner(`schedule:${cls.id}`)}
										{m.calendar_save()}
									</Button>
								</div>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<!-- The body of a sheet / dialog scrolls; its Close button stays in view. -->
{#snippet dialogFooter(close: () => void)}
	<div
		class="flex shrink-0 flex-col-reverse gap-2 border-t border-border pt-3 md:flex-row md:justify-end"
	>
		<Button variant="outline" class={touchButton} onclick={close}>
			{m.calendar_dialog_close()}
		</Button>
	</div>
{/snippet}

{#snippet sessionBody()}
	<div
		class="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 text-base"
		data-testid="session-body"
	>
		{#if sessionOpen && selected}
			{@const { day, session } = selected}
			<dl class="details grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
				<dt class={ui.muted}>{m.calendar_date_label()}</dt>
				<dd><time datetime={day.date}>{formatDay(day.date)}</time></dd>
				<dt class={ui.muted}>{m.calendar_time_label()}</dt>
				<dd
					class="session-time tabular-nums"
					class:line-through={session.status === 'cancelled'}
					class:text-muted-foreground={session.status === 'cancelled'}
				>
					{timeText(session)}
				</dd>
				{#if data.role === 'student' && session.status !== 'cancelled'}
					<dt class={ui.muted}>{m.calendar_leave_label()}</dt>
					<dd class="leave-answer" data-testid="own-answer">
						{leaveLabel(data.leaveAnswers[session.id])}
					</dd>
				{/if}
				{#if isParent && session.status !== 'cancelled' && data.childAnswers[session.id]?.length}
					<dt class={ui.muted}>{m.calendar_children_answers_label()}</dt>
					<dd>{@render childAnswerList(session.id)}</dd>
				{/if}
			</dl>
			<p class="flex flex-wrap gap-2" data-testid="session-status">
				{#if session.status === 'cancelled'}
					<Badge variant="secondary">{m.calendar_status_cancelled()}</Badge>
				{:else if session.status === 'unset'}
					<Badge variant="outline">{m.calendar_status_unset()}</Badge>
				{:else}
					<Badge variant="success-outline">{m.calendar_status_scheduled()}</Badge>
				{/if}
				{#if session.extra}
					<Badge variant="info" data-testid="extra-badge">{m.calendar_extra_label()}</Badge>
				{/if}
			</p>

			{#if data.canEdit}
				<form
					method="POST"
					action="?/updateSession"
					use:enhance={pending.submit(`session:${session.id}`)}
					class="flex flex-col gap-3"
					novalidate
				>
					<input type="hidden" name="sessionId" value={session.id} />
					<!-- Empty means "use the class default" (#66). -->
					<div class="grid gap-3 md:grid-cols-2">
						<div class={fieldClass}>
							<Label for="session-start" class={fieldLabel}>{m.calendar_start_time_label()}</Label>
							<Input
								id="session-start"
								name="startTime"
								type="time"
								value={session.startOverride ?? ''}
								aria-invalid={sessionError ? 'true' : undefined}
								aria-describedby={sessionError ? 'session-hint session-error' : 'session-hint'}
							/>
						</div>
						<div class={fieldClass}>
							<Label for="session-duration" class={fieldLabel}>{m.calendar_duration_label()}</Label>
							<Input
								id="session-duration"
								name="durationMinutes"
								type="number"
								inputmode="numeric"
								min="15"
								max="480"
								step="5"
								value={minutesText(session.durationOverride)}
								aria-invalid={sessionError ? 'true' : undefined}
								aria-describedby={sessionError ? 'session-hint session-error' : 'session-hint'}
							/>
						</div>
					</div>
					<p id="session-hint" class="text-sm {ui.muted}">{defaultHint(session.classId)}</p>
					{#if sessionError}
						<p id="session-error" class={ui.error} role="alert">{sessionError}</p>
					{/if}
					<div>
						<Button
							type="submit"
							class={touchButton}
							aria-busy={pending.is(`session:${session.id}`) || undefined}
							disabled={pending.busy}
						>
							{@render spinner(`session:${session.id}`)}
							{m.calendar_save()}
						</Button>
					</div>
				</form>

				<form
					method="POST"
					action="?/setSessionCancelled"
					use:enhance={pending.submit(`cancel:${session.id}`)}
					class="border-t border-border pt-4"
				>
					<input type="hidden" name="sessionId" value={session.id} />
					<input
						type="hidden"
						name="cancelled"
						value={session.sessionCancelled ? 'false' : 'true'}
					/>
					<Button
						type="submit"
						variant={session.sessionCancelled ? 'outline' : 'destructive'}
						class={touchButton}
						aria-busy={pending.is(`cancel:${session.id}`) || undefined}
						disabled={pending.busy || day.cancelled}
					>
						{#if pending.is(`cancel:${session.id}`)}
							<LoaderCircle class="animate-spin" aria-hidden="true" />
						{:else if session.sessionCancelled}
							<Undo2 aria-hidden="true" />
						{:else}
							<Ban aria-hidden="true" />
						{/if}
						{session.sessionCancelled ? m.calendar_restore_session() : m.calendar_cancel_session()}
					</Button>
				</form>
			{/if}
		{/if}
	</div>
	{@render dialogFooter(() => (sessionOpen = false))}
{/snippet}

{#snippet dayBody()}
	<div
		class="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 text-base"
		data-testid="day-body"
	>
		{#if dayOpen && selectedDate}
			{#if selectedDay}
				{#if selectedDay.cancelled}
					<p><Badge variant="secondary">{m.calendar_status_cancelled()}</Badge></p>
				{/if}
				{#if selectedDay.sessions.length === 0}
					<p class={ui.muted}>{m.calendar_day_no_sessions()}</p>
				{:else}
					<ul class="flex flex-col gap-2" data-testid="day-sessions">
						{#each selectedDay.sessions as session (session.id)}
							<li
								class="flex flex-wrap gap-x-3 gap-y-1"
								class:line-through={session.status === 'cancelled'}
								class:text-muted-foreground={session.status === 'cancelled'}
							>
								<span class="tabular-nums">{timeText(session)}</span>
								<span class="min-w-0 wrap-break-word">{session.className}</span>
								{#if session.extra}
									<span class={ui.muted}>({m.calendar_extra_label()})</span>
								{/if}
								{#if data.role === 'student' && session.status !== 'cancelled'}
									<span class={ui.muted}>· {leaveLabel(data.leaveAnswers[session.id])}</span>
								{/if}
								{#if isParent && session.status !== 'cancelled' && data.childAnswers[session.id]?.length}
									<div class="basis-full">{@render childAnswerList(session.id)}</div>
								{/if}
								{#if session.status === 'cancelled'}
									<span class="sr-only">, {m.calendar_status_cancelled()}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if data.isAdmin}
					{@const dayId = selectedDay.id}
					{@const date = selectedDay.date}
					<!-- #105: only a future day can be moved or deleted (the database enforces it). -->
					{@const future = date > data.today}
					<div class="flex flex-col gap-2 md:flex-row md:flex-wrap">
						{#if selectedDay.cancelled}
							<form
								method="POST"
								action="?/setClassDayCancelled"
								use:enhance={pending.submit(`day:${dayId}`)}
							>
								<input type="hidden" name="dayId" value={dayId} />
								<input type="hidden" name="cancelled" value="false" />
								<Button
									type="submit"
									variant="outline"
									class={touchButton}
									aria-busy={pending.is(`day:${dayId}`) || undefined}
									disabled={pending.busy}
								>
									{#if pending.is(`day:${dayId}`)}
										<LoaderCircle class="animate-spin" aria-hidden="true" />
									{:else}
										<Undo2 aria-hidden="true" />
									{/if}
									{m.calendar_restore_day()}
								</Button>
							</form>
						{:else}
							<form
								method="POST"
								action="?/setClassDayCancelled"
								use:enhance={pending.submit(`day:${dayId}`, {
									confirm: confirm.with(
										m.calendar_cancel_day_confirm({ date: formatDay(date) }),
										m.calendar_cancel_day(),
										{ destructive: true }
									)
								})}
							>
								<input type="hidden" name="dayId" value={dayId} />
								<input type="hidden" name="cancelled" value="true" />
								<Button
									type="submit"
									variant="destructive"
									class={touchButton}
									aria-haspopup="dialog"
									aria-busy={pending.is(`day:${dayId}`) || undefined}
									disabled={pending.busy}
								>
									{#if pending.is(`day:${dayId}`)}
										<LoaderCircle class="animate-spin" aria-hidden="true" />
									{:else}
										<Ban aria-hidden="true" />
									{/if}
									{m.calendar_cancel_day()}
								</Button>
							</form>
						{/if}
						{#if future}
							<form
								method="POST"
								action="?/deleteClassDay"
								use:enhance={pending.submit(`delete:${dayId}`, {
									confirm: confirm.with(
										m.calendar_delete_day_confirm({ date: formatDay(date) }),
										m.calendar_delete_day(),
										{ destructive: true }
									)
								})}
							>
								<input type="hidden" name="dayId" value={dayId} />
								<Button
									type="submit"
									variant="destructive"
									class={touchButton}
									aria-haspopup="dialog"
									aria-busy={pending.is(`delete:${dayId}`) || undefined}
									disabled={pending.busy}
								>
									{#if pending.is(`delete:${dayId}`)}
										<LoaderCircle class="animate-spin" aria-hidden="true" />
									{:else}
										<Trash2 aria-hidden="true" />
									{/if}
									{m.calendar_delete_day()}
								</Button>
							</form>
						{/if}
					</div>
					{#if future}
						<section class={subSection} aria-labelledby="move-heading">
							<h3 id="move-heading" class={subHeading}>{m.calendar_move_day()}</h3>
							<p id="move-intro" class={ui.muted}>{m.calendar_move_day_intro()}</p>
							<form
								method="POST"
								action="?/moveClassDay"
								use:enhance={pending.submit(`move:${dayId}`)}
								class="flex flex-col gap-3"
								novalidate
							>
								<input type="hidden" name="dayId" value={dayId} />
								<div class={fieldClass}>
									<Label for="move-date" class={fieldLabel}>{m.calendar_move_day_label()}</Label>
									<Input
										id="move-date"
										name="newDate"
										type="date"
										min={tomorrow}
										required
										aria-describedby="move-intro"
									/>
								</div>
								<div>
									<Button
										type="submit"
										class={touchButton}
										aria-busy={pending.is(`move:${dayId}`) || undefined}
										disabled={pending.busy}
									>
										{#if pending.is(`move:${dayId}`)}
											<LoaderCircle class="animate-spin" aria-hidden="true" />
										{:else}
											<CalendarArrowUp aria-hidden="true" />
										{/if}
										{m.calendar_move_day()}
									</Button>
								</div>
							</form>
						</section>
					{/if}
				{/if}
				{#if data.canEdit && data.classSchedules.length > 0 && !selectedDay.cancelled}
					{@const dayId = selectedDay.id}
					<section class={subSection} aria-labelledby="extra-heading">
						<h3 id="extra-heading" class={subHeading}>{m.calendar_extra_heading()}</h3>
						{#if extraClasses.length === 0}
							<p class={ui.muted}>{m.calendar_extra_none()}</p>
						{:else}
							<p id="extra-intro" class={ui.muted}>{m.calendar_extra_intro()}</p>
							<form
								method="POST"
								action="?/addExtraSession"
								use:enhance={pending.submit(`extra:${dayId}`)}
								class="flex flex-col gap-3"
								novalidate
							>
								<input type="hidden" name="dayId" value={dayId} />
								<div class={fieldClass}>
									<Label for="extra-class" class={fieldLabel}
										>{m.calendar_extra_class_label()}</Label
									>
									<NativeSelect.Root
										id="extra-class"
										name="classId"
										class="w-full"
										required
										aria-invalid={extraError ? 'true' : undefined}
										aria-describedby={extraError ? 'extra-error' : undefined}
									>
										{#each extraClasses as cls (cls.id)}
											<NativeSelect.Option value={cls.id}>{cls.name}</NativeSelect.Option>
										{/each}
									</NativeSelect.Root>
								</div>
								<div class="grid gap-3 md:grid-cols-2">
									<div class={fieldClass}>
										<Label for="extra-start" class={fieldLabel}
											>{m.calendar_start_time_label()}</Label
										>
										<Input
											id="extra-start"
											name="startTime"
											type="time"
											aria-invalid={extraError ? 'true' : undefined}
											aria-describedby={extraError ? 'extra-intro extra-error' : 'extra-intro'}
										/>
									</div>
									<div class={fieldClass}>
										<Label for="extra-duration" class={fieldLabel}
											>{m.calendar_duration_label()}</Label
										>
										<Input
											id="extra-duration"
											name="durationMinutes"
											type="number"
											inputmode="numeric"
											min="15"
											max="480"
											step="5"
											aria-invalid={extraError ? 'true' : undefined}
											aria-describedby={extraError ? 'extra-intro extra-error' : 'extra-intro'}
										/>
									</div>
								</div>
								{#if extraError}
									<p id="extra-error" class={ui.error} role="alert">{extraError}</p>
								{/if}
								<div>
									<Button
										type="submit"
										class={touchButton}
										aria-busy={pending.is(`extra:${dayId}`) || undefined}
										disabled={pending.busy}
									>
										{#if pending.is(`extra:${dayId}`)}
											<LoaderCircle class="animate-spin" aria-hidden="true" />
										{:else}
											<Plus aria-hidden="true" />
										{/if}
										{m.calendar_extra_submit()}
									</Button>
								</div>
							</form>
						{/if}
					</section>
				{/if}
			{:else if data.isAdmin}
				<p id="add-days-intro" class={ui.muted}>{m.calendar_add_days_intro()}</p>
				<form
					method="POST"
					action="?/addClassDays"
					use:enhance={pending.submit('addDays')}
					class="flex flex-col gap-3"
					novalidate
				>
					<div class="grid gap-3 md:grid-cols-2">
						<div class={fieldClass}>
							<Label for="add-start" class={fieldLabel}>{m.calendar_start_date_label()}</Label>
							<Input
								id="add-start"
								name="startDate"
								type="date"
								required
								value={selectedDate}
								aria-invalid={addDaysError ? 'true' : undefined}
								aria-describedby={addDaysError ? 'add-days-error' : undefined}
							/>
						</div>
						<div class={fieldClass}>
							<Label for="add-end" class={fieldLabel}>{m.calendar_end_date_label()}</Label>
							<Input
								id="add-end"
								name="endDate"
								type="date"
								aria-invalid={addDaysError ? 'true' : undefined}
								aria-describedby={addDaysError ? 'add-days-error' : undefined}
							/>
						</div>
					</div>
					{#if addDaysError}
						<p id="add-days-error" class={ui.error} role="alert">{addDaysError}</p>
					{/if}
					<div>
						<Button
							type="submit"
							class={touchButton}
							aria-busy={pending.is('addDays') || undefined}
							disabled={pending.busy}
						>
							{#if pending.is('addDays')}
								<LoaderCircle class="animate-spin" aria-hidden="true" />
							{:else}
								<Plus aria-hidden="true" />
							{/if}
							{m.calendar_add_days_button()}
						</Button>
					</div>
				</form>
			{/if}
		{/if}
	</div>
	{@render dialogFooter(() => (dayOpen = false))}
{/snippet}

<!-- Session: edit (admin / the class's teachers) or read-only details. -->
<Dialog.Root bind:open={sessionOpen}>
	{#if dialogWide}
		<Dialog.Content
			data-testid="session-dialog"
			closeLabel={m.calendar_dialog_close()}
			class={dialogClass}
			onCloseAutoFocus={returnFocus}
		>
			<Dialog.Header class="pr-10">
				<Dialog.Title class={titleClass}>{selected?.session.className ?? ''}</Dialog.Title>
			</Dialog.Header>
			{@render sessionBody()}
		</Dialog.Content>
	{:else}
		<Sheet.Content
			side="bottom"
			data-testid="session-dialog"
			closeLabel={m.calendar_dialog_close()}
			class={sheetClass}
			onCloseAutoFocus={returnFocus}
		>
			<Sheet.Header class="p-0 pr-12">
				<Sheet.Title class={titleClass}>{selected?.session.className ?? ''}</Sheet.Title>
			</Sheet.Header>
			{@render sessionBody()}
		</Sheet.Content>
	{/if}
</Dialog.Root>

<!-- Day: admin adds class days or cancels / restores one; others read. -->
<Dialog.Root bind:open={dayOpen}>
	{#if dialogWide}
		<Dialog.Content
			data-testid="day-dialog"
			closeLabel={m.calendar_dialog_close()}
			class={dialogClass}
			onCloseAutoFocus={returnFocus}
		>
			<Dialog.Header class="pr-10">
				<Dialog.Title class={titleClass}>{dayTitle}</Dialog.Title>
			</Dialog.Header>
			{@render dayBody()}
		</Dialog.Content>
	{:else}
		<Sheet.Content
			side="bottom"
			data-testid="day-dialog"
			closeLabel={m.calendar_dialog_close()}
			class={sheetClass}
			onCloseAutoFocus={returnFocus}
		>
			<Sheet.Header class="p-0 pr-12">
				<Sheet.Title class={titleClass}>{dayTitle}</Sheet.Title>
			</Sheet.Header>
			{@render dayBody()}
		</Sheet.Content>
	{/if}
</Dialog.Root>

<ConfirmDialog {confirm} />
