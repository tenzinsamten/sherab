import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentHomeworkItem, StudentHomeworkList } from '$lib/server/student-homework';

vi.mock('$lib/server/student-homework', () => ({
	loadStudentHomework: vi.fn()
}));
vi.mock('$lib/berlin-date', () => ({ todayInBerlin: () => '2026-09-28' }));

import { loadStudentHomework } from '$lib/server/student-homework';
import { load } from './+page.server';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PENDING = '33333333-3333-4333-8333-333333333333';

function item(
	instanceId: string,
	title: string,
	dueDate: string,
	opts: Partial<StudentHomeworkItem> = {}
): StudentHomeworkItem {
	return {
		instanceId,
		assignmentId: `a-${instanceId}`,
		classId: 'k1',
		title,
		skillArea: 'language',
		description: null,
		referenceLinks: [],
		dueDate,
		status: 'assigned',
		overdue: false,
		isRecurring: false,
		...opts
	};
}

function list(items: StudentHomeworkItem[], error = false): StudentHomeworkList {
	return {
		items,
		counts: { todo: items.length, done: 0 },
		doneThisWeek: 0,
		page: 1,
		pageCount: 1,
		error
	};
}

type Result = { data: unknown; error: { message: string } | null };

/** A PostgREST-like chain honouring `.eq()` and `.in()`. */
function tableChain(result: Result) {
	const filters: { column: string; values: unknown[] }[] = [];
	const chain = {
		select: () => chain,
		eq: (column: string, value: unknown) => {
			filters.push({ column, values: [value] });
			return chain;
		},
		in: (column: string, values: unknown[]) => {
			filters.push({ column, values });
			return chain;
		},
		then: (resolve: (value: Result) => unknown) => {
			const data = Array.isArray(result.data)
				? result.data.filter((r: Record<string, unknown>) =>
						filters.every((f) => f.values.includes(r[f.column]))
					)
				: result.data;
			return resolve({ ...result, data });
		}
	};
	return chain;
}

const linkedTwo = [
	{ id: A, name: 'Dawa', status: 'approved' },
	{ id: B, name: 'Pema', status: 'approved' },
	{ id: PENDING, name: 'Tashi', status: 'pending' }
];

function run(
	opts: {
		query?: string;
		parentStatus?: string;
		confirmed?: boolean;
		linked?: Result;
	} = {}
) {
	const rpc = vi.fn(async () => opts.linked ?? { data: linkedTwo, error: null });
	const tables: Record<string, Result> = {
		class_enrollments: {
			data: [
				{ student_id: A, class_id: 'k1' },
				{ student_id: B, class_id: 'k2' }
			],
			error: null
		},
		classes: {
			data: [
				{ id: 'k1', name: 'Class One' },
				{ id: 'k2', name: 'Class Two' }
			],
			error: null
		}
	};
	const from = vi.fn((table: string) => tableChain(tables[table] ?? { data: [], error: null }));
	return load({
		url: new URL(`http://localhost/parent/homework${opts.query ?? ''}`),
		parent: async () => ({
			parentStatus: opts.parentStatus ?? 'approved',
			profile: { email_confirmed_at: opts.confirmed === false ? null : '2026-01-01T00:00:00Z' }
		}),
		locals: { supabase: { rpc, from } }
	} as unknown as Parameters<typeof load>[0]) as Promise<{
		children: { id: string; name: string }[];
		selectedChild: string | null;
		inView: { id: string; name: string }[];
		items: {
			childId: string;
			childName: string;
			instanceId: string;
			title: string;
			className: string | null;
			dueDate: string;
			overdue: boolean;
		}[];
		failedChildren: { id: string; name: string }[];
		loadError: boolean;
	}>;
}

const homework = vi.mocked(loadStudentHomework);

beforeEach(() => {
	homework.mockReset();
	homework.mockImplementation(async (_supabase, studentId) =>
		studentId === A
			? list([
					item('i-fri', 'Read chapter 2', '2026-10-02', { classId: 'k1' }),
					item('i-late', 'Write alphabet', '2026-09-20', { classId: 'k1', overdue: true })
				])
			: list([item('i-wed', 'Learn song', '2026-09-30', { classId: 'k2' })])
	);
});

