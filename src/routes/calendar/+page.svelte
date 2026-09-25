<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { confirmAction, showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import type { PageProps } from './$types';

	/**
	 * Calendar (Story 6-1): the selected month's class days as a date-grouped
	 * list. Admin adds / cancels class days; admin and the class's teachers
	 * set class defaults and per-session time or cancellation; students read.
	 * The month grid is deferred (deferred-work.md).
	 */
	let { data, form }: PageProps = $props();

	const pending = createPending();
	const calendarHref = resolve('/calendar');
	const monthHref = (month: string) => `${calendarHref}?month=${month}`;

	type Session = (typeof data.days)[number]['sessions'][number];

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

	let monthLabel = $derived(formatMonth(data.month));

	let defaultsByClass = $derived(new Map(data.classDefaults.map((c) => [c.id, c])));

	function timeText(session: Session): string {
		// The status pill already says "Time not set".
		if (!session.start) return '–';
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

	// Success toasts for this page's actions; errors are toasted app-wide.
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

	let addDaysError = $derived(form && 'addDaysError' in form ? form.addDaysError : undefined);
</script>

<svelte:head>
	<title>{m.calendar_heading()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.calendar_heading()}</p>
			<h1 class="page-heading">{monthLabel}</h1>
		</div>
		<nav class="actions" aria-label={m.calendar_month_nav_label()}>
			<ix-button variant="secondary" icon="chevron-left" href={monthHref(data.prevMonth)}>
				{m.calendar_prev_month()}
			</ix-button>
			{#if data.month !== data.currentMonth}
				<ix-button variant="tertiary" href={monthHref(data.currentMonth)}>
					{m.calendar_this_month()}
				</ix-button>
			{/if}
			<ix-button variant="secondary" icon="chevron-right" href={monthHref(data.nextMonth)}>
				{m.calendar_next_month()}
			</ix-button>
		</nav>
	</header>

	{#if data.isAdmin}
		<section class="card" aria-labelledby="add-days-heading">
			<h2 id="add-days-heading">{m.calendar_add_days_heading()}</h2>
			<p class="muted">{m.calendar_add_days_intro()}</p>
			<form
				method="POST"
				action="?/addClassDays"
				use:enhance={pending.submit('addDays')}
				class="actions inline-form"
				novalidate
			>
				<div class="field">
					<label for="add-start">{m.calendar_start_date_label()}</label>
					<input
						id="add-start"
						name="startDate"
						type="date"
						required
						value={form && 'startDate' in form ? form.startDate : ''}
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
						value={form && 'endDate' in form ? form.endDate : ''}
						aria-invalid={addDaysError ? 'true' : undefined}
						aria-describedby={addDaysError ? 'add-days-error' : undefined}
					/>
				</div>
				<ix-button
					type="submit"
					icon="add"
					loading={pending.is('addDays') || undefined}
					disabled={pending.busy || undefined}
				>
					{m.calendar_add_days_button()}
				</ix-button>
			</form>
			{#if addDaysError}
				<p id="add-days-error" class="field-error" role="alert">{addDaysError}</p>
			{/if}
		</section>
	{/if}

	{#if data.canEdit && data.classDefaults.length > 0}
		<section class="card" aria-labelledby="defaults-heading">
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

	{#if !data.loadError}
		{#if data.days.length === 0}
			<ix-empty-state
				header={m.calendar_empty()}
				sub-header={data.isAdmin ? m.calendar_empty_admin_hint() : undefined}
				icon="calendar"
			></ix-empty-state>
		{:else}
			<ol class="day-list">
				{#each data.days as day (day.id)}
					<li class="day" class:today={day.isToday} aria-current={day.isToday ? 'date' : undefined}>
						<div class="day-header">
							<h2 class="day-title">
								<time datetime={day.date}>{formatDay(day.date)}</time>
							</h2>
							{#if day.isToday}
								<ix-pill variant="primary">{m.calendar_today()}</ix-pill>
							{/if}
							{#if day.cancelled}
								<ix-pill variant="neutral">{m.calendar_status_cancelled()}</ix-pill>
							{/if}
							{#if data.isAdmin}
								<form
									method="POST"
									action="?/setClassDayCancelled"
									use:enhance={pending.submit(`day:${day.id}`)}
									class="day-action"
								>
									<input type="hidden" name="dayId" value={day.id} />
									<input type="hidden" name="cancelled" value={day.cancelled ? 'false' : 'true'} />
									{#if day.cancelled}
										<ix-button
											type="submit"
											variant="tertiary"
											icon="undo"
											loading={pending.is(`day:${day.id}`) || undefined}
											disabled={pending.busy || undefined}
										>
											{m.calendar_restore_day()}
										</ix-button>
									{:else}
										<ix-button
											variant="danger-tertiary"
											icon="cancel"
											loading={pending.is(`day:${day.id}`) || undefined}
											disabled={pending.busy || undefined}
											onclick={(event: MouseEvent) => cancelDay(event, day.date)}
										>
											{m.calendar_cancel_day()}
										</ix-button>
									{/if}
								</form>
							{/if}
						</div>

						{#if day.sessions.length === 0}
							<p class="muted">{m.calendar_day_no_sessions()}</p>
						{:else}
							<ul class="row-list">
								{#each day.sessions as session (session.id)}
									{@const error =
										form && 'sessionError' in form && form.sessionId === session.id
											? form.sessionError
											: undefined}
									<li class="session" class:cancelled={session.status === 'cancelled'}>
										<div class="session-main">
											<span class="row-title">{session.className}</span>
											<span class="session-time">{timeText(session)}</span>
											{#if session.status === 'cancelled'}
												<ix-pill variant="neutral">{m.calendar_status_cancelled()}</ix-pill>
											{:else if session.status === 'unset'}
												<ix-pill variant="neutral" outline>{m.calendar_status_unset()}</ix-pill>
											{:else}
												<ix-pill variant="success" outline>{m.calendar_status_scheduled()}</ix-pill>
											{/if}
										</div>

										{#if data.canEdit}
											<div class="session-actions">
												<details open={error ? true : undefined}>
													<summary>{m.calendar_edit_session()}</summary>
													<form
														method="POST"
														action="?/updateSession"
														use:enhance={pending.submit(`session:${session.id}`)}
														class="actions inline-form"
														novalidate
													>
														<input type="hidden" name="sessionId" value={session.id} />
														<div class="field">
															<label for="start-{session.id}">{m.calendar_start_time_label()}</label
															>
															<input
																id="start-{session.id}"
																name="startTime"
																type="time"
																value={session.startOverride ?? ''}
																aria-invalid={error ? 'true' : undefined}
																aria-describedby="hint-{session.id}{error
																	? ` error-${session.id}`
																	: ''}"
															/>
														</div>
														<div class="field">
															<label for="duration-{session.id}"
																>{m.calendar_duration_label()}</label
															>
															<input
																id="duration-{session.id}"
																name="durationMinutes"
																type="number"
																inputmode="numeric"
																min="15"
																max="480"
																step="5"
																value={session.durationOverride ?? ''}
																aria-invalid={error ? 'true' : undefined}
																aria-describedby="hint-{session.id}{error
																	? ` error-${session.id}`
																	: ''}"
															/>
														</div>
														<ix-button
															type="submit"
															variant="secondary"
															loading={pending.is(`session:${session.id}`) || undefined}
															disabled={pending.busy || undefined}
														>
															{m.calendar_save()}
														</ix-button>
													</form>
													<p id="hint-{session.id}" class="muted hint">
														{defaultHint(session.classId)}
													</p>
													{#if error}
														<p id="error-{session.id}" class="field-error" role="alert">{error}</p>
													{/if}
												</details>

												<form
													method="POST"
													action="?/setSessionCancelled"
													use:enhance={pending.submit(`cancel:${session.id}`)}
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
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	{:else}
		<p class="field-error" role="alert">{m.calendar_error_load()}</p>
	{/if}
</div>

<style>
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

	.day-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin: var(--space-6) 0 0;
		padding: 0;
		list-style: none;
	}
	.day {
		padding: var(--space-4);
		background: var(--theme-color-1);
		border: 1px solid var(--theme-color-soft-bdr);
		border-radius: 0;
	}
	.day.today {
		border-left: 4px solid var(--theme-color-primary);
	}
	.day-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.day-title {
		margin: 0;
		font-size: var(--theme-font-size-l);
	}
	.day-action {
		margin-left: auto;
	}

	.session-main {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.session-time {
		font-variant-numeric: tabular-nums;
	}
	.session.cancelled .session-time {
		text-decoration: line-through;
		color: var(--theme-color-soft-text);
	}
	.session-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.session-actions details {
		flex: 1 1 18rem;
	}
	.session-actions summary {
		cursor: pointer;
		min-height: 1.5rem;
		padding: var(--space-1) 0;
		color: var(--theme-color-primary);
	}
	.session-actions details[open] summary {
		margin-bottom: var(--space-2);
	}
	.hint {
		margin: var(--space-2) 0 0;
		font-size: var(--theme-font-size-s);
	}
</style>
