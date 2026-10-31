import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { actions, load } from './+page.server';

/**
 * /parent/children/[id]/homework/[instanceId] (spec-parent-managed-homework
 * story 3): a fake `locals.supabase` with one result per table; `eq` filters
 * array rows that carry the column, so a history read keyed on the wrong
 * student finds nothing.
 */
const CHILD = '11111111-2222-4333-8444-555555555555';
const SIBLING = '22222222-2222-4333-8444-555555555555';
const INSTANCE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ASSIGNMENT = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLASS = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PARENT = 'p1';

type Result = { data: unknown; error: unknown };

function fakeSupabase(opts: {
	linked?: unknown[];
	tables?: Record<string, Result>;
	insert?: Result;
}) {
	const calls: { table: string; method: string; args: unknown[] }[] = [];
	const inserted: unknown[] = [];
	function chain(table: string, initial: Result) {
		const c: Record<string, unknown> = {};
		let result = initial;
		for (const method of ['select', 'eq', 'in', 'order']) {
			c[method] = (...args: unknown[]) => {
				calls.push({ table, method, args });
				const [column, value] = args as [string, unknown];
				if (Array.isArray(result.data) && (method === 'eq' || method === 'in')) {
					result = {
						...result,
						data: (result.data as Record<string, unknown>[]).filter(
							(row) =>
								!(column in row) ||
								(method === 'eq'
									? row[column] === value
									: (value as unknown[]).includes(row[column]))
						)
					};
				}
				return c;
			};
		}
		const one = async () => ({
			data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
			error: result.error
		});
		c.maybeSingle = one;
		c.single = one;
		c.insert = (row: unknown) => {
			inserted.push(row);
			const r = opts.insert ?? { data: null, error: null };
			return { then: (resolve: (value: Result) => unknown) => resolve(r) };
		};
		c.then = (resolve: (value: Result) => unknown) => resolve(result);
		return c;
	}
	const rpc = vi.fn(async (fn: string) =>
		fn === 'linked_children'
			? { data: opts.linked ?? [], error: null }
			: { data: null, error: null }
	);
	return {
		calls,
		inserted,
		rpc,
		client: {
			rpc,
			from: (table: string) => chain(table, opts.tables?.[table] ?? { data: [], error: null })
		}
	};
}

const approvedChild = { id: CHILD, name: 'Dawa', status: 'approved' };

const instanceRow = {
	id: INSTANCE,
	assignment_id: ASSIGNMENT,
	class_id: CLASS,
	due_date: '2099-01-10',
	archived_at: null as string | null
};
const assignmentRow = {
	id: ASSIGNMENT,
	title: 'Read page 4',
	skill_area: 'language',
	content: null,
	content_language: 'en',
	reference_links: [{ url: 'https://example.com', label: 'Book' }],
	recurrence_rule: null
};
function history(studentId: string, statuses: string[]) {
	return statuses.map((status, i) => ({
		id: `h${i}`,
		instance_id: INSTANCE,
		student_id: studentId,
		status,
		recorded_by: 't1',
		recorded_at: `2026-10-0${i + 1}T10:00:00Z`
	}));
}

function tables(over: Partial<Record<string, Result>> = {}): Record<string, Result> {
	return {
		homework_instances: { data: instanceRow, error: null },
		homework_assignments: { data: assignmentRow, error: null },
		homework_status_history: { data: history(CHILD, ['assigned']), error: null },
		classes: { data: { name: 'Alphabet', name_bo: null, name_de: null }, error: null },
		profiles: { data: [{ id: CHILD, parent_managed: true }], error: null },
		homework_assignment_files: {
			data: [
				{
					id: 'f1',
					assignment_id: ASSIGNMENT,
					file_name: 'Sheet.pdf',
					size_bytes: 1024,
					created_at: '2026-10-01T00:00:00Z'
				}
			],
			error: null
		},
		...over
	} as Record<string, Result>;
}

type LoadResult = {
	child: { id: string; name: string };
	item: { instanceId: string; title: string; status: string; overdue: boolean; classId: string };
	className: string | null;
	files: unknown[];
	archived: boolean;
	parentManaged: boolean;
	loadError: boolean;
};

function runLoad(
	fake: ReturnType<typeof fakeSupabase>,
	{
		id = CHILD,
		instanceId = INSTANCE,
		parentStatus = 'approved'
	}: { id?: string; instanceId?: string; parentStatus?: string } = {}
) {
	return load({
		params: { id, instanceId },
		parent: async () => ({ parentStatus }),
		locals: { supabase: fake.client }
	} as unknown as Parameters<typeof load>[0]) as Promise<LoadResult>;
}

