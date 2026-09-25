import { describe, expect, it } from 'vitest';
import type { HomeworkHistoryRow } from './homework-status';
import { buildTeacherHomeworkTiles, type DashboardInstance } from './teacher-dashboard';

const TODAY = '2026-09-25';
let nextId = 0;

function row(
	instanceId: string,
	studentId: string,
	status: HomeworkHistoryRow['status']
): HomeworkHistoryRow {
	return {
		id: `h${nextId++}`,
		instanceId,
		studentId,
		status,
		recordedBy: null,
		recordedAt: '2026-09-20T10:00:00Z'
	};
}

function instance(
	id: string,
	dueDate: string,
	archivedAt: string | null = null
): DashboardInstance {
	return { id, dueDate, archivedAt };
}

describe('buildTeacherHomeworkTiles', () => {
	it('is all zeros with no homework (never NaN)', () => {
		expect(buildTeacherHomeworkTiles([], [], TODAY)).toEqual({
			dueThisWeek: 0,
			overdue: 0,
			awaitingReview: 0,
			completionPercent: 0
		});
	});

	it('counts open instances due from today through six days ahead', () => {
		const instances = [
			instance('today', '2026-09-25'),
			instance('day6', '2026-10-01'),
			instance('day7', '2026-10-02'),
			instance('past', '2026-09-24'),
			instance('archived', '2026-09-26', '2026-09-21T00:00:00Z')
		];
		expect(buildTeacherHomeworkTiles(instances, [], TODAY).dueThisWeek).toBe(2);
	});

	it('counts overdue pairs, skipping done and archived ones', () => {
		const instances = [
			instance('late', '2026-09-20'),
			instance('lateArchived', '2026-09-20', '2026-09-22T00:00:00Z')
		];
		const history = [
			row('late', 's1', 'assigned'),
			row('late', 's2', 'assigned'),
			row('late', 's2', 'done'),
			row('lateArchived', 's1', 'assigned')
		];
		expect(buildTeacherHomeworkTiles(instances, history, TODAY).overdue).toBe(1);
	});

	it('counts done-but-not-reviewed pairs as awaiting review', () => {
		const instances = [instance('i1', '2026-09-30')];
		const history = [
			row('i1', 's1', 'assigned'),
			row('i1', 's1', 'done'),
			row('i1', 's2', 'assigned'),
			row('i1', 's2', 'done'),
			row('i1', 's2', 'reviewed'),
			row('i1', 's3', 'assigned')
		];
		expect(buildTeacherHomeworkTiles(instances, history, TODAY).awaitingReview).toBe(1);
	});

	it('computes completion over distinct pairs, ignoring duplicate done marks', () => {
		const instances = [instance('i1', '2026-09-30')];
		const history = [
			row('i1', 's1', 'assigned'),
			row('i1', 's1', 'done'),
			row('i1', 's1', 'done'),
			row('i1', 's2', 'assigned'),
			row('i1', 's3', 'assigned')
		];
		expect(buildTeacherHomeworkTiles(instances, history, TODAY).completionPercent).toBe(33);
	});
});
