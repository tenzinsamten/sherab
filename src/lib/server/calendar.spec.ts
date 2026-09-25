import { describe, expect, it } from 'vitest';
import {
	endTime,
	isIsoDate,
	monthBounds,
	parseDurationInput,
	parseMonth,
	parseTimeInput,
	shapeMonth,
	shiftMonth,
	weeklyDates,
	type EffectiveSessionRow
} from './calendar';

describe('weeklyDates', () => {
	it('bulk add: 2026-10-04 weekly until 10-25 gives four Sundays', () => {
		expect(weeklyDates('2026-10-04', '2026-10-25')).toEqual({
			ok: true,
			dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']
		});
	});

	it('single date: start equals end', () => {
		expect(weeklyDates('2026-10-04', '2026-10-04')).toEqual({ ok: true, dates: ['2026-10-04'] });
	});

	it('stops before an end date that is not on the weekly rhythm', () => {
		expect(weeklyDates('2026-10-04', '2026-10-17')).toEqual({
			ok: true,
			dates: ['2026-10-04', '2026-10-11']
		});
	});

	it('crosses DST and year boundaries on calendar dates', () => {
		const result = weeklyDates('2026-10-18', '2026-11-01');
		expect(result).toEqual({ ok: true, dates: ['2026-10-18', '2026-10-25', '2026-11-01'] });
		expect(weeklyDates('2026-12-27', '2027-01-03')).toEqual({
			ok: true,
			dates: ['2026-12-27', '2027-01-03']
		});
	});

	it('rejects end before start', () => {
		expect(weeklyDates('2026-10-25', '2026-10-04')).toEqual({ ok: false, problem: 'order' });
	});

	it('allows exactly one year, rejects more', () => {
		const ok = weeklyDates('2026-10-04', '2027-10-04');
		expect(ok.ok).toBe(true);
		expect(weeklyDates('2026-10-04', '2027-10-05')).toEqual({ ok: false, problem: 'range' });
	});

	it('rejects invalid dates', () => {
		expect(weeklyDates('2026-02-31', '2026-03-10')).toEqual({ ok: false, problem: 'invalid' });
		expect(weeklyDates('', '')).toEqual({ ok: false, problem: 'invalid' });
		expect(isIsoDate('2026-10-04')).toBe(true);
	});

	it('rejects years outside 1900-9998 instead of looping past 9999', () => {
		expect(weeklyDates('9998-12-20', '9999-01-10')).toEqual({ ok: false, problem: 'invalid' });
		expect(weeklyDates('9999-01-03', '9999-01-10')).toEqual({ ok: false, problem: 'invalid' });
		expect(weeklyDates('0000-01-02', '0000-01-09')).toEqual({ ok: false, problem: 'invalid' });
		expect(isIsoDate('9998-12-31')).toBe(true);
		expect(isIsoDate('1900-01-01')).toBe(true);
		expect(isIsoDate('1899-12-31')).toBe(false);
	});
});

