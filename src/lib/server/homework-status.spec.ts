import { describe, expect, it } from 'vitest';
import { buildHomeworkProgress, isOverdue, type HomeworkHistoryRow } from './homework-status';

function row(
	overrides: Partial<HomeworkHistoryRow> & Pick<HomeworkHistoryRow, 'id'>
): HomeworkHistoryRow {
	return {
		instanceId: 'instance-1',
		studentId: 'student-1',
		status: 'assigned',
		recordedBy: 'teacher-1',
		recordedAt: '2026-09-01T00:00:00.000Z',
		...overrides
	};
}

describe('buildHomeworkProgress', () => {
	it('tracks assigned/done/reviewed independently for one (instance, student) pair', () => {
		const rows: HomeworkHistoryRow[] = [
			row({ id: 'a', status: 'assigned', recordedAt: '2026-09-01T00:00:00.000Z' }),
			row({ id: 'd', status: 'done', recordedAt: '2026-09-08T00:00:00.000Z' }),
			row({ id: 'r', status: 'reviewed', recordedAt: '2026-09-15T00:00:00.000Z' })
		];

		const progress = buildHomeworkProgress(rows);
		const entry = progress['instance-1:student-1'];

		expect(entry.assignedAt).toBe('2026-09-01T00:00:00.000Z');
		expect(entry.doneAt).toBe('2026-09-08T00:00:00.000Z');
		expect(entry.reviewedAt).toBe('2026-09-15T00:00:00.000Z');
	});

	it('a reviewed row never hides that a done row also exists, and vice versa -- order-independent', () => {
		// Reviewed row appears BEFORE the done row in the input -- if this
		// collapsed to "latest row wins" the way skill-status does, doneAt
		// would incorrectly stay null.
		const rows: HomeworkHistoryRow[] = [
			row({ id: 'r', status: 'reviewed', recordedAt: '2026-09-15T00:00:00.000Z' }),
			row({ id: 'a', status: 'assigned', recordedAt: '2026-09-01T00:00:00.000Z' }),
			row({ id: 'd', status: 'done', recordedAt: '2026-09-08T00:00:00.000Z' })
		];

		const progress = buildHomeworkProgress(rows);
		const entry = progress['instance-1:student-1'];

		expect(entry.doneAt).not.toBeNull();
		expect(entry.reviewedAt).not.toBeNull();
	});

	it('keeps every (instance, student) pair independent', () => {
		const rows: HomeworkHistoryRow[] = [
			row({ id: 's1', instanceId: 'instance-1', studentId: 'student-1', status: 'assigned' }),
			row({ id: 's1-done', instanceId: 'instance-1', studentId: 'student-1', status: 'done' }),
			row({ id: 's2', instanceId: 'instance-1', studentId: 'student-2', status: 'assigned' }),
			row({
				id: 'other-instance',
				instanceId: 'instance-2',
				studentId: 'student-1',
				status: 'assigned'
			})
		];

		const progress = buildHomeworkProgress(rows);

		expect(Object.keys(progress).sort()).toEqual(
			['instance-1:student-1', 'instance-1:student-2', 'instance-2:student-1'].sort()
		);
		expect(progress['instance-1:student-1'].doneAt).not.toBeNull();
		expect(progress['instance-1:student-2'].doneAt).toBeNull();
		expect(progress['instance-2:student-1'].doneAt).toBeNull();
	});

	it('a student targeted but not yet progressed only has assignedAt set', () => {
		const rows: HomeworkHistoryRow[] = [row({ id: 'a', status: 'assigned' })];

		const progress = buildHomeworkProgress(rows);
		const entry = progress['instance-1:student-1'];

		expect(entry.assignedAt).not.toBeNull();
		expect(entry.doneAt).toBeNull();
		expect(entry.reviewedAt).toBeNull();
	});

	it('returns an empty object for no rows', () => {
		expect(buildHomeworkProgress([])).toEqual({});
	});
});

describe('isOverdue', () => {
	const baseProgress = {
		instanceId: 'instance-1',
		studentId: 'student-1',
		assignedAt: '2026-09-01T00:00:00.000Z',
		doneAt: null,
		reviewedAt: null
	};

	it('is overdue when due_date is in the past and the student has not done it', () => {
		expect(isOverdue('2026-09-01', baseProgress, '2026-09-15')).toBe(true);
	});

	it('is not overdue when due_date is today or in the future', () => {
		expect(isOverdue('2026-09-15', baseProgress, '2026-09-15')).toBe(false);
		expect(isOverdue('2026-09-20', baseProgress, '2026-09-15')).toBe(false);
	});

	it('is never overdue once the student has done it, even past the due date', () => {
		expect(
			isOverdue('2026-09-01', { ...baseProgress, doneAt: '2026-09-05T00:00:00.000Z' }, '2026-09-15')
		).toBe(false);
	});

	it('is never overdue once reviewed', () => {
		expect(
			isOverdue(
				'2026-09-01',
				{ ...baseProgress, reviewedAt: '2026-09-05T00:00:00.000Z' },
				'2026-09-15'
			)
		).toBe(false);
	});
});
