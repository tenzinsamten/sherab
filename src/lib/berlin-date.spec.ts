import { describe, expect, it } from 'vitest';
import { currentBerlinMonth, todayInBerlin } from './berlin-date';

describe('todayInBerlin', () => {
	it('is already the next day in Munich before UTC midnight', () => {
		// 23:30 UTC on 31 Dec = 00:30 CET on 1 Jan.
		expect(todayInBerlin(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
	});

	it('is the same day as UTC in the middle of the day', () => {
		expect(todayInBerlin(new Date('2026-10-04T12:00:00Z'))).toBe('2026-10-04');
	});

	it('uses UTC+2 in summer time: 22:30 UTC is already tomorrow', () => {
		expect(todayInBerlin(new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
		expect(todayInBerlin(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14');
	});

	it('handles the spring DST switch (29 Mar 2026, 01:00 UTC)', () => {
		expect(todayInBerlin(new Date('2026-03-28T22:59:00Z'))).toBe('2026-03-28');
		expect(todayInBerlin(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
		expect(todayInBerlin(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
		expect(todayInBerlin(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
	});

	it('handles the autumn DST switch (25 Oct 2026, 01:00 UTC)', () => {
		expect(todayInBerlin(new Date('2026-10-24T21:59:00Z'))).toBe('2026-10-24');
		expect(todayInBerlin(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
		expect(todayInBerlin(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
		expect(todayInBerlin(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
	});
});

describe('currentBerlinMonth', () => {
	it('rolls over to the next month in Munich before UTC does', () => {
		expect(currentBerlinMonth(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10');
		expect(currentBerlinMonth(new Date('2026-09-30T21:30:00Z'))).toBe('2026-09');
	});
});