describe('parent homework page (#59)', () => {
	it('merges children: overdue first, then due date, each row naming its child and class', async () => {
		const result = await run();
		expect(result.items.map((i) => [i.childName, i.title, i.className])).toEqual([
			['Dawa', 'Write alphabet', 'Class One'],
			['Pema', 'Learn song', 'Class Two'],
			['Dawa', 'Read chapter 2', 'Class One']
		]);
		expect(result.children).toEqual([
			{ id: A, name: 'Dawa' },
			{ id: B, name: 'Pema' }
		]);
		expect(result.selectedChild).toBeNull();
		expect(result.failedChildren).toEqual([]);
	});

	it('reads each approved child with the To-do rule and that child’s enrollments', async () => {
		await run();
		expect(homework).toHaveBeenCalledTimes(2);
		expect(homework).toHaveBeenCalledWith(expect.anything(), A, {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(['k1']),
			today: '2026-09-28'
		});
		expect(homework).toHaveBeenCalledWith(expect.anything(), B, {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(['k2']),
			today: '2026-09-28'
		});
		expect(homework).not.toHaveBeenCalledWith(expect.anything(), PENDING, expect.anything());
	});

	it('sorts by title when overdue and due date tie', async () => {
		homework.mockImplementation(async (_s, studentId) =>
			studentId === A
				? list([item('x1', 'Zebra', '2026-09-30'), item('x2', 'Apple', '2026-09-30')])
				: list([])
		);
		const result = await run();
		expect(result.items.map((i) => i.title)).toEqual(['Apple', 'Zebra']);
	});

	it('?child= narrows to one approved child', async () => {
		const result = await run({ query: `?child=${B}` });
		expect(result.selectedChild).toBe(B);
		expect(result.items.map((i) => i.childId)).toEqual([B]);
		expect(homework).toHaveBeenCalledTimes(1);
	});

	it.each([PENDING, 'someone-else', ''])(
		'?child=%s (not an approved child) shows all',
		async (id) => {
			const result = await run({ query: `?child=${id}` });
			expect(result.selectedChild).toBeNull();
			expect(result.items).toHaveLength(3);
		}
	);

	it('one child: that child’s items', async () => {
		const result = await run({
			linked: { data: [{ id: A, name: 'Dawa', status: 'approved' }], error: null }
		});
		expect(result.children).toHaveLength(1);
		expect(result.items.every((i) => i.childId === A)).toBe(true);
	});

	it('lists exactly the loader’s open items per child (matches the card count)', async () => {
		const result = await run();
		expect(result.items.filter((i) => i.childId === A)).toHaveLength(2);
		expect(result.items.filter((i) => i.childId === B)).toHaveLength(1);
	});

	it('no approved children: nothing read', async () => {
		const result = await run({
			linked: { data: [{ id: PENDING, name: 'Tashi', status: 'pending' }], error: null }
		});
		expect(result.children).toEqual([]);
		expect(result.items).toEqual([]);
		expect(result.loadError).toBe(false);
		expect(homework).not.toHaveBeenCalled();
	});

	it('flags a linked_children failure', async () => {
		const result = await run({ linked: { data: null, error: { message: 'boom' } } });
		expect(result.loadError).toBe(true);
		expect(result.children).toEqual([]);
	});

	it('one child’s read failing still shows the other child', async () => {
		homework.mockImplementation(async (_s, studentId) =>
			studentId === A ? list([item('ok', 'Read', '2026-09-30')]) : list([], true)
		);
		const result = await run();
		expect(result.items.map((i) => i.childId)).toEqual([A]);
		expect(result.failedChildren).toEqual([{ id: B, name: 'Pema' }]);
	});

	it('keeps reference links on each row', async () => {
		const links = [{ url: 'https://example.com', label: 'Video' }];
		homework.mockImplementation(async (_s, studentId) =>
			studentId === A
				? list([item('l', 'Watch', '2026-09-30', { referenceLinks: links })])
				: list([])
		);
		const result = await run();
		expect(result.items[0]).toMatchObject({ referenceLinks: links });
	});

	it.each([
		['pending', true],
		['rejected', true],
		['approved', false]
	])('status %s (confirmed %s) is sent to the landing page', async (parentStatus, confirmed) => {
		await expect(run({ parentStatus, confirmed })).rejects.toMatchObject({
			status: 303,
			location: '/parent'
		});
	});
});
