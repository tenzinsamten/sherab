import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import type { StudentHomeworkItem, StudentHomeworkList } from '$lib/server/student-homework';

// markHomeworkDone stays the real one (the action tests check its insert).
vi.mock('$lib/server/student-homework', async (importOriginal) => ({
	markHomeworkDone: (await importOriginal<typeof import('$lib/server/student-homework')>())
		.markHomeworkDone,
	loadStudentHomework: vi.fn()
}));
vi.mock('$lib/berlin-date', () => ({ todayInBerlin: () => '2026-09-28' }));

import { loadStudentHomework } from '$lib/server/student-homework';
import { actions, load } from './+page.server';

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
		content: null,
		contentLanguage: 'en',
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
		filters,
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
		/** profiles (the parent_managed flags); default: none managed. */
		profiles?: Result;
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
		},
		profiles: opts.profiles ?? {
			data: [
				{ id: A, parent_managed: false },
				{ id: B, parent_managed: false }
			],
			error: null
		}
	};
	const from = vi.fn((table: string) => tableChain(tables[table] ?? { data: [], error: null }));
	lastFrom = from;
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
			childManaged: boolean;
		}[];
		failedChildren: { id: string; name: string }[];
		loadError: boolean;
	}>;
}

const homework = vi.mocked(loadStudentHomework);
let lastFrom: ReturnType<typeof vi.fn>;

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

describe('parent homework page: parent-managed rows (spec-parent-managed-homework story 4)', () => {
	const managedA = {
		data: [
			{ id: A, parent_managed: true },
			{ id: B, parent_managed: false }
		],
		error: null
	};

	it('a managed child’s rows carry childManaged; an unmanaged child’s do not', async () => {
		const result = await run({ profiles: managedA });
		expect(result.items.map((i) => [i.childId, i.childManaged])).toEqual([
			[A, true],
			[B, false],
			[A, true]
		]);
	});

	it('flag off for every child: no row is managed', async () => {
		const result = await run();
		expect(result.items.every((i) => !i.childManaged)).toBe(true);
	});

	/** The `.in()` filters of each profiles read. */
	function profileReads() {
		return lastFrom.mock.results
			.filter((_, i) => lastFrom.mock.calls[i][0] === 'profiles')
			.map((r) => (r.value as ReturnType<typeof tableChain>).filters);
	}

	it('reads the flags once, for the children in view', async () => {
		await run({ profiles: managedA });
		expect(profileReads()).toEqual([[{ column: 'id', values: [A, B] }]]);
	});

	it('?child= reads the flag only for that child', async () => {
		const result = await run({ query: `?child=${B}`, profiles: managedA });
		expect(profileReads()).toEqual([[{ column: 'id', values: [B] }]]);
		expect(result.items.map((i) => [i.childId, i.childManaged])).toEqual([[B, false]]);
	});

	it('no approved children: no flags read', async () => {
		await run({ linked: { data: [], error: null } });
		expect(profileReads()).toEqual([]);
	});

	it('a failed flags read: no row is managed, the list still shows, the error is logged', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const result = await run({ profiles: { data: null, error: { message: 'boom' } } });
		expect(result.items).toHaveLength(3);
		expect(result.items.every((i) => !i.childManaged)).toBe(true);
		expect(result.failedChildren).toEqual([]);
		expect(spy).toHaveBeenCalledWith('parent homework: parent_managed read failed', 'boom');
		spy.mockRestore();
	});
});

describe('parent homework page: markDone (spec-parent-managed-homework story 4)', () => {
	const INSTANCE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
	const CLASS = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
	const PARENT = 'p1';

	function fake(insertError: { code: string } | null = null) {
		const inserted: unknown[] = [];
		const from = (table: string) => {
			const c = {
				select: () => c,
				eq: () => c,
				single: async () =>
					table === 'homework_instances'
						? { data: { id: INSTANCE, class_id: CLASS }, error: null }
						: { data: null, error: { message: 'no' } },
				insert: async (row: unknown) => {
					inserted.push(row);
					return { data: null, error: insertError };
				}
			};
			return c;
		};
		return { inserted, client: { from } };
	}

	function event(
		f: ReturnType<typeof fake>,
		{ childId = A as string | null, user = { id: PARENT } as { id: string } | null } = {}
	) {
		const body = new FormData();
		body.append('instanceId', INSTANCE);
		if (childId !== null) body.append('childId', childId);
		return {
			request: new Request('http://localhost/parent/homework?/markDone', { method: 'POST', body }),
			locals: { supabase: f.client, safeGetSession: async () => ({ user }) }
		} as unknown as Parameters<typeof actions.markDone>[0];
	}

	it("inserts the child's done row, recorded by the parent", async () => {
		const f = fake();
		expect(await actions.markDone(event(f))).toEqual({ success: true, action: 'markDone' });
		expect(f.inserted).toEqual([
			{
				instance_id: INSTANCE,
				student_id: A,
				class_id: CLASS,
				status: 'done',
				recorded_by: PARENT
			}
		]);
	});

	it('maps an RLS refusal (flag turned off meanwhile) to 403 with the story 2 message', async () => {
		const f = fake({ code: '42501' });
		expect(await actions.markDone(event(f))).toMatchObject({
			status: 403,
			data: { error: m.child_managed_error_mark_not_allowed() }
		});
	});

	it.each([
		['missing', null],
		['not a UUID', 'nope']
	])('a %s childId fails 400 without an insert', async (_what, childId) => {
		const f = fake();
		expect(await actions.markDone(event(f, { childId }))).toMatchObject({
			status: 400,
			data: { error: m.student_homework_error_mark_failed() }
		});
		expect(f.inserted).toEqual([]);
	});

	it('redirects to /login when signed out', async () => {
		const f = fake();
		await expect(actions.markDone(event(f, { user: null }))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(f.inserted).toEqual([]);
	});
});
