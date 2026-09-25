import { describe, expect, it } from 'vitest';
import type { HomeworkHistoryRow } from './homework-status';
import {
	groupByClass,
	isTodoVisible,
	loadStudentHomework,
	splitProgress,
	teamRank,
	weekStart,
	type StudentHomeworkItem
} from './student-homework';

const TODAY = '2026-09-25';

function row(
	instanceId: string,
	status: HomeworkHistoryRow['status'],
	recordedAt = '2026-09-20T00:00:00Z',
	studentId = 'me'
): HomeworkHistoryRow {
	return {
		id: `${instanceId}-${status}`,
		instanceId,
		studentId,
		status,
		recordedBy: null,
		recordedAt
	};
}

describe('splitProgress', () => {
	it('splits open from finished, latest finished first', () => {
		const { todo, done } = splitProgress(
			[
				row('open', 'assigned'),
				row('old', 'assigned'),
				row('old', 'done', '2026-09-10T00:00:00Z'),
				row('new', 'assigned'),
				row('new', 'done', '2026-09-22T00:00:00Z'),
				row('new', 'reviewed', '2026-09-23T00:00:00Z'),
				row('other', 'assigned', '2026-09-20T00:00:00Z', 'someone-else')
			],
			'me'
		);
		expect(todo.map((p) => p.instanceId)).toEqual(['open']);
		expect(done.map((p) => p.instanceId)).toEqual(['new', 'old']);
	});
});

describe('isTodoVisible', () => {
	const enrolled = new Set(['c1']);
	const inst = { id: 'i', assignment_id: 'a', class_id: 'c1', due_date: TODAY, archived_at: null };

	it('shows open homework of a current class within the look-ahead window', () => {
		expect(isTodoVisible(inst, enrolled, '2026-10-09')).toBe(true);
	});

	it('hides archived, too-far-out, and left-class homework', () => {
		expect(isTodoVisible({ ...inst, archived_at: TODAY }, enrolled, '2026-10-09')).toBe(false);
		expect(isTodoVisible({ ...inst, due_date: '2026-11-01' }, enrolled, '2026-10-09')).toBe(false);
		expect(isTodoVisible({ ...inst, class_id: 'left' }, enrolled, '2026-10-09')).toBe(false);
	});
});

describe('groupByClass', () => {
	const item = (instanceId: string, classId: string) =>
		({ instanceId, classId }) as StudentHomeworkItem;
	const classes = [
		{ id: 'c1', name: 'Dance', hasSyllabus: true },
		{ id: 'c2', name: 'Song', hasSyllabus: false }
	];

	it('keeps empty classes when asked, and adds a left class at the end', () => {
		const groups = groupByClass([item('i1', 'c1'), item('i2', 'gone')], classes, {
			includeEmpty: true,
			formerLabel: 'Former class'
		});
		expect(groups.map((g) => [g.name, g.items.length])).toEqual([
			['Dance', 1],
			['Song', 0],
			['Former class', 1]
		]);
	});

	it('drops empty classes otherwise', () => {
		const groups = groupByClass([item('i1', 'c2')], classes, {
			includeEmpty: false,
			formerLabel: 'Former class'
		});
		expect(groups.map((g) => g.classId)).toEqual(['c2']);
	});
});

