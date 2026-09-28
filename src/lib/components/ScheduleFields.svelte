<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { durationValue, ixFieldError, ixValue } from '$lib/ix-fields';
	import type { ScheduleField } from '$lib/server/calendar';

	/**
	 * A class schedule's form fields (Story 6-4): weekday checkboxes Mon-Sun
	 * (`weekday`, ISO 1-7), repeat every 1-4 weeks (`intervalWeeks`, issue
	 * #51), start time, duration, from and until. Used on
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
		intervalWeeks = 1,
		errors = {}
	}: {
		idPrefix: string;
		weekdays: number[];
		startTime?: string | null;
		durationMinutes?: number | string | null;
		startsOn: string;
		endsOn?: string | null;
		intervalWeeks?: number | string | null;
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

	const INTERVALS: { value: number; label: () => string }[] = [
		{ value: 1, label: m.calendar_schedule_interval_1 },
		{ value: 2, label: m.calendar_schedule_interval_2 },
		{ value: 3, label: m.calendar_schedule_interval_3 },
		{ value: 4, label: m.calendar_schedule_interval_4 }
	];

	const errorId = (field: ScheduleField) => `${idPrefix}-${field}-error`;
	/** Attachment: the field's iX invalid state, linked to its message below. */
	const fieldError = (field: ScheduleField) =>
		ixFieldError(errors[field] ? errorId(field) : undefined);

	/**
	 * The weekdays fieldset's description, in an attachment of its own (see
	 * $lib/ix-fields: an error must not re-run the effect that sets the
	 * fields' values and checked states).
	 */
	const weekdaysDescription = (fieldset: HTMLFieldSetElement) => {
		if (errors.weekdays) fieldset.setAttribute('aria-describedby', errorId('weekdays'));
		else fieldset.removeAttribute('aria-describedby');
	};
</script>

<!--
	Every value and checked state goes through ixValue: it writes only when the
	incoming value changed (so a reload after another form's save keeps unsaved
	edits here), and writes "empty" explicitly where iX would otherwise post its
	default (<ix-number-input> 0, <ix-time-input> the current time).
-->
<fieldset class="weekdays" {@attach weekdaysDescription}>
	<legend>{m.calendar_schedule_weekdays_label()}</legend>
	<div class="weekday-list">
		{#each WEEKDAYS as day (day.value)}
			<ix-checkbox
				name="weekday"
				value={String(day.value)}
				label={day.label()}
				aria-label={day.label()}
				{@attach ixValue(weekdays.includes(day.value), 'checked')}
				{@attach fieldError('weekdays')}
			></ix-checkbox>
		{/each}
	</div>
	{#if errors.weekdays}
		<p id={errorId('weekdays')} class="field-error" role="alert">{errors.weekdays}</p>
	{/if}
</fieldset>

<div class="schedule-grid">
	<div class="field">
		<!-- Remounted when the incoming interval changes: <ix-select> takes its
		     form value only on load and on user picks, not on later `value` writes. -->
		{#key String(intervalWeeks || 1)}
			<ix-select
				id="{idPrefix}-interval"
				name="intervalWeeks"
				label={m.calendar_schedule_interval_label()}
				{@attach ixValue(String(intervalWeeks || 1))}
				{@attach fieldError('intervalWeeks')}
			>
				{#each INTERVALS as option (option.value)}
					<ix-select-item value={String(option.value)} label={option.label()}></ix-select-item>
				{/each}
			</ix-select>
		{/key}
		{#if errors.intervalWeeks}
			<p id={errorId('intervalWeeks')} class="field-error" role="alert">
				{errors.intervalWeeks}
			</p>
		{/if}
	</div>
	<div class="field">
		<ix-time-input
			id="{idPrefix}-start"
			name="startTime"
			label={m.calendar_start_time_label()}
			format="HH:mm"
			{@attach ixValue(startTime ?? '')}
			{@attach fieldError('startTime')}
		></ix-time-input>
		{#if errors.startTime}
			<p id={errorId('startTime')} class="field-error" role="alert">{errors.startTime}</p>
		{/if}
	</div>
	<div class="field">
		<ix-number-input
			id="{idPrefix}-duration"
			name="durationMinutes"
			label={m.calendar_duration_label()}
			min="15"
			max="480"
			step="5"
			allow-empty-value-change
			{@attach ixValue(durationValue(durationMinutes))}
			{@attach fieldError('durationMinutes')}
		></ix-number-input>
		{#if errors.durationMinutes}
			<p id={errorId('durationMinutes')} class="field-error" role="alert">
				{errors.durationMinutes}
			</p>
		{/if}
	</div>
	<div class="field">
		<ix-date-input
			id="{idPrefix}-from"
			name="startsOn"
			label={m.calendar_schedule_from_label()}
			format="yyyy-MM-dd"
			required
			{@attach ixValue(startsOn)}
			{@attach fieldError('startsOn')}
		></ix-date-input>
		{#if errors.startsOn}
			<p id={errorId('startsOn')} class="field-error" role="alert">{errors.startsOn}</p>
		{/if}
	</div>
	<div class="field">
		<ix-date-input
			id="{idPrefix}-until"
			name="endsOn"
			label={m.calendar_schedule_until_label()}
			format="yyyy-MM-dd"
			{@attach ixValue(endsOn ?? '')}
			{@attach fieldError('endsOn')}
		></ix-date-input>
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
		gap: var(--space-2) var(--space-4);
	}
	/* Whole label row is the click target (WCAG 2.2 target size). */
	.weekday-list ix-checkbox {
		min-height: 2.25rem;
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
