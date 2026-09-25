/**
 * Calendar dates in the school's time zone (Story 6-1). Class days and
 * session times are Munich wall-clock values, so "today" and the current
 * month must come from Europe/Berlin -- never `toISOString().slice(0, 10)`,
 * which is the UTC date and is a day off between 00:00 and 02:00 in Munich.
 */
export const SCHOOL_TIME_ZONE = 'Europe/Berlin';

const berlinDateFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: SCHOOL_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** `YYYY-MM-DD` of `now` in Europe/Berlin. */
export function todayInBerlin(now: Date = new Date()): string {
	const parts = Object.fromEntries(
		berlinDateFormat.formatToParts(now).map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

/** `YYYY-MM` of `now` in Europe/Berlin. */
export function currentBerlinMonth(now: Date = new Date()): string {
	return todayInBerlin(now).slice(0, 7);
}
