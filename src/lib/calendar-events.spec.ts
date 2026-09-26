import { describe, expect, it } from 'vitest';
import type { CalendarDay, CalendarSession } from '$lib/server/calendar';
import {
	CLASS_COLOUR_COUNT,
	classColourIndex,
	eventDomClass,
	toCalendarEvents
} from './calendar-events';

function session(overrides: Partial<CalendarSession> = {}): CalendarSession {
	return {
		id: 's1',
		classId: 'class-a',
		className: 'Class A',
		start: '10:00',
		end: '11:30',
		durationMinutes: 90,
		startOverride: null,
		durationOverride: null,
		sessionCancelled: false,
		status: 'scheduled',
		...overrides
	};
}

function day(overrides: Partial<CalendarDay> = {}): CalendarDay {
	return {
		id: 'd1',
		date: '2026-10-04',
		cancelled: false,
		isToday: false,
		sessions: [session()],
		...overrides
	};
}

describe('classColourIndex', () => {
	it('is stable per class id and inside the palette', () => {
		const ids = ['a', 'class-a', '7f9c1e2a-0000-4000-8000-000000000001', ''];
		for (const id of ids) {
			const index = classColourIndex(id);
			expect(index).toBe(classColourIndex(id));
			expect(index).toBeGreaterThanOrEqual(0);
			expect(index).toBeLessThan(CLASS_COLOUR_COUNT);
		}
	});
});

describe('toCalendarEvents', () => {
	it('maps 3 class days with 2 classes to 6 timed chips in date order', () => {
		const days = ['2026-10-04', '2026-10-11', '2026-10-18'].map((date, i) =>
			day({
				id: `d${i}`,
				date,
				sessions: [
					session({ id: `a${i}`, classId: 'class-a', className: 'Class A' }),
					session({ id: `b${i}`, classId: 'class-b', className: 'Class B', start: '11:00' })
				]
			})
		);
		const events = toCalendarEvents(days);
		expect(events).toHaveLength(6);
		expect(events.map((e) => e.start)).toEqual([
			'2026-10-04T10:00:00',
			'2026-10-04T11:00:00',
			'2026-10-11T10:00:00',
			'2026-10-11T11:00:00',
			'2026-10-18T10:00:00',
			'2026-10-18T11:00:00'
		]);
		expect(events.map((e) => e.extendedProps.order)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(events.every((e) => !e.allDay)).toBe(true);
	});

	it('gives a timed session its start, end, title and class colour', () => {
		const [event] = toCalendarEvents([day()]);
		expect(event).toMatchObject({
			id: 's1',
			allDay: false,
			start: '2026-10-04T10:00:00',
			end: '2026-10-04T11:30:00',
			title: 'Class A'
		});
		expect(event.classNames).toContain(`chip-c${classColourIndex('class-a')}`);
		expect(event.classNames).toContain(eventDomClass('s1'));
		expect(event.extendedProps).toMatchObject({
			kind: 'session',
			date: '2026-10-04',
			dayId: 'd1',
			cancelled: false
		});
	});

	it('shows a session without a start time as an all-day chip', () => {
		const [event] = toCalendarEvents([
			day({
				sessions: [session({ start: null, end: null, durationMinutes: null, status: 'unset' })]
			})
		]);
		expect(event).toMatchObject({ allDay: true, start: '2026-10-04', end: '2026-10-04' });
	});

	it('uses a zero-length event when there is no duration', () => {
		const [event] = toCalendarEvents([
			day({ sessions: [session({ end: null, durationMinutes: null })] })
		]);
		expect(event.start).toBe('2026-10-04T10:00:00');
		expect(event.end).toBe('2026-10-04T10:00:00');
	});

	it('clamps a session that runs past midnight to its own day', () => {
		const [event] = toCalendarEvents([
			day({ sessions: [session({ start: '23:00', end: '01:00', durationMinutes: 120 })] })
		]);
		expect(event.end).toBe('2026-10-04T23:59:00');
	});

	it('greys a cancelled session instead of using the class colour', () => {
		const [event] = toCalendarEvents([
			day({ sessions: [session({ sessionCancelled: true, status: 'cancelled' })] })
		]);
		expect(event.classNames).toContain('chip-cancelled');
		expect(event.classNames.some((c) => /^chip-c\d$/.test(c))).toBe(false);
		expect(event.extendedProps.cancelled).toBe(true);
	});

	it('marks sessions of a cancelled day as cancelled and keeps the day flag', () => {
		const [event] = toCalendarEvents([
			day({ cancelled: true, sessions: [session({ status: 'cancelled' })] })
		]);
		expect(event.classNames).toContain('chip-cancelled');
		expect(event.extendedProps).toMatchObject({ cancelled: true, dayCancelled: true });
	});

	it('adds an all-day marker for a class day without visible sessions', () => {
		const events = toCalendarEvents([day({ id: 'd9', sessions: [] })]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			id: 'day-d9',
			allDay: true,
			start: '2026-10-04',
			extendedProps: { kind: 'day', dayId: 'd9', cancelled: false }
		});
		expect(events[0].classNames).toContain('chip-day');
	});

	it('greys the marker of a cancelled empty class day', () => {
		const [event] = toCalendarEvents([day({ cancelled: true, sessions: [] })]);
		expect(event.classNames).toContain('chip-cancelled');
		expect(event.extendedProps.cancelled).toBe(true);
	});

	it('returns no events for a month without class days', () => {
		expect(toCalendarEvents([])).toEqual([]);
	});
});