describe('loadStudentHomework', () => {
	type Result = { data: unknown; error: unknown };

	function fakeSupabase(tables: Record<string, Result>) {
		// Honours `.in(column, values)` like PostgREST would.
		const chain = (result: Result) => {
			let filter: { column: string; values: unknown[] } | null = null;
			const c = {
				select: () => c,
				eq: () => c,
				in: (column: string, values: unknown[]) => {
					filter = { column, values };
					return c;
				},
				order: () => c,
				range: () => c,
				maybeSingle: () => c,
				then: (resolve: (value: Result) => unknown) => {
					const f = filter;
					const data =
						f && Array.isArray(result.data)
							? result.data.filter((r: Record<string, unknown>) => f.values.includes(r[f.column]))
							: result.data;
					return resolve({ ...result, data });
				}
			};
			return c;
		};
		return {
			from: (table: string) => chain(tables[table] ?? { data: [], error: null })
		} as unknown as Parameters<typeof loadStudentHomework>[0];
	}

	const history = [
		{
			id: 'h1',
			instance_id: 'i1',
			class_id: 'c1',
			student_id: 'me',
			status: 'assigned',
			recorded_by: null,
			recorded_at: '2026-09-20T00:00:00Z'
		},
		{
			id: 'h2',
			instance_id: 'i2',
			class_id: 'left',
			student_id: 'me',
			status: 'assigned',
			recorded_by: null,
			recorded_at: '2026-09-20T00:00:00Z'
		},
		{
			id: 'h3',
			instance_id: 'i3',
			class_id: 'c1',
			student_id: 'me',
			status: 'assigned',
			recorded_by: null,
			recorded_at: '2026-09-01T00:00:00Z'
		},
		{
			id: 'h4',
			instance_id: 'i3',
			class_id: 'c1',
			student_id: 'me',
			status: 'done',
			recorded_by: 'me',
			recorded_at: '2026-09-02T00:00:00Z'
		}
	];
	const instances = [
		{ id: 'i1', assignment_id: 'a1', class_id: 'c1', due_date: '2026-09-27', archived_at: null },
		{ id: 'i2', assignment_id: 'a1', class_id: 'left', due_date: '2026-09-26', archived_at: null },
		{ id: 'i3', assignment_id: 'a1', class_id: 'c1', due_date: '2026-09-05', archived_at: null }
	];
	const assignments = [
		{
			id: 'a1',
			title: 'Practice',
			skill_area: 'song',
			description: null,
			reference_links: [],
			recurrence_rule: null
		}
	];
	const tables = {
		homework_status_history: { data: history, error: null },
		app_settings: { data: { value: { days: 14 } }, error: null },
		homework_instances: { data: instances, error: null },
		homework_assignments: { data: assignments, error: null }
	};

	it('lists To do for current classes only, with counts for both lists', async () => {
		const result = await loadStudentHomework(fakeSupabase(tables), 'me', {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(['c1']),
			today: TODAY
		});
		expect(result.items.map((i) => i.instanceId)).toEqual(['i1']);
		expect(result.counts).toEqual({ todo: 1, done: 1 });
		expect(result.error).toBe(false);
	});

	it('lists Done with its status', async () => {
		const result = await loadStudentHomework(fakeSupabase(tables), 'me', {
			filter: 'done',
			page: 1,
			enrolledClassIds: new Set(['c1']),
			today: TODAY
		});
		expect(result.items.map((i) => [i.instanceId, i.status])).toEqual([['i3', 'done']]);
		expect(result.pageCount).toBe(1);
	});

	it('counts homework finished since Monday', async () => {
		const withRecent = {
			...tables,
			homework_status_history: {
				data: [
					...history,
					{ ...history[0], id: 'h5', status: 'done', recorded_at: '2026-09-22T08:00:00Z' }
				],
				error: null
			}
		};
		const result = await loadStudentHomework(fakeSupabase(withRecent), 'me', {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(['c1']),
			today: TODAY
		});
		expect(result.doneThisWeek).toBe(1);
		expect(result.counts).toEqual({ todo: 0, done: 2 });
	});

	it("reads only one class's history when given a class", async () => {
		const result = await loadStudentHomework(fakeSupabase(tables), 'me', {
			filter: 'done',
			page: 1,
			enrolledClassIds: new Set(['left']),
			today: TODAY,
			classId: 'left'
		});
		expect(result.counts).toEqual({ todo: 1, done: 0 });
		expect(result.items).toEqual([]);
	});

	it('flags a failed history read', async () => {
		const result = await loadStudentHomework(
			fakeSupabase({ ...tables, homework_status_history: { data: null, error: { message: 'x' } } }),
			'me',
			{ filter: 'todo', page: 1, enrolledClassIds: new Set(['c1']), today: TODAY }
		);
		expect(result.error).toBe(true);
	});
});

describe('weekStart', () => {
	it('returns the Monday of the week', () => {
		expect(weekStart('2026-09-25')).toBe('2026-09-21');
		expect(weekStart('2026-09-21')).toBe('2026-09-21');
		expect(weekStart('2026-09-27')).toBe('2026-09-21');
	});
});

describe('teamRank', () => {
	const teams = [
		{ teamId: 't1', teamName: 'Snow Lions' },
		{ teamId: 't2', teamName: 'Yaks' }
	];

	it("gives the team's place on the leaderboard", () => {
		expect(teamRank(teams, 't2')).toEqual({ name: 'Yaks', rank: 2, total: 2 });
	});

	it('is null without a team or when the team is not listed', () => {
		expect(teamRank(teams, null)).toBeNull();
		expect(teamRank(teams, 'gone')).toBeNull();
	});
});
