/**
 * Pure helpers for the /calendar page (Story 6-1): bulk class-day dates,
 * month navigation, form parsing and shaping the month's class days and
 * sessions into a date-grouped list. No I/O here; the route does the reads.
 */

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
