<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { ScheduleField } from '$lib/server/calendar';

	/**
	 * A class schedule's form fields (Story 6-4): weekday checkboxes Mon-Sun
	 * (`weekday`, ISO 1-7), start time, duration, from and until. Used on
	 * /calendar for each editable class and on /admin/classes when creating
	 * one. Field names match `scheduleFormValues()`; `errors` holds the inline
	 * message per invalid field.
	 */
	let {
		idPrefix,
		weekdays,
		startTime = null,
		durationMinutes = null,
		startsOn,
		endsOn = null,
		errors = {}
	}: {
		idPrefix: string;
		weekdays: number[];
		startTime?: string | null;
		durationMinutes?: number | string | null;
		startsOn: string;
		endsOn?: string | null;
		errors?: Partial<Record<ScheduleField, string>>;
	} = $props();

	const WEEKDAYS: { value: number; label: () => string }[] = [
		{ value: 1, label: m.calendar_weekday_1 },
		{ value: 2, label: m.calendar_weekday_2 },
		{ value: 3, label: m.calendar_weekday_3 },
		{ value: 4, label: m.calendar_weekday_4 },
		{ value: 5, label: m.calendar_weekday_5 },
		{ value: 6, label: m.calendar_weekday_6 },
		{ value: 7, label: m.calendar_weekday_7 }
	];

	const errorId = (field: ScheduleField) => `${idPrefix}-${field}-error`;
	const describedBy = (field: ScheduleField) => (errors[field] ? errorId(field) : undefined);
	const invalid = (field: ScheduleField) => (errors[field] ? 'true' : undefined);

	/**
	 * aria-invalid / aria-describedby for each weekday checkbox, in an effect
	 * of their own: as template attributes they would share the effect that
	 * sets `checked`, and re-running that (when an error appears) puts back
	 * the server-rendered checked state over what the user just changed.
	 */
	function weekdayErrorState(input: HTMLInputElement) {
		const error = errors.weekdays;
		if (error) {
			input.setAttribute('aria-invalid', 'true');
			input.setAttribute('aria-describedby', errorId('weekdays'));
		} else {
			input.removeAttribute('aria-invalid');
			input.removeAttribute('aria-describedby');
		}
	}
</script>

<fieldset class="weekdays" aria-describedby={describedBy('weekdays')}>
	<legend>{m.calendar_schedule_weekdays_label()}</legend>
	<div class="weekday-list">
		{#each WEEKDAYS as day (day.value)}
			<label class="weekday">
				<input
					type="checkbox"
					name="weekday"
					value={day.value}
					checked={weekdays.includes(day.value)}
					{@attach weekdayErrorState}
				/>
				<span>{day.label()}</span>
			</label>
		{/each}
	</div>
	{#if errors.weekdays}
		<p id={errorId('weekdays')} class="field-error" role="alert">{errors.weekdays}</p>
	{/if}
</fieldset>

<div class="schedule-grid">
	<div class="field">
		<label for="{idPrefix}-start">{m.calendar_start_time_label()}</label>
		<input
			id="{idPrefix}-start"
			name="startTime"
			type="time"
			value={startTime ?? ''}
			aria-invalid={invalid('startTime')}
			aria-describedby={describedBy('startTime')}
		/>
		{#if errors.startTime}
			<p id={errorId('startTime')} class="field-error" role="alert">{errors.startTime}</p>
		{/if}
	</div>
	<div class="field">
		<label for="{idPrefix}-duration">{m.calendar_duration_label()}</label>
		<input
			id="{idPrefix}-duration"
			name="durationMinutes"
			type="number"
			inputmode="numeric"
			min="15"
			max="480"
			step="5"
			value={durationMinutes ?? ''}
			aria-invalid={invalid('durationMinutes')}
			aria-describedby={describedBy('durationMinutes')}
		/>
		{#if errors.durationMinutes}
			<p id={errorId('durationMinutes')} class="field-error" role="alert">
				{errors.durationMinutes}
			</p>
		{/if}
	</div>
	<div class="field">
		<label for="{idPrefix}-from">{m.calendar_schedule_from_label()}</label>
		<input
			id="{idPrefix}-from"
			name="startsOn"
			type="date"
			required
			value={startsOn}
			aria-invalid={invalid('startsOn')}
			aria-describedby={describedBy('startsOn')}
		/>
		{#if errors.startsOn}
			<p id={errorId('startsOn')} class="field-error" role="alert">{errors.startsOn}</p>
		{/if}
	</div>
	<div class="field">
		<label for="{idPrefix}-until">{m.calendar_schedule_until_label()}</label>
		<input
			id="{idPrefix}-until"
			name="endsOn"
			type="date"
			value={endsOn ?? ''}
			aria-invalid={invalid('endsOn')}
			aria-describedby={describedBy('endsOn')}
		/>
		{#if errors.endsOn}
			<p id={errorId('endsOn')} class="field-error" role="alert">{errors.endsOn}</p>
		{/if}
	</div>
</div>

<style>
	.weekdays {
		margin-bottom: var(--space-3);
	}
	.weekday-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	/* Whole pill is the click target (WCAG 2.2 target size). */
	.weekday {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--theme-color-soft-bdr);
		border-radius: 999px;
		cursor: pointer;
	}
	.weekday:has(input:checked) {
		border-color: var(--theme-color-primary);
		background: var(--theme-color-ghost-primary--hover);
	}
	.weekday:has(input:focus-visible) {
		outline: 2px solid var(--theme-color-focus-bdr);
		outline-offset: 1px;
	}
	.schedule-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0 var(--space-3);
	}
	.schedule-grid .field {
		margin-bottom: var(--space-3);
	}
	.field-error {
		margin: 0;
	}
</style>
