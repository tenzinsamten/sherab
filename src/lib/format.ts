import { getLocale } from '$lib/paraglide/runtime';

/**
 * Dates and numbers in the viewer's language (#80). English and German use
 * the browser's `Intl`; Tibetan is written here, because browsers ship no
 * Tibetan date or digit data (Chrome formats `bo` as English). Tibetan dates
 * are Gregorian dates in Tibetan words and digits, not the lunar calendar.
 */

const TIBETAN_DIGITS = '༠༡༢༣༤༥༦༧༨༩';

/** Sunday first, as `Date.getUTCDay()`. */
const TIBETAN_WEEKDAYS = ['ཉི་མ', 'ཟླ་བ', 'མིག་དམར', 'ལྷག་པ', 'ཕུར་བུ', 'པ་སངས', 'སྤེན་པ'];
const ENGLISH_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Every Western digit in `text` as a Tibetan digit. */
export function tibetanDigits(text: string): string {
	return text.replace(/[0-9]/g, (d) => TIBETAN_DIGITS[Number(d)]);
}

/**
 * A number, or text made of digits such as a time (`17:00`) or a school year
 * (`2026/27`), in the viewer's digits.
 */
export function num(value: number | string, locale: string = getLocale()): string {
	const text = String(value);
	return locale === 'bo' ? tibetanDigits(text) : text;
}

function tibetanDate(date: Date, options: Intl.DateTimeFormatOptions): string {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: options.timeZone,
		weekday: 'short',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? '';

	const out: string[] = [];
	if (options.year) out.push(`ཕྱི་ལོ་ ${Number(part('year'))}`);
	if (options.month) {
		// "ཕྱི་ཟླ་" (Western month) when no year says which calendar it is.
		out.push(`${options.year ? 'ཟླ་' : 'ཕྱི་ཟླ་'} ${Number(part('month'))}`);
	}
	if (options.day) out.push(options.month ? `ཚེས་ ${Number(part('day'))}` : part('day'));
	if (options.weekday) {
		const name = TIBETAN_WEEKDAYS[ENGLISH_WEEKDAYS.indexOf(part('weekday'))] ?? '';
		out.push(options.weekday === 'long' ? `གཟའ་${name}` : name);
	}
	if (options.hour) out.push(`${part('hour')}:${part('minute')}`);
	return tibetanDigits(out.join(' '));
}

/** An instant, formatted with `Intl.DateTimeFormat` options in the viewer's language. */
export function formatDate(
	value: Date | string,
	options: Intl.DateTimeFormatOptions,
	locale: string = getLocale()
): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) return String(value);
	if (locale === 'bo') return tibetanDate(date, options);
	return new Intl.DateTimeFormat(locale, options).format(date);
}

/** A wall-clock date (`YYYY-MM-DD`), formatted as UTC so no time zone shifts the day. */
export function formatDay(
	date: string,
	options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
	locale: string = getLocale()
): string {
	const instant = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(instant.getTime())) return date;
	return formatDate(instant, { ...options, timeZone: 'UTC' }, locale);
}

/**
 * A wall-clock date where English and German show it as stored
 * (`YYYY-MM-DD`): the same under them, a written date under Tibetan.
 */
export function isoDay(date: string, locale: string = getLocale()): string {
	return locale === 'bo' ? formatDay(date, undefined, locale) : date;
}

/** A timestamp as a calendar date in the school's time zone, optionally with the time. */
export function formatInstant(iso: string, withTime = false, locale: string = getLocale()): string {
	return formatDate(
		iso,
		{
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
			timeZone: 'Europe/Berlin'
		},
		locale
	);
}
