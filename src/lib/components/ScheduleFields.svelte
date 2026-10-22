<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { ui } from '$lib/ui/classes';
	import type { ScheduleField } from '$lib/server/calendar';

	/**
	 * A class schedule's form fields (Story 6-4): weekday checkboxes Mon-Sun
	 * (`weekday`, ISO 1-7), repeat every 1-4 weeks (`intervalWeeks`, issue
	 * #51), start time, duration, from and until. Used on /calendar for each
	 * editable class and on /admin/classes when creating one. Field names
	 * match `scheduleFormValues()`; `errors` holds the inline message per
	 * invalid field.
	 *
	 * Mobile-first story 5b: native checkbox, select, time, number and date
	 * fields in their own `data-ui="new"` root, so they also work on
	 * /admin/classes. Each field takes its value from the
	 * props only when that value changes, so a reload after another form's
	 * save keeps unsaved edits here. Empty time and duration post empty.
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
	const invalid = (field: ScheduleField) => (errors[field] ? 'true' : undefined);
	const describedBy = (field: ScheduleField) => (errors[field] ? errorId(field) : undefined);

	/** A duration in minutes as the number field's value: empty unless a finite number. */
	function minutesText(minutes: number | string | null | undefined): string {
		if (minutes === null || minutes === undefined) return '';
		if (typeof minutes === 'string' && minutes.trim() === '') return '';
		const n = Number(minutes);
		return Number.isFinite(n) ? String(n) : '';
	}

	let interval = $derived(String(intervalWeeks || 1));

	const fieldClass = 'flex min-w-0 flex-col gap-1.5';
	const fieldLabel = 'text-sm font-medium';
</script>

<div data-ui="new" class="schedule-fields flex min-w-0 flex-col gap-4">
	<fieldset class="flex min-w-0 flex-col gap-2" aria-describedby={describedBy('weekdays')}>
		<legend class="mb-2 {fieldLabel}">{m.calendar_schedule_weekdays_label()}</legend>
		<div class="flex flex-wrap gap-2">
			{#each WEEKDAYS as day (day.value)}
				<label
					class="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-ring has-aria-invalid:border-destructive"
				>
					<input
						type="checkbox"
						name="weekday"
						value={String(day.value)}
						checked={weekdays.includes(day.value)}
						aria-invalid={invalid('weekdays')}
						class="size-5 shrink-0 accent-primary"
					/>
					<span>{day.label()}</span>
				</label>
			{/each}
		</div>
		{#if errors.weekdays}
			<p id={errorId('weekdays')} class={ui.error} role="alert">{errors.weekdays}</p>
		{/if}
	</fieldset>

	<div class="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-3 gap-y-4">
		<div class={fieldClass}>
			<Label for="{idPrefix}-interval" class={fieldLabel}
				>{m.calendar_schedule_interval_label()}</Label
			>
			<NativeSelect.Root
				id="{idPrefix}-interval"
				name="intervalWeeks"
				class="w-full"
				value={interval}
				aria-invalid={invalid('intervalWeeks')}
				aria-describedby={describedBy('intervalWeeks')}
			>
				{#each INTERVALS as option (option.value)}
					<NativeSelect.Option
						value={String(option.value)}
						selected={interval === String(option.value)}>{option.label()}</NativeSelect.Option
					>
				{/each}
			</NativeSelect.Root>
			{#if errors.intervalWeeks}
				<p id={errorId('intervalWeeks')} class={ui.error} role="alert">
					{errors.intervalWeeks}
				</p>
			{/if}
		</div>
		<div class={fieldClass}>
			<Label for="{idPrefix}-start" class={fieldLabel}>{m.calendar_start_time_label()}</Label>
			<Input
				id="{idPrefix}-start"
				name="startTime"
				type="time"
				value={startTime ?? ''}
				aria-invalid={invalid('startTime')}
				aria-describedby={describedBy('startTime')}
			/>
			{#if errors.startTime}
				<p id={errorId('startTime')} class={ui.error} role="alert">{errors.startTime}</p>
			{/if}
		</div>
		<div class={fieldClass}>
			<Label for="{idPrefix}-duration" class={fieldLabel}>{m.calendar_duration_label()}</Label>
			<Input
				id="{idPrefix}-duration"
				name="durationMinutes"
				type="number"
				inputmode="numeric"
				min="15"
				max="480"
				step="5"
				value={minutesText(durationMinutes)}
				aria-invalid={invalid('durationMinutes')}
				aria-describedby={describedBy('durationMinutes')}
			/>
			{#if errors.durationMinutes}
				<p id={errorId('durationMinutes')} class={ui.error} role="alert">
					{errors.durationMinutes}
				</p>
			{/if}
		</div>
		<div class={fieldClass}>
			<Label for="{idPrefix}-from" class={fieldLabel}>{m.calendar_schedule_from_label()}</Label>
			<Input
				id="{idPrefix}-from"
				name="startsOn"
				type="date"
				required
				value={startsOn}
				aria-invalid={invalid('startsOn')}
				aria-describedby={describedBy('startsOn')}
			/>
			{#if errors.startsOn}
				<p id={errorId('startsOn')} class={ui.error} role="alert">{errors.startsOn}</p>
			{/if}
		</div>
		<div class={fieldClass}>
			<Label for="{idPrefix}-until" class={fieldLabel}>{m.calendar_schedule_until_label()}</Label>
			<Input
				id="{idPrefix}-until"
				name="endsOn"
				type="date"
				value={endsOn ?? ''}
				aria-invalid={invalid('endsOn')}
				aria-describedby={describedBy('endsOn')}
			/>
			{#if errors.endsOn}
				<p id={errorId('endsOn')} class={ui.error} role="alert">{errors.endsOn}</p>
			{/if}
		</div>
	</div>
</div>
