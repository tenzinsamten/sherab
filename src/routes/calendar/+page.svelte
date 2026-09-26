<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { Calendar, DayGrid, Interaction, List } from '@event-calendar/core';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import { eventDomClass, toCalendarEvents, type CalendarEventProps } from '$lib/calendar-events';
	import type { PageProps } from './$types';

	/**
	 * Calendar (Story 6-1, month grid #47): the selected month's class days
	 * as a Monday-first month grid (list view at phone width) rendered by
	 * @event-calendar/core. Clicking a session chip opens its dialog (edit for
	 * admin / the class's teachers, read-only for students); the admin clicks
	 * a day to add class days there or cancel / restore it. Navigation goes
	 * through `?month=` so the server keeps scoping one month per load.
	 */
	let { data, form }: PageProps = $props();

	const pending = createPending();
	const calendarHref = resolve('/calendar');
	// Same breakpoint as the app's phone layout (app.css).
	const PHONE_QUERY = '(max-width: 640px)';

	type Session = (typeof data.days)[number]['sessions'][number];
	type ModalElement = HTMLElement & {
		showModal(): Promise<void>;
		closeModal(reason?: unknown): Promise<void>;
	};

	// Wall-clock dates: format them as UTC so no time zone shifts the day.
	function format(date: string, options: Intl.DateTimeFormatOptions): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: 'UTC' }).format(
				new Date(`${date}T00:00:00Z`)
			);
		} catch {
			return date;
		}
	}
	const formatMonth = (month: string) => format(`${month}-01`, { month: 'long', year: 'numeric' });
	const formatDay = (date: string) =>
		format(date, { weekday: 'long', day: 'numeric', month: 'long' });

	/** A calendar-library local Date -> `YYYY-MM-DD`. */
	function isoDate(date: Date): string {
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const dd = String(date.getDate()).padStart(2, '0');
		return `${date.getFullYear()}-${mm}-${dd}`;
	}

	let monthLabel = $derived(formatMonth(data.month));

	let defaultsByClass = $derived(new Map(data.classDefaults.map((c) => [c.id, c])));

	function timeText(session: Session): string {
		if (!session.start) return m.calendar_status_unset();
		return session.end
			? m.calendar_time_range({ start: session.start, end: session.end })
			: m.calendar_time_from({ start: session.start });
	}

	function defaultHint(classId: string): string {
		const cls = defaultsByClass.get(classId);
		if (!cls?.startTime) return m.calendar_session_hint();
		return cls.durationMinutes
			? m.calendar_session_default_hint({ start: cls.startTime, duration: cls.durationMinutes })
			: m.calendar_session_default_hint_start({ start: cls.startTime });
	}

	// ── Dialogs ─────────────────────────────────────────────────────────────
	let mounted = $state(false);
	let isPhone = $state(false);
	let sessionModal = $state<HTMLElement>();
	let dayModal = $state<HTMLElement>();
	let sessionOpen = $state(false);
	let dayOpen = $state(false);
	let selectedSessionId = $state<string | null>(null);
	let selectedDate = $state<string | null>(null);
	// Errors in `form` from before a dialog was opened belong to another dialog.
	let formAtOpen = $state<unknown>(null);
	// Where focus returns on close; `focusClass` / `focusDate` find a
	// re-rendered chip or day button after the month data reloaded.
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

	async function showModal(modal: HTMLElement | undefined, label: string) {
		await tick();
		if (!modal) return;
		await customElements.whenDefined('ix-modal');
		await (
			modal as ModalElement & { componentOnReady?: () => Promise<unknown> }
		).componentOnReady?.();
		// The <dialog> lives in ix-modal's shadow DOM, where an aria-labelledby
		// to the slotted header can't resolve: name it directly, before it opens.
		modal.shadowRoot?.querySelector('dialog')?.setAttribute('aria-label', label);
		await (modal as ModalElement).showModal();
	}

	function openSession(sessionId: string, from: HTMLElement | null) {
		if (sessionOpen || dayOpen) return;
		opener = from;
		focusSelector = `.${eventDomClass(sessionId)}`;
		selectedSessionId = sessionId;
		formAtOpen = page.form;
		sessionOpen = true;
		const found = data.days.flatMap((d) => d.sessions).find((s) => s.id === sessionId);
		void showModal(sessionModal, found?.className ?? m.calendar_heading());
	}

	function openDay(date: string, from: HTMLElement | null, selector?: string, addOnly = false) {
		if (sessionOpen || dayOpen) return;
		opener = from;
		focusSelector = selector ?? `[data-date="${date}"]`;
		selectedDate = date;
		dayAddOnly = addOnly;
		formAtOpen = page.form;
		dayOpen = true;
		const isClassDay = !addOnly && data.days.some((d) => d.date === date);
		void showModal(dayModal, isClassDay ? formatDay(date) : m.calendar_add_days_heading());
	}

	function closeModal(modal: HTMLElement | undefined) {
		void (modal as ModalElement | undefined)?.closeModal();
	}

	function onClosed() {
		sessionOpen = false;
		dayOpen = false;
		// Wait for any re-render of the month data, then return focus.
		void tick().then(() => {
			const target =
				opener && opener.isConnected
					? opener
					: focusSelector
						? document.querySelector<HTMLElement>(`.calendar-wrap ${focusSelector}`)
						: null;
			target?.focus();
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
			daysAdded: () => m.calendar_days_added({ added: f.added ?? 0, existed: f.existed ?? 0 }),
			dayCancelled: m.calendar_day_cancelled,
			dayRestored: m.calendar_day_restored,
			defaultSaved: m.calendar_default_saved,
			sessionSaved: m.calendar_session_saved,
			sessionCancelled: m.calendar_session_cancelled,
			sessionRestored: m.calendar_session_restored
		};
		const message = f.action ? messages[f.action] : undefined;
		if (message) showToast('success', message());
		if (f.action !== 'defaultSaved') {
			if (sessionOpen) closeModal(sessionModal);
			if (dayOpen) closeModal(dayModal);
		}
	});

	async function cancelDay(event: MouseEvent, date: string) {
		const formEl = (event.currentTarget as HTMLElement).closest('form');
		const ok = await confirmAction(
			m.common_confirm_title(),
			m.calendar_cancel_day_confirm({ date: formatDay(date) }),
			m.calendar_cancel_day(),
			m.common_cancel()
		);
		if (ok) formEl?.requestSubmit();
	}

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
		if (!data.isAdmin || !iso.startsWith(data.month)) return;
		openDay(iso, dayEl.querySelector<HTMLElement>(`[data-date="${iso}"]`));
	}

	// The library's prev / next / today buttons change its date; the month
	// itself always comes from the server via ?month=.
	function onDatesSet({ view }: { view: { currentStart: Date } }) {
		const month = monthOf(view.currentStart);
		if (month !== data.month) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- calendarHref is resolve()d.
			void goto(`${calendarHref}?month=${month}`, { keepFocus: true, noScroll: true });
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
			view: 'dayGridMonth',
			firstDay: 1 as const,
			date: `${data.month}-01`,
			locale: getLocale(),
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
		const view = isPhone ? 'listMonth' : 'dayGridMonth';
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
		const query = window.matchMedia(PHONE_QUERY);
		isPhone = query.matches;
		const onChange = (event: MediaQueryListEvent) => (isPhone = event.matches);
		query.addEventListener('change', onChange);
		mounted = true;
		return () => query.removeEventListener('change', onChange);
	});

	let addStartDefault = $derived(
		data.today.startsWith(data.month) ? data.today : `${data.month}-01`
	);