describe('month navigation', () => {
	it('parses ?month= or falls back', () => {
		expect(parseMonth('2026-10', '2026-09')).toBe('2026-10');
		expect(parseMonth('2026-13', '2026-09')).toBe('2026-09');
		expect(parseMonth('junk', '2026-09')).toBe('2026-09');
		expect(parseMonth(null, '2026-09')).toBe('2026-09');
	});

	it('falls back for years 9999 and 0000, whose neighbours are not 4-digit years', () => {
		expect(parseMonth('9999-12', '2026-09')).toBe('2026-09');
		expect(parseMonth('0000-01', '2026-09')).toBe('2026-09');
		expect(parseMonth('9998-12', '2026-09')).toBe('9998-12');
		expect(shiftMonth('9998-12', 1)).toBe('9999-01');
		expect(monthBounds('9998-12')).toEqual({ first: '9998-12-01', last: '9998-12-31' });
	});

	it('shifts across year boundaries', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
		expect(shiftMonth('2026-10', 0)).toBe('2026-10');
	});

	it('gives first and last day, including leap February', () => {
		expect(monthBounds('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31' });
		expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
		expect(monthBounds('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
	});
});

describe('form parsing', () => {
	it('time: empty = null, HH:MM accepted, seconds trimmed, junk rejected', () => {
		expect(parseTimeInput('')).toEqual({ ok: true, value: null });
		expect(parseTimeInput('11:00')).toEqual({ ok: true, value: '11:00' });
		expect(parseTimeInput('09:30:00')).toEqual({ ok: true, value: '09:30' });
		expect(parseTimeInput('24:00')).toEqual({ ok: false });
		expect(parseTimeInput('9:30')).toEqual({ ok: false });
	});

	it('duration: 15-480 whole minutes, empty = null', () => {
		expect(parseDurationInput('')).toEqual({ ok: true, value: null });
		expect(parseDurationInput('90')).toEqual({ ok: true, value: 90 });
		expect(parseDurationInput('15')).toEqual({ ok: true, value: 15 });
		expect(parseDurationInput('480')).toEqual({ ok: true, value: 480 });
		expect(parseDurationInput('14')).toEqual({ ok: false });
		expect(parseDurationInput('481')).toEqual({ ok: false });
		expect(parseDurationInput('1.5')).toEqual({ ok: false });
		expect(parseDurationInput('-30')).toEqual({ ok: false });
	});

	it('end time adds the duration and wraps past midnight', () => {
		expect(endTime('10:00', 90)).toBe('11:30');
		expect(endTime('23:30', 60)).toBe('00:30');
	});
});

function row(overrides: Partial<EffectiveSessionRow>): EffectiveSessionRow {
	return {
		id: 's1',
		class_id: 'c1',
		class_name: 'Language',
		class_day_id: 'd1',
		start_time: '10:00:00',
		duration_minutes: 60,
		start_time_override: null,
		duration_minutes_override: null,
		session_cancelled: false,
		day_cancelled: false,
		...overrides
	};
}

describe('shapeMonth', () => {
	const days = [
		{ id: 'd2', day: '2026-10-11', cancelled: false },
		{ id: 'd1', day: '2026-10-04', cancelled: false }
	];

	it('lists every class day in date order, even without visible sessions, and marks today', () => {
		const shaped = shapeMonth(days, [], '2026-10-11');
		expect(shaped.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-11']);
		expect(shaped.map((d) => d.isToday)).toEqual([false, true]);
		expect(shaped.every((d) => d.sessions.length === 0)).toBe(true);
	});

	it('override one day: only that session shows the overridden time', () => {
		const shaped = shapeMonth(
			days,
			[
				row({ id: 'a', class_day_id: 'd1' }),
				row({
					id: 'b',
					class_day_id: 'd2',
					start_time: '11:00:00',
					start_time_override: '11:00:00'
				})
			],
			'2026-10-01'
		);
		expect(shaped[0].sessions[0]).toMatchObject({
			start: '10:00',
			end: '11:00',
			startOverride: null,
			status: 'scheduled'
		});
		expect(shaped[1].sessions[0]).toMatchObject({
			start: '11:00',
			end: '12:00',
			startOverride: '11:00',
			status: 'scheduled'
		});
	});

	it('no default: session shows Time not set', () => {
		const [day] = shapeMonth(
			[days[1]],
			[row({ start_time: null, duration_minutes: null })],
			'2026-10-01'
		);
		expect(day.sessions[0]).toMatchObject({ start: null, end: null, status: 'unset' });
	});

	it('cancelled session or cancelled day both show Cancelled; the session keeps its own flag', () => {
		const shaped = shapeMonth(
			[
				{ id: 'd1', day: '2026-10-04', cancelled: true },
				{ id: 'd2', day: '2026-10-11', cancelled: false }
			],
			[
				row({ id: 'a', class_day_id: 'd1', day_cancelled: true }),
				row({ id: 'b', class_day_id: 'd2', session_cancelled: true })
			],
			'2026-10-01'
		);
		expect(shaped[0].cancelled).toBe(true);
		expect(shaped[0].sessions[0]).toMatchObject({ status: 'cancelled', sessionCancelled: false });
		expect(shaped[1].sessions[0]).toMatchObject({ status: 'cancelled', sessionCancelled: true });
	});

	it('orders sessions by start time (unset last), then class name', () => {
		const [day] = shapeMonth(
			[days[1]],
			[
				row({ id: 'x', class_name: 'Song', start_time: null }),
				row({ id: 'y', class_name: 'Dance', start_time: '11:00:00' }),
				row({ id: 'z', class_name: 'Art', start_time: '11:00:00' }),
				row({ id: 'w', class_name: 'Zither', start_time: '09:00:00' })
			],
			'2026-10-01'
		);
		expect(day.sessions.map((s) => s.id)).toEqual(['w', 'z', 'y', 'x']);
	});
});
