/**
 * Pure helpers for the /calendar page (Stories 6-1, 6-4): bulk class-day
 * dates, month navigation, form parsing (incl. class schedules) and shaping
 * the month's class days and sessions into a date-grouped list. No I/O here;
 * the routes do the reads. Schedule errors are mapped to Paraglide messages
 * here so /calendar and /admin/classes show the same wording.
 */

import * as m from '$lib/paraglide/messages.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 9998;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 480;

function inYearRange(value: string): boolean {
	const year = Number(value.slice(0, 4));
	return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * A real `YYYY-MM-DD` calendar date (rejects e.g. 2026-02-31) in years
 * 1900-9998, so every date derived from it (+1 year, +/-1 month) stays a
 * 4-digit year and string comparison keeps working.
 */
export function isIsoDate(value: string): boolean {
	if (!ISO_DATE.test(value) || !inYearRange(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addUtcDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function addOneYear(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCFullYear(date.getUTCFullYear() + 1);
	return date.toISOString().slice(0, 10);
}

export type WeeklyDatesResult =
	{ ok: true; dates: string[] } | { ok: false; problem: 'invalid' | 'order' | 'range' };

/**
 * `start`, then every 7 days up to and including `end`. A single date is
 * start = end. The range may be at most one year (end no later than the
 * same date a year after start).
 */
export function weeklyDates(start: string, end: string): WeeklyDatesResult {
	if (!isIsoDate(start) || !isIsoDate(end)) return { ok: false, problem: 'invalid' };
	if (end < start) return { ok: false, problem: 'order' };
	if (end > addOneYear(start)) return { ok: false, problem: 'range' };

	const dates: string[] = [];
	for (let day = start; day <= end; day = addUtcDays(day, 7)) dates.push(day);
	return { ok: true, dates };
}

/** `?month=YYYY-MM` if valid (years 1900-9998), else `fallback` (the current Berlin month). */
export function parseMonth(value: string | null, fallback: string): string {
	return value && ISO_MONTH.test(value) && inYearRange(value) ? value : fallback;
}

/** `2026-10` + 1 = `2026-11`; `2026-01` - 1 = `2025-12`. */
export function shiftMonth(month: string, delta: number): string {
	const [year, mon] = month.split('-').map(Number);
	const index = year * 12 + (mon - 1) + delta;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** First and last date of `month` (`YYYY-MM`), inclusive. */
export function monthBounds(month: string): { first: string; last: string } {
	const first = `${month}-01`;
	const last = addUtcDays(`${shiftMonth(month, 1)}-01`, -1);
	return { first, last };
}

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** Time input (`HH:MM`, seconds allowed). Empty = null (not set / follow default). */
export function parseTimeInput(value: string): Parsed<string | null> {
	const trimmed = value.trim();
	if (trimmed === '') return { ok: true, value: null };
	const match = TIME.exec(trimmed);
	return match ? { ok: true, value: `${match[1]}:${match[2]}` } : { ok: false };
}

/** Whole minutes between 15 and 480. Empty = null (not set / follow default). */
export function parseDurationInput(value: string): Parsed<number | null> {
	const trimmed = value.trim();
	if (trimmed === '') return { ok: true, value: null };
	if (!/^\d+$/.test(trimmed)) return { ok: false };
	const minutes = Number(trimmed);
	return minutes >= MIN_DURATION_MINUTES && minutes <= MAX_DURATION_MINUTES
		? { ok: true, value: minutes }
		: { ok: false };
}

export type ScheduleInput = {
	/** Sorted, distinct ISO weekdays (1-7), at least one. */
	weekdays: number[];
	startTime: string | null;
	durationMinutes: number | null;
	startsOn: string;
	endsOn: string | null;
	/** Repeat every N weeks (1-4), anchored on the ISO week of `startsOn`. */
	intervalWeeks: number;
};

export type ScheduleField =
	'weekdays' | 'startTime' | 'durationMinutes' | 'startsOn' | 'endsOn' | 'intervalWeeks';

export type ScheduleProblem = 'required' | 'invalid' | 'order';

export type ScheduleParse =
	| { ok: true; value: ScheduleInput }
	| { ok: false; errors: Partial<Record<ScheduleField, ScheduleProblem>> };

export type ScheduleFormValues = {
	weekdays: string[];
	startTime: string;
	durationMinutes: string;
	startsOn: string;
	endsOn: string;
	intervalWeeks: string;
};

/** The raw schedule fields of a form (`weekday` checkboxes, `startTime`, `durationMinutes`, `startsOn`, `endsOn`, `intervalWeeks`). */
export function scheduleFormValues(formData: FormData): ScheduleFormValues {
	return {
		weekdays: formData.getAll('weekday').map((v) => String(v)),
		startTime: String(formData.get('startTime') ?? ''),
		durationMinutes: String(formData.get('durationMinutes') ?? ''),
		startsOn: String(formData.get('startsOn') ?? '').trim(),
		endsOn: String(formData.get('endsOn') ?? '').trim(),
		intervalWeeks: String(formData.get('intervalWeeks') ?? '').trim()
	};
}

/**
 * Validates a class schedule (Story 6-4): at least one weekday 1-7, an
 * optional `HH:MM` time and 15-480 minute duration (empty = not set), a
 * required start date, an optional end date on or after it, and a repeat
 * interval of 1-4 weeks (empty = 1, issue #51). Every field's
 * problem is reported at once so the form can show them inline.
 */
export function parseScheduleInput(values: ScheduleFormValues): ScheduleParse {
	const errors: Partial<Record<ScheduleField, ScheduleProblem>> = {};

	const weekdays = [...new Set(values.weekdays.map((v) => v.trim()))];
	if (weekdays.length === 0) errors.weekdays = 'required';
	else if (!weekdays.every((v) => /^[1-7]$/.test(v))) errors.weekdays = 'invalid';

	const startTime = parseTimeInput(values.startTime);
	if (!startTime.ok) errors.startTime = 'invalid';
	const duration = parseDurationInput(values.durationMinutes);
	if (!duration.ok) errors.durationMinutes = 'invalid';

	const startsOn = values.startsOn.trim();
	if (startsOn === '') errors.startsOn = 'required';
	else if (!isIsoDate(startsOn)) errors.startsOn = 'invalid';

	const endsOnRaw = values.endsOn.trim();
	const endsOn = endsOnRaw === '' ? null : endsOnRaw;
	if (endsOn !== null) {
		if (!isIsoDate(endsOn)) errors.endsOn = 'invalid';
		else if (!errors.startsOn && endsOn < startsOn) errors.endsOn = 'order';
	}

	const intervalRaw = (values.intervalWeeks ?? '').trim();
	if (intervalRaw !== '' && !/^[1-4]$/.test(intervalRaw)) errors.intervalWeeks = 'invalid';

	if (Object.keys(errors).length > 0 || !startTime.ok || !duration.ok) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		value: {
			weekdays: weekdays.map(Number).sort((a, b) => a - b),
			startTime: startTime.value,
			durationMinutes: duration.value,
			startsOn,
			endsOn,
			intervalWeeks: intervalRaw === '' ? 1 : Number(intervalRaw)
		}
	};
}

/** The inline message for each invalid schedule field. */
export function scheduleErrorMessages(
	errors: Partial<Record<ScheduleField, ScheduleProblem>>
): Partial<Record<ScheduleField, string>> {
	const messages: Partial<Record<ScheduleField, string>> = {};
	if (errors.weekdays) messages.weekdays = m.calendar_error_weekdays_required();
	if (errors.startTime) messages.startTime = m.calendar_error_time_invalid();
	if (errors.durationMinutes) messages.durationMinutes = m.calendar_error_duration_invalid();
	if (errors.startsOn) messages.startsOn = m.calendar_error_date_invalid();
	if (errors.endsOn) {
		messages.endsOn =
			errors.endsOn === 'order'
				? m.calendar_error_until_before_from()
				: m.calendar_error_date_invalid();
	}
	if (errors.intervalWeeks) messages.intervalWeeks = m.calendar_error_interval_invalid();
	return messages;
}

/** `HH:MM[:SS]` -> `HH:MM`. */
export function toHhMm(time: string): string {
	return time.slice(0, 5);
}

/** Wall-clock end time; wraps past midnight. */
export function endTime(start: string, durationMinutes: number): string {
	const [h, m] = start.split(':').map(Number);
	const total = (((h * 60 + m + durationMinutes) % 1440) + 1440) % 1440;
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type SessionStatus = 'scheduled' | 'cancelled' | 'unset';

export type ClassDayRow = { id: string; day: string; cancelled: boolean };

/** A class_sessions_effective row (view columns are nullable in the generated types). */
export type EffectiveSessionRow = {
	id: string | null;
	class_id: string | null;
	class_name: string | null;
	class_day_id: string | null;
	start_time: string | null;
	duration_minutes: number | null;
	start_time_override: string | null;
	duration_minutes_override: number | null;
	session_cancelled: boolean | null;
	day_cancelled: boolean | null;
	/** Story 6-4: a one-off session outside the class's schedule. */
	extra?: boolean | null;
};

export type CalendarSession = {
	id: string;
	classId: string;
	className: string;
	/** Effective start (`HH:MM`), null = no override and no class default. */
	start: string | null;
	end: string | null;
	durationMinutes: number | null;
	startOverride: string | null;
	durationOverride: number | null;
	/** The session's own flag, independent of the day's. */
	sessionCancelled: boolean;
	/** A one-off session outside the class's schedule (Story 6-4). */
	extra: boolean;
	status: SessionStatus;
};

export type CalendarDay = {
	id: string;
	date: string;
	cancelled: boolean;
	isToday: boolean;
	sessions: CalendarSession[];
};

export function sessionStatus(row: {
	session_cancelled: boolean | null;
	day_cancelled: boolean | null;
	start_time: string | null;
}): SessionStatus {
	if (row.session_cancelled || row.day_cancelled) return 'cancelled';
	if (!row.start_time) return 'unset';
	return 'scheduled';
}

export function shapeSession(row: EffectiveSessionRow): CalendarSession {
	const start = row.start_time ? toHhMm(row.start_time) : null;
	const duration = row.duration_minutes;
	return {
		id: row.id ?? '',
		classId: row.class_id ?? '',
		className: row.class_name ?? '',
		start,
		end: start && duration ? endTime(start, duration) : null,
		durationMinutes: duration,
		startOverride: row.start_time_override ? toHhMm(row.start_time_override) : null,
		durationOverride: row.duration_minutes_override,
		sessionCancelled: Boolean(row.session_cancelled),
		extra: Boolean(row.extra),
		status: sessionStatus(row)
	};
}

/**
 * Every class day of the month in date order, each with the sessions the
 * caller may see (RLS already scoped `sessions`), ordered by start time
 * (unset last) and then class name. Days with no visible session are kept:
 * class days are the same for every role.
 */
export function shapeMonth(
	days: ClassDayRow[],
	sessions: EffectiveSessionRow[],
	today: string
): CalendarDay[] {
	const byDay = new Map<string, CalendarSession[]>();
	for (const row of sessions) {
		if (!row.class_day_id) continue;
		const list = byDay.get(row.class_day_id) ?? [];
		list.push(shapeSession(row));
		byDay.set(row.class_day_id, list);
	}

	return [...days]
		.sort((a, b) => a.day.localeCompare(b.day))
		.map((day) => ({
			id: day.id,
			date: day.day,
			cancelled: day.cancelled,
			isToday: day.day === today,
			sessions: (byDay.get(day.id) ?? []).sort(
				(a, b) =>
					(a.start ?? '99:99').localeCompare(b.start ?? '99:99') ||
					a.className.localeCompare(b.className)
			)
		}));
}
