import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, num, tibetanDigits } from './format';

describe('tibetanDigits', () => {
	it('replaces Western digits only', () => {
		expect(tibetanDigits('2026')).toBe('༢༠༢༦');
		expect(tibetanDigits('17:05')).toBe('༡༧:༠༥');
		expect(tibetanDigits('ཚེས་ 3 abc')).toBe('ཚེས་ ༣ abc');
	});
});

describe('num', () => {
	it('uses Tibetan digits under the Tibetan interface only', () => {
		expect(num(1234, 'bo')).toBe('༡༢༣༤');
		expect(num('2026/27', 'bo')).toBe('༢༠༢༦/༢༧');
		expect(num(1234, 'en')).toBe('1234');
		expect(num('17:00', 'de')).toBe('17:00');
	});
});

describe('formatDay', () => {
	// 3 October 2026 is a Saturday.
	it('writes a Gregorian date in Tibetan words and digits', () => {
		expect(formatDay('2026-10-03', { day: 'numeric', month: 'long', year: 'numeric' }, 'bo')).toBe(
			'ཕྱི་ལོ་ ༢༠༢༦ ཟླ་ ༡༠ ཚེས་ ༣'
		);
		expect(formatDay('2026-10-03', { weekday: 'long', day: 'numeric', month: 'long' }, 'bo')).toBe(
			'ཕྱི་ཟླ་ ༡༠ ཚེས་ ༣ གཟའ་སྤེན་པ'
		);
		expect(formatDay('2026-10-04', { weekday: 'short', day: 'numeric', month: 'long' }, 'bo')).toBe(
			'ཕྱི་ཟླ་ ༡༠ ཚེས་ ༤ ཉི་མ'
		);
		expect(formatDay('2026-10-01', { month: 'long', year: 'numeric' }, 'bo')).toBe(
			'ཕྱི་ལོ་ ༢༠༢༦ ཟླ་ ༡༠'
		);
		expect(formatDay('2026-10-05', { weekday: 'long' }, 'bo')).toBe('གཟའ་ཟླ་བ');
	});

	it('keeps the browser format for English and German', () => {
		expect(formatDay('2026-10-03', { day: 'numeric', month: 'long', year: 'numeric' }, 'de')).toBe(
			'3. Oktober 2026'
		);
		expect(formatDay('2026-10-03', { weekday: 'long', day: 'numeric', month: 'long' }, 'en')).toBe(
			'Saturday, October 3'
		);
	});

	it('returns the input for a date it cannot read', () => {
		expect(formatDay('soon', undefined, 'bo')).toBe('soon');
	});
});

describe('formatDate', () => {
	it('formats an instant in the given time zone', () => {
		const options = {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Europe/Berlin'
		} as const;
		// 23:30 UTC on 3 October is already 4 October in Berlin.
		expect(formatDate('2026-10-03T23:30:00Z', options, 'bo')).toBe('ཕྱི་ལོ་ ༢༠༢༦ ཟླ་ ༡༠ ཚེས་ ༤');
		expect(formatDate('2026-10-03T23:30:00Z', options, 'en')).toBe('Oct 4, 2026');
	});

	it('adds the time when asked', () => {
		expect(
			formatDate(
				'2026-10-03T07:05:00Z',
				{
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'UTC'
				},
				'bo'
			)
		).toBe('ཕྱི་ལོ་ ༢༠༢༦ ཟླ་ ༡༠ ཚེས་ ༣ ༠༧:༠༥');
	});
});