</script>

<svelte:head>
	<title>{m.calendar_heading()} — Sherab</title>
</svelte:head>

{#snippet eventContent({ event }: { event: ClickedEvent })}
	{@const props = event.extendedProps as CalendarEventProps}
	<span class="chip-text">
		{#if props.kind === 'session'}
			<span class="chip-time">{props.session.start ?? m.calendar_status_unset()}</span>
			<span class="chip-title">{props.session.className}</span>
		{:else}
			<span class="chip-title">{m.calendar_class_day_chip()}</span>
		{/if}
		{#if props.cancelled}
			<span class="sr-only">, {m.calendar_status_cancelled()}</span>
		{/if}
	</span>
{/snippet}

{#snippet dayCellContent({ date }: { date: Date })}
	{@const iso = isoDate(date)}
	{@const isToday = iso === data.today}
	{@const label = isPhone ? format(iso, { weekday: 'long' }) : String(date.getDate())}
	{#if data.isAdmin && iso.startsWith(data.month)}
		<button
			type="button"
			class="day-button"
			class:today-mark={isToday}
			data-date={iso}
			aria-label={m.calendar_day_button_label({ date: formatDay(iso) })}
			aria-current={isToday ? 'date' : undefined}
			onpointerdown={(event) => event.stopPropagation()}
			onclick={(event) => openDay(iso, event.currentTarget)}>{label}</button
		>
	{:else}
		<span class="day-number" class:today-mark={isToday}>{label}</span>
		{#if isToday}<span class="sr-only">, {m.calendar_today()}</span>{/if}
	{/if}
{/snippet}

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.calendar_heading()}</p>
			<h1 class="page-heading" aria-live="polite">{monthLabel}</h1>
		</div>
		{#if data.isAdmin}
			<ix-button
				icon="add"
				onclick={(event: MouseEvent) =>
					openDay(addStartDefault, event.currentTarget as HTMLElement, '.add-days-button', true)}
				class="add-days-button"
			>
				{m.calendar_add_days_button()}
			</ix-button>
		{/if}
	</header>

	{#if data.isAdmin}
		<p class="muted hint-line">{m.calendar_admin_click_hint()}</p>
	{/if}

	{#if data.loadError}
		<p class="field-error" role="alert">{m.calendar_error_load()}</p>
	{:else}
		{#if data.days.length === 0}
			<div class="empty-month">
				<p>{m.calendar_empty()}</p>
				{#if data.isAdmin}<p class="muted">{m.calendar_empty_admin_hint()}</p>{/if}
			</div>
		{/if}
		<div class="calendar-wrap" bind:this={calendarWrap}>
			{#if mounted}
				<Calendar {plugins} {options} {eventContent} {dayCellContent} />
			{/if}
		</div>
	{/if}

	{#if data.canEdit && data.classDefaults.length > 0}
		<section class="card defaults" aria-labelledby="defaults-heading">
			<h2 id="defaults-heading">{m.calendar_defaults_heading()}</h2>
			<p class="muted">{m.calendar_defaults_intro()}</p>
			<ul class="row-list">
				{#each data.classDefaults as cls (cls.id)}
					{@const error =
						form && 'defaultError' in form && form.classId === cls.id
							? form.defaultError
							: undefined}
					<li>
						<form
							method="POST"
							action="?/setClassDefault"
							use:enhance={pending.submit(`default:${cls.id}`)}
							class="actions inline-form"
							novalidate
						>
							<input type="hidden" name="classId" value={cls.id} />
							<span class="row-title">{cls.name}</span>
							<div class="field">
								<label for="default-start-{cls.id}">{m.calendar_start_time_label()}</label>
								<input
									id="default-start-{cls.id}"
									name="startTime"
									type="time"
									value={cls.startTime ?? ''}
									aria-invalid={error ? 'true' : undefined}
									aria-describedby={error ? `default-error-${cls.id}` : undefined}
								/>
							</div>
							<div class="field">
								<label for="default-duration-{cls.id}">{m.calendar_duration_label()}</label>
								<input
									id="default-duration-{cls.id}"
									name="durationMinutes"
									type="number"
									inputmode="numeric"
									min="15"
									max="480"
									step="5"
									value={cls.durationMinutes ?? ''}
									aria-invalid={error ? 'true' : undefined}
									aria-describedby={error ? `default-error-${cls.id}` : undefined}
								/>
							</div>
							<ix-button
								type="submit"
								variant="secondary"
								loading={pending.is(`default:${cls.id}`) || undefined}
								disabled={pending.busy || undefined}
							>
								{m.calendar_save()}
							</ix-button>
						</form>
						{#if error}
							<p id="default-error-{cls.id}" class="field-error" role="alert">{error}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

{#if mounted}
	<!-- Session: edit (admin / the class's teachers) or read-only details. -->
	<ix-modal bind:this={sessionModal} size="480" ondialogClose={onClosed} ondialogDismiss={onClosed}>
		<!-- svelte-ignore a11y_unknown_aria_attribute -->
		<ix-modal-header aria-label-close-icon-button={m.calendar_dialog_close()}>
			{selected?.session.className ?? ''}
		</ix-modal-header>
		<ix-modal-content>
			{#if sessionOpen && selected}
				{@const { day, session } = selected}
				<dl class="details">
					<dt>{m.calendar_date_label()}</dt>
					<dd><time datetime={day.date}>{formatDay(day.date)}</time></dd>
					<dt>{m.calendar_time_label()}</dt>
					<dd class="session-time" class:struck={session.status === 'cancelled'}>
						{timeText(session)}
					</dd>
				</dl>
				<p class="status">
					{#if session.status === 'cancelled'}
						<ix-pill variant="neutral">{m.calendar_status_cancelled()}</ix-pill>
					{:else if session.status === 'unset'}
						<ix-pill variant="neutral" outline>{m.calendar_status_unset()}</ix-pill>
					{:else}
						<ix-pill variant="success" outline>{m.calendar_status_scheduled()}</ix-pill>
					{/if}
				</p>

				{#if data.canEdit}
					<form
						method="POST"
						action="?/updateSession"
						use:enhance={pending.submit(`session:${session.id}`)}
						class="actions inline-form"
						novalidate
					>
						<input type="hidden" name="sessionId" value={session.id} />
						<div class="field">
							<label for="session-start">{m.calendar_start_time_label()}</label>
							<input
								id="session-start"
								name="startTime"
								type="time"
								value={session.startOverride ?? ''}
								aria-invalid={sessionError ? 'true' : undefined}
								aria-describedby="session-hint{sessionError ? ' session-error' : ''}"
							/>
						</div>
						<div class="field">
							<label for="session-duration">{m.calendar_duration_label()}</label>
							<input
								id="session-duration"
								name="durationMinutes"
								type="number"
								inputmode="numeric"
								min="15"
								max="480"
								step="5"
								value={session.durationOverride ?? ''}
								aria-invalid={sessionError ? 'true' : undefined}
								aria-describedby="session-hint{sessionError ? ' session-error' : ''}"
							/>
						</div>
						<ix-button
							type="submit"
							variant="primary"
							loading={pending.is(`session:${session.id}`) || undefined}
							disabled={pending.busy || undefined}
						>
							{m.calendar_save()}
						</ix-button>
					</form>
					<p id="session-hint" class="muted hint">{defaultHint(session.classId)}</p>
					{#if sessionError}
						<p id="session-error" class="field-error" role="alert">{sessionError}</p>
					{/if}

					<form
						method="POST"
						action="?/setSessionCancelled"
						use:enhance={pending.submit(`cancel:${session.id}`)}
						class="session-cancel"
					>
						<input type="hidden" name="sessionId" value={session.id} />
						<input
							type="hidden"
							name="cancelled"
							value={session.sessionCancelled ? 'false' : 'true'}
						/>
						<ix-button
							type="submit"
							variant={session.sessionCancelled ? 'tertiary' : 'danger-tertiary'}
							icon={session.sessionCancelled ? 'undo' : 'cancel'}
							loading={pending.is(`cancel:${session.id}`) || undefined}
							disabled={pending.busy || day.cancelled || undefined}
						>
							{session.sessionCancelled
								? m.calendar_restore_session()
								: m.calendar_cancel_session()}
						</ix-button>
					</form>
				{/if}
			{/if}
		</ix-modal-content>
		<ix-modal-footer>
			<ix-button variant="secondary" onclick={() => closeModal(sessionModal)}>
				{m.calendar_dialog_close()}
			</ix-button>
		</ix-modal-footer>
	</ix-modal>

	<!-- Day: admin adds class days or cancels / restores one; others read. -->
	<ix-modal bind:this={dayModal} size="480" ondialogClose={onClosed} ondialogDismiss={onClosed}>
		<!-- svelte-ignore a11y_unknown_aria_attribute -->
		<ix-modal-header aria-label-close-icon-button={m.calendar_dialog_close()}>
			{#if selectedDay}
				{formatDay(selectedDay.date)}
			{:else}
				{m.calendar_add_days_heading()}
			{/if}
		</ix-modal-header>
		<ix-modal-content>
			{#if dayOpen && selectedDate}
				{#if selectedDay}
					{#if selectedDay.cancelled}
						<p class="status">
							<ix-pill variant="neutral">{m.calendar_status_cancelled()}</ix-pill>
						</p>
					{/if}
					{#if selectedDay.sessions.length === 0}
						<p class="muted">{m.calendar_day_no_sessions()}</p>
					{:else}
						<ul class="day-sessions">
							{#each selectedDay.sessions as session (session.id)}
								<li class:struck={session.status === 'cancelled'}>
									<span class="session-time">{timeText(session)}</span>
									<span>{session.className}</span>
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
						<form
							method="POST"
							action="?/setClassDayCancelled"
							use:enhance={pending.submit(`day:${dayId}`)}
						>
							<input type="hidden" name="dayId" value={dayId} />
							<input
								type="hidden"
								name="cancelled"
								value={selectedDay.cancelled ? 'false' : 'true'}
							/>
							{#if selectedDay.cancelled}
								<ix-button
									type="submit"
									variant="secondary"
									icon="undo"
									loading={pending.is(`day:${dayId}`) || undefined}
									disabled={pending.busy || undefined}
								>
									{m.calendar_restore_day()}
								</ix-button>
							{:else}
								<ix-button
									variant="danger-secondary"
									icon="cancel"
									loading={pending.is(`day:${dayId}`) || undefined}
									disabled={pending.busy || undefined}
									onclick={(event: MouseEvent) => cancelDay(event, date)}
								>
									{m.calendar_cancel_day()}
								</ix-button>
							{/if}
						</form>
					{/if}
				{:else if data.isAdmin}
					<p class="muted">{m.calendar_add_days_intro()}</p>
					<form
						method="POST"
						action="?/addClassDays"
						use:enhance={pending.submit('addDays')}
						novalidate
					>
						<div class="field">
							<label for="add-start">{m.calendar_start_date_label()}</label>
							<input
								id="add-start"
								name="startDate"
								type="date"
								required
								value={selectedDate}
								aria-invalid={addDaysError ? 'true' : undefined}
								aria-describedby={addDaysError ? 'add-days-error' : undefined}
							/>
						</div>
						<div class="field">
							<label for="add-end">{m.calendar_end_date_label()}</label>
							<input
								id="add-end"
								name="endDate"
								type="date"
								aria-invalid={addDaysError ? 'true' : undefined}
								aria-describedby={addDaysError ? 'add-days-error' : undefined}
							/>
						</div>
						{#if addDaysError}
							<p id="add-days-error" class="field-error" role="alert">{addDaysError}</p>
						{/if}
						<ix-button
							type="submit"
							icon="add"
							loading={pending.is('addDays') || undefined}
							disabled={pending.busy || undefined}
						>
							{m.calendar_add_days_button()}
						</ix-button>
					</form>
				{/if}
			{/if}
		</ix-modal-content>
		<ix-modal-footer>
			<ix-button variant="secondary" onclick={() => closeModal(dayModal)}>
				{m.calendar_dialog_close()}
			</ix-button>
		</ix-modal-footer>
	</ix-modal>
{/if}

<style>
	.hint-line {
		margin: calc(-1 * var(--space-4)) 0 var(--space-4);
		font-size: var(--theme-font-size-default);
	}

	.inline-form {
		align-items: flex-end;
	}
	.inline-form .field {
		flex: 1 1 10rem;
		margin: 0;
	}

	.row-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
	}
	.row-list > li {
		padding: var(--space-3) 0;
	}
	.row-list > li + li {
		border-top: 1px solid var(--theme-color-soft-bdr);
	}
	.row-title {
		flex: 1 1 10rem;
		font-weight: var(--theme-font-weight-bold);
	}
	.empty-month {
		margin: 0 0 var(--space-3);
	}
	.empty-month p {
		margin: 0;
	}
	.defaults {
		margin-top: var(--space-6);
	}

	.details {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0 0 var(--space-3);
	}
	.details dt {
		color: var(--theme-color-soft-text);
	}
	.details dd {
		margin: 0;
	}
	.status {
		margin: 0 0 var(--space-4);
	}
	.session-time {
		font-variant-numeric: tabular-nums;
	}
	.struck {
		text-decoration: line-through;
		color: var(--theme-color-soft-text);
	}
	.hint {
		margin: var(--space-2) 0 0;
		font-size: var(--theme-font-size-s);
	}
	.session-cancel {
		margin-top: var(--space-4);
	}
	.day-sessions {
		margin: 0 0 var(--space-4);
		padding: 0;
		list-style: none;
	}
	.day-sessions li {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-1) 0;
	}

	/* ── @event-calendar/core, in the app's iX look ─────────────────────── */
	.calendar-wrap {
		min-width: 0;
		/* Class palette (light schema; text on tint is at least 7:1). */
		--chip-c0-bg: #dbeafe;
		--chip-c0-fg: #1e3a8a;
		--chip-c0-accent: #2563eb;
		--chip-c1-bg: #dcfce7;
		--chip-c1-fg: #14532d;
		--chip-c1-accent: #16a34a;
		--chip-c2-bg: #fef3c7;
		--chip-c2-fg: #78350f;
		--chip-c2-accent: #d97706;
		--chip-c3-bg: #ede9fe;
		--chip-c3-fg: #4c1d95;
		--chip-c3-accent: #7c3aed;
		--chip-c4-bg: #fce7f3;
		--chip-c4-fg: #831843;
		--chip-c4-accent: #db2777;
		--chip-c5-bg: #ccfbf1;
		--chip-c5-fg: #134e4a;
		--chip-c5-accent: #0d9488;
	}
	.calendar-wrap :global(.ec) {
		--ec-border-color: var(--theme-color-soft-bdr);
		--ec-bg-color: var(--theme-color-1);
		/* Today is the server's Berlin date (highlightedDates), not the browser's. */
		--ec-today-bg-color: var(--ec-bg-color);
		--ec-highlight-color: var(--theme-color-ghost-primary--hover);
		--ec-button-bg-color: var(--theme-color-1);
		--ec-button-text-color: var(--theme-color-std-text);
		font-size: var(--theme-font-size-default);
	}
	.calendar-wrap :global(.ec-toolbar) {
		margin-bottom: var(--space-3);
	}
	.calendar-wrap :global(.ec-button) {
		min-height: 2rem;
		min-width: 2rem;
		cursor: pointer;
	}
	.calendar-wrap :global(.ec-button:focus-visible),
	.calendar-wrap :global(.ec-event:focus-visible),
	.calendar-wrap :global(.day-button:focus-visible) {
		outline: 2px solid var(--theme-color-focus-bdr);
		outline-offset: 1px;
		z-index: 2;
	}
	.calendar-wrap :global(.ec-day-grid .ec-day) {
		min-height: 6rem;
	}

	.calendar-wrap :global(.day-button) {
		min-width: 1.75rem;
		min-height: 1.75rem;
		padding: 0 var(--space-1);
		background: none;
		border: 0;
		border-radius: 999px;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.calendar-wrap :global(.day-button:hover) {
		background: var(--theme-color-ghost-primary--hover);
	}
	.calendar-wrap :global(.ec-day-grid .today-mark) {
		display: inline-block;
		min-width: 1.75rem;
		line-height: 1.75rem;
		text-align: center;
		border-radius: 999px;
		background: var(--theme-color-primary);
		color: var(--theme-color-primary--contrast);
		font-weight: var(--theme-font-weight-bold);
	}
	.calendar-wrap :global(.ec-list .today-mark) {
		color: var(--theme-color-primary);
		font-weight: var(--theme-font-weight-bold);
	}

	/* Chips: class colour tint with an accent edge; cancelled = grey, struck. */
	.calendar-wrap :global(.ec-event.chip) {
		cursor: pointer;
	}
	.calendar-wrap :global(.ec-day-grid .ec-event.chip) {
		background: var(--chip-bg);
		color: var(--chip-fg);
		border-inline-start: 3px solid var(--chip-accent);
		box-shadow: none;
	}
	.calendar-wrap :global(.ec-list .chip .ec-event-tag) {
		background: var(--chip-accent);
	}
	.calendar-wrap :global(.chip-c0) {
		--chip-bg: var(--chip-c0-bg);
		--chip-fg: var(--chip-c0-fg);
		--chip-accent: var(--chip-c0-accent);
	}
	.calendar-wrap :global(.chip-c1) {
		--chip-bg: var(--chip-c1-bg);
		--chip-fg: var(--chip-c1-fg);
		--chip-accent: var(--chip-c1-accent);
	}
	.calendar-wrap :global(.chip-c2) {
		--chip-bg: var(--chip-c2-bg);
		--chip-fg: var(--chip-c2-fg);
		--chip-accent: var(--chip-c2-accent);
	}
	.calendar-wrap :global(.chip-c3) {
		--chip-bg: var(--chip-c3-bg);
		--chip-fg: var(--chip-c3-fg);
		--chip-accent: var(--chip-c3-accent);
	}
	.calendar-wrap :global(.chip-c4) {
		--chip-bg: var(--chip-c4-bg);
		--chip-fg: var(--chip-c4-fg);
		--chip-accent: var(--chip-c4-accent);
	}
	.calendar-wrap :global(.chip-c5) {
		--chip-bg: var(--chip-c5-bg);
		--chip-fg: var(--chip-c5-fg);
		--chip-accent: var(--chip-c5-accent);
	}
	.calendar-wrap :global(.chip-day) {
		--chip-bg: var(--theme-color-1);
		--chip-fg: var(--theme-color-soft-text);
		--chip-accent: var(--theme-color-soft-bdr);
	}
	.calendar-wrap :global(.chip-cancelled) {
		--chip-bg: #f1f5f9;
		--chip-fg: #475569;
		--chip-accent: #94a3b8;
	}
	.calendar-wrap :global(.chip-cancelled .chip-text) {
		text-decoration: line-through;
	}
	.calendar-wrap :global(.ec-list .chip-cancelled .chip-text) {
		color: var(--theme-color-soft-text);
	}
	.calendar-wrap :global(.chip-text) {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-1);
		min-width: 0;
		overflow: hidden;
	}
	.calendar-wrap :global(.chip-time) {
		font-variant-numeric: tabular-nums;
		font-weight: var(--theme-font-weight-bold);
	}
	.calendar-wrap :global(.chip-title) {
		overflow-wrap: anywhere;
	}
</style>
