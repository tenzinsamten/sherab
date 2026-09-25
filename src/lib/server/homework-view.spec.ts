import { describe, expect, it } from 'vitest';
import {
	isOpen,
	summarise,
	type AssignmentInstanceView,
	type AssignmentView
} from './homework-view';

const TODAY = '2026-09-25';

function view(instances: AssignmentInstanceView[], overrides: Partial<AssignmentView> = {}) {
	return {
		id: 'a1',
		title: 'Song practice',
		skillArea: 'song',
		description: null,
		referenceLinks: [],
		createdAt: '2026-09-01T00:00:00Z',
		isRecurring: false,
		wholeClass: true,
		dueOffsetDays: null,
		endsOn: null,
		pausedAt: null,
		instances,
		...overrides
	} satisfies AssignmentView;
}

function instance(
	id: string,
	dueDate: string,
	opts: { archived?: boolean; done?: number; total?: number; overdue?: boolean } = {}
): AssignmentInstanceView {
	const total = opts.total ?? 2;
	const done = opts.done ?? 0;
	return {
		id,
		periodStart: dueDate,
		dueDate,
		archivedAt: opts.archived ? '2026-09-24T00:00:00Z' : null,
		students: Array.from({ length: total }, (_, i) => ({
			studentId: `s${i}`,
			displayName: `S${i}`,
			assignedAt: '2026-09-01T00:00:00Z',
			doneAt: i < done ? '2026-09-02T00:00:00Z' : null,
			reviewedAt: null,
			overdue: Boolean(opts.overdue) && i >= done
		})),
		doneCount: done,
		reviewedCount: 0
	};
}

describe('isOpen', () => {
	const oneOff = { isRecurring: false, pausedAt: null, endsOn: null };
	const series = { isRecurring: true, pausedAt: null, endsOn: null };

	it('is open while any instance is not archived', () => {
		expect(isOpen(oneOff, true, TODAY)).toBe(true);
	});

	it('treats a one-off with every instance archived as archived', () => {
		expect(isOpen(oneOff, false, TODAY)).toBe(false);
	});

	it('keeps an active series open even with no open instance (e.g. none generated yet)', () => {
		expect(isOpen(series, false, TODAY)).toBe(true);
	});

	it('treats a paused or ended series with nothing open as archived', () => {
		expect(isOpen({ ...series, pausedAt: '2026-09-20T00:00:00Z' }, false, TODAY)).toBe(false);
		expect(isOpen({ ...series, endsOn: TODAY }, false, TODAY)).toBe(false);
		expect(isOpen({ ...series, endsOn: '2026-10-01' }, false, TODAY)).toBe(true);
	});
});

describe('summarise', () => {
	it('uses the earliest open instance due today or later as next due', () => {
		const s = summarise(
			view([
				instance('i3', '2026-10-09'),
				instance('i2', '2026-10-02'),
				instance('i1', '2026-09-20', { archived: true })
			]),
			true,
			TODAY
		);
		expect(s.nextDue).toBe('2026-10-02');
	});

	it('falls back to the latest due date when nothing is upcoming', () => {
		const s = summarise(
			view([instance('i2', '2026-09-18'), instance('i1', '2026-09-11')]),
			true,
			TODAY
		);
		expect(s.nextDue).toBe('2026-09-18');
	});

	it('reports done / total for the most recent instance', () => {
		const s = summarise(
			view([instance('i2', '2026-10-02', { done: 1, total: 3 }), instance('i1', '2026-09-25')]),
			true,
			TODAY
		);
		expect([s.latestDone, s.latestTotal]).toEqual([1, 3]);
	});

	it('flags overdue only for open instances, and archived from the open flag', () => {
		const archivedOverdue = view([instance('i1', '2026-09-20', { archived: true, overdue: true })]);
		expect(summarise(archivedOverdue, false, TODAY)).toMatchObject({
			overdue: false,
			archived: true
		});

		const openOverdue = view([instance('i1', '2026-09-20', { overdue: true })]);
		expect(summarise(openOverdue, true, TODAY)).toMatchObject({ overdue: true, archived: false });
	});

	it('handles an assignment with no instances yet', () => {
		expect(summarise(view([], { isRecurring: true }), true, TODAY)).toMatchObject({
			nextDue: null,
			latestDone: 0,
			latestTotal: 0,
			overdue: false
		});
	});
});