describe('/parent/children/[id]/homework/[instanceId] load', () => {
	it("loads the linked child's open item, flag on: full details and parentManaged", async () => {
		const fake = fakeSupabase({ linked: [approvedChild], tables: tables() });
		const result = await runLoad(fake);
		expect(result.child).toEqual({ id: CHILD, name: 'Dawa' });
		expect(result.item).toMatchObject({
			instanceId: INSTANCE,
			classId: CLASS,
			title: 'Read page 4',
			status: 'assigned',
			overdue: false
		});
		expect(result.className).toBe('Alphabet');
		expect(result.files).toEqual([{ id: 'f1', name: 'Sheet.pdf', size: 1024 }]);
		expect(result.archived).toBe(false);
		expect(result.parentManaged).toBe(true);
		expect(result.loadError).toBe(false);
		// The history is the child's, never the caller's.
		expect(fake.calls).toContainEqual({
			table: 'homework_status_history',
			method: 'eq',
			args: ['student_id', CHILD]
		});
		expect(fake.calls).not.toContainEqual({
			table: 'homework_status_history',
			method: 'eq',
			args: ['student_id', PARENT]
		});
	});

	it('flag off -> parentManaged false', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: tables({ profiles: { data: [{ id: CHILD, parent_managed: false }], error: null } })
		});
		expect((await runLoad(fake)).parentManaged).toBe(false);
	});

	it.each([
		['done', ['assigned', 'done']],
		['reviewed', ['assigned', 'done', 'reviewed']]
	])('a %s item carries that status', async (status, statuses) => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: tables({
				homework_status_history: { data: history(CHILD, statuses), error: null }
			})
		});
		expect((await runLoad(fake)).item.status).toBe(status);
	});

	it('an archived instance is marked archived', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: tables({
				homework_instances: {
					data: { ...instanceRow, archived_at: '2026-10-05T00:00:00Z' },
					error: null
				}
			})
		});
		expect((await runLoad(fake)).archived).toBe(true);
	});

	it.each([
		['a parent who is not approved', { parentStatus: 'pending' }, [approvedChild]],
		['a malformed child id', { id: 'not-a-uuid' }, [approvedChild]],
		['a child who is not linked', {}, []],
		['a pending child', {}, [{ ...approvedChild, status: 'pending' }]]
	])('404 for %s, before any homework read', async (_label, params, linked) => {
		const fake = fakeSupabase({ linked, tables: tables() });
		await expect(runLoad(fake, params)).rejects.toMatchObject({ status: 404 });
		expect(fake.calls.some((c) => c.table === 'homework_instances')).toBe(false);
	});

	it("404 for a sibling's instance (no history row for this child)", async () => {
		const fake = fakeSupabase({
			linked: [approvedChild, { id: SIBLING, name: 'Pema', status: 'approved' }],
			tables: tables({
				homework_status_history: { data: history(SIBLING, ['assigned']), error: null }
			})
		});
		await expect(runLoad(fake)).rejects.toMatchObject({ status: 404 });
	});

	it('404 for an unknown instance', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: tables({ homework_instances: { data: null, error: null } })
		});
		await expect(runLoad(fake)).rejects.toMatchObject({ status: 404 });
	});

	it('404 for a malformed instance id, without a query', async () => {
		const fake = fakeSupabase({ linked: [approvedChild], tables: tables() });
		await expect(runLoad(fake, { instanceId: 'nope' })).rejects.toMatchObject({ status: 404 });
		expect(fake.calls.some((c) => c.table === 'homework_instances')).toBe(false);
	});

	it.each([
		['instance', { homework_instances: { data: null, error: { message: 'down' } } }],
		['assignment', { homework_assignments: { data: null, error: { message: 'down' } } }],
		['history', { homework_status_history: { data: null, error: { message: 'down' } } }]
	])('500 when the %s query fails', async (_label, over) => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fake = fakeSupabase({ linked: [approvedChild], tables: tables(over) });
		await expect(runLoad(fake)).rejects.toMatchObject({ status: 500 });
		spy.mockRestore();
	});

	it('a files error still renders, with loadError', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: tables({ homework_assignment_files: { data: null, error: { message: 'down' } } })
		});
		const result = await runLoad(fake);
		expect(result.loadError).toBe(true);
		expect(result.files).toEqual([]);
		expect(result.item.title).toBe('Read page 4');
		spy.mockRestore();
	});
});

describe('/parent/children/[id]/homework/[instanceId] markDone', () => {
	function event(
		fake: ReturnType<typeof fakeSupabase>,
		{ id = CHILD, user = { id: PARENT } as { id: string } | null } = {}
	) {
		const body = new FormData();
		body.append('instanceId', INSTANCE);
		return {
			request: new Request(`http://localhost/parent/children/${id}/homework/${INSTANCE}`, {
				method: 'POST',
				body
			}),
			params: { id, instanceId: INSTANCE },
			locals: { supabase: fake.client, safeGetSession: async () => ({ user }) }
		} as unknown as Parameters<typeof actions.markDone>[0];
	}

	it("inserts the child's done row, recorded by the parent", async () => {
		const fake = fakeSupabase({
			tables: { homework_instances: { data: { id: INSTANCE, class_id: CLASS }, error: null } }
		});
		expect(await actions.markDone(event(fake))).toEqual({ success: true, action: 'markDone' });
		expect(fake.inserted).toEqual([
			{
				instance_id: INSTANCE,
				student_id: CHILD,
				class_id: CLASS,
				status: 'done',
				recorded_by: PARENT
			}
		]);
	});

	it('maps an RLS refusal (flag off / not linked) to 403', async () => {
		const fake = fakeSupabase({
			tables: { homework_instances: { data: { id: INSTANCE, class_id: CLASS }, error: null } },
			insert: { data: null, error: { code: '42501' } }
		});
		expect(await actions.markDone(event(fake))).toMatchObject({
			status: 403,
			data: { error: m.child_managed_error_mark_not_allowed() }
		});
	});

	it('a malformed child id fails 400 without an insert', async () => {
		const fake = fakeSupabase({});
		expect(await actions.markDone(event(fake, { id: 'nope' }))).toMatchObject({ status: 400 });
		expect(fake.inserted).toEqual([]);
	});

	it('redirects to /login when signed out', async () => {
		const fake = fakeSupabase({});
		await expect(actions.markDone(event(fake, { user: null }))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(fake.inserted).toEqual([]);
	});
});
