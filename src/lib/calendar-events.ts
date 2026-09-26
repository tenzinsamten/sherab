import type { CalendarDay, CalendarSession } from '$lib/server/calendar';

/**
 * Pure mapping from the /calendar month data (Story 6-1 `shapeMonth`) to
 * `@event-calendar/core` event inputs (#47). Dates and times are wall-clock
 * Munich values, so they are passed as offset-free ISO strings, which the
 * library reads as local wall-clock time -- no time zone shifts the day.
 */

/** Number of chip colours; a class's colour is fixed by its id. */
export const CLASS_COLOUR_COUNT = 6;

/** Stable palette slot (0..CLASS_COLOUR_COUNT-1) for a class id. */
export function classColourIndex(classId: string): number {
	let hash = 0;
	for (let i = 0; i < classId.length; i++) {
		hash = (hash * 31 + classId.charCodeAt(i)) >>> 0;
	}
	return hash % CLASS_COLOUR_COUNT;
}

export type SessionEventProps = {
	kind: 'session';
	/** Position in the month's order (start time, unset last, then class name). */
	order: number;
	date: string;
	dayId: string;
	dayCancelled: boolean;
	cancelled: boolean;
	session: CalendarSession;
};

/** A class day on which the caller sees no session: shown so the day is still visible. */
export type DayEventProps = {
	kind: 'day';
	order: number;
	date: string;
	dayId: string;
	dayCancelled: boolean;
	cancelled: boolean;
};

export type CalendarEventProps = SessionEventProps | DayEventProps;

export type CalendarEventInput = {
	id: string;
	allDay: boolean;
	start: string;
	end: string;
	title: string;
	classNames: string[];
	extendedProps: CalendarEventProps;
};

/** DOM class that identifies an event's chip (used to return focus to it). */
export function eventDomClass(id: string): string {
	return `ev-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

function sessionEvent(day: CalendarDay, session: CalendarSession, order: number) {
	const cancelled = session.status === 'cancelled';
	const classNames = [
		'chip',
		cancelled ? 'chip-cancelled' : `chip-c${classColourIndex(session.classId)}`,
		eventDomClass(session.id)
	];
	const extendedProps: SessionEventProps = {
		kind: 'session',
		order,
		date: day.date,
		dayId: day.id,
		dayCancelled: day.cancelled,
		cancelled,
		session
	};

	if (!session.start) {
		return {
			id: session.id,
			allDay: true,
			start: day.date,
			end: day.date,
			title: session.className,
			classNames,
			extendedProps
		};
	}

	const start = `${day.date}T${session.start}:00`;
	// No duration: a zero-length event. Past midnight: clamp to the end of
	// the day so the chip stays in its own cell (the dialog shows the real end).
	const end =
		session.end === null
			? start
			: session.end > session.start
				? `${day.date}T${session.end}:00`
				: `${day.date}T23:59:00`;
	return {
		id: session.id,
		allDay: false,
		start,
		end,
		title: session.className,
		classNames,
		extendedProps
	};
}

/**
 * One event per visible session (timed when it has an effective start,
 * all-day "Time not set" otherwise), plus one all-day marker for each class
 * day without a visible session. Cancelled sessions (own flag or cancelled
 * day) get the grey `chip-cancelled` class instead of the class colour.
 */
export function toCalendarEvents(days: CalendarDay[]): CalendarEventInput[] {
	const events: CalendarEventInput[] = [];
	let order = 0;
	for (const day of days) {
		if (day.sessions.length === 0) {
			const extendedProps: DayEventProps = {
				kind: 'day',
				order: order++,
				date: day.date,
				dayId: day.id,
				dayCancelled: day.cancelled,
				cancelled: day.cancelled
			};
			events.push({
				id: `day-${day.id}`,
				allDay: true,
				start: day.date,
				end: day.date,
				title: '',
				classNames: [
					'chip',
					'chip-day',
					...(day.cancelled ? ['chip-cancelled'] : []),
					eventDomClass(`day-${day.id}`)
				],
				extendedProps
			});
			continue;
		}
		for (const session of day.sessions) {
			events.push(sessionEvent(day, session, order++));
		}
	}
	return events;
}
