import { beforeEach, describe, expect, it, vi } from 'vitest';

const createUser = vi.fn();
const deleteUser = vi.fn();
vi.mock('$lib/supabase/admin', () => ({
	createSupabaseAdminClient: () => ({ auth: { admin: { createUser, deleteUser } } })
}));

const { actions, load } = await import('./+page.server');
const m = await import('$lib/paraglide/messages.js');

/**
 * B14b (#68): the create action. `locals.supabase` answers each table's
 * reads from a queue in call order, records inserts, and `rpc` is a spy.
 */
type Result = { data: unknown; error: unknown };

function fakeSupabase(
	queues: Record<string, Result[]>,
	rpcResult: Result = { data: null, error: null }
) {
	const inserts: { table: string; rows: unknown }[] = [];
	const eqs: { table: string; column: string; value: unknown }[] = [];
	const cursors: Record<string, number> = {};
	const rpc = vi.fn(async () => rpcResult);
	const supabase = {
		rpc,
		from: (table: string) => {
			const next = () => {
				const queue = queues[table] ?? [{ data: null, error: null }];
				const i = Math.min(cursors[table] ?? 0, queue.length - 1);
				cursors[table] = (cursors[table] ?? 0) + 1;
				return queue[i];
			};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					eqs.push({ table, column, value });
					return chain;
				},
				order: () => chain,
				maybeSingle: () => Promise.resolve(next()),
				// Reads awaited without maybeSingle (load's list reads).
				then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
					Promise.resolve(next()).then(resolve, reject),
				insert: (rows: unknown) => {
					inserts.push({ table, rows });
					return Promise.resolve(next());
				}
			};
			return chain;
		}
	};
	return { supabase, inserts, eqs, rpc };
}

function event(
	fields: Record<string, string | string[]>,
	queues: Record<string, Result[]> = {},
	rpcResult?: Result
) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
	}
	const fake = fakeSupabase(queues, rpcResult);
	const e = {
		request: new Request('https://app.test/admin/teachers', { method: 'POST', body }),
		locals: { supabase: fake.supabase }
	} as unknown as Parameters<typeof actions.create>[0];
	return { e, ...fake };
}

const ok = (data: unknown): Result => ({ data, error: null });
const base = { email: 'Dolma@Example.com', displayName: 'Dolma', classIds: ['c1', 'c2'] };
const duplicate = { data: { user: null }, error: { code: 'email_exists', message: 'exists' } };
const parentProfile = ok({ id: 'p1', role: 'parent' });

describe('create (B14b promotion, #68)', () => {
	beforeEach(() => {
		createUser.mockReset();
		createUser.mockResolvedValue(duplicate);
	});

	it('creates a new teacher with a temp password as before', async () => {
		createUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
		const { e, inserts, rpc } = event(base, { class_teachers: [ok(null)] });
		const result = await actions.create(e);
		expect(result).toMatchObject({ success: true, email: base.email });
		expect(result).toHaveProperty('tempPassword');
		expect(result).not.toHaveProperty('promoted');
		expect(inserts).toEqual([
			{
				table: 'class_teachers',
				rows: [
					{ class_id: 'c1', teacher_id: 't1' },
					{ class_id: 'c2', teacher_id: 't1' }
				]
			}
		]);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('asks first for an approved parent-only login: 409 promotable, nothing changes', async () => {
		const { e, inserts, rpc, eqs } = event(base, {
			profiles: [parentProfile],
			parents: [ok({ status: 'approved' })]
		});
		const result = await actions.create(e);
		expect(result).toMatchObject({
			status: 409,
			data: { promotable: true, email: base.email, displayName: 'Dolma', classIds: ['c1', 'c2'] }
		});
		expect(result).not.toHaveProperty('data.error');
		expect(rpc).not.toHaveBeenCalled();
		expect(inserts).toEqual([]);
		expect(eqs).toContainEqual({ table: 'profiles', column: 'email', value: 'dolma@example.com' });
	});

	it('promotes and assigns classes with promote=1, without a temp password', async () => {
		const { e, inserts, rpc } = event(
			{ ...base, promote: '1' },
			{
				profiles: [parentProfile],
				parents: [ok({ status: 'approved' })],
				class_teachers: [ok(null)]
			},
			ok('p1')
		);
		const result = await actions.create(e);
		expect(result).toEqual({
			success: true,
			promoted: true,
			email: base.email,
			displayName: 'Dolma',
			classIds: ['c1', 'c2']
		});
		expect(rpc).toHaveBeenCalledWith('promote_parent_to_teacher', { p_user_id: 'p1' });
		expect(inserts).toEqual([
			{
				table: 'class_teachers',
				rows: [
					{ class_id: 'c1', teacher_id: 'p1' },
					{ class_id: 'c2', teacher_id: 'p1' }
				]
			}
		]);
	});

	it.each([undefined, '1'])(
		'refuses a pending parent sign-up (promote=%s) without changes',
		async (promote) => {
			const { e, rpc, inserts } = event(promote ? { ...base, promote } : base, {
				profiles: [parentProfile],
				parents: [ok({ status: 'pending' })]
			});
			expect(await actions.create(e)).toMatchObject({
				status: 400,
				data: { error: m.teachers_error_parent_pending() }
			});
			expect(rpc).not.toHaveBeenCalled();
			expect(inserts).toEqual([]);
		}
	);

	it.each(['teacher', 'admin', 'student'])(
		'keeps the duplicate error for a %s login, even with promote=1',
		async (role) => {
			const { e, rpc } = event({ ...base, promote: '1' }, { profiles: [ok({ id: 'x1', role })] });
			expect(await actions.create(e)).toMatchObject({
				status: 400,
				data: { error: m.teachers_error_duplicate() }
			});
			expect(rpc).not.toHaveBeenCalled();
		}
	);

	it('keeps the duplicate error when no profile is readable or the parent row is missing', async () => {
		const unreadable = event({ ...base, promote: '1' }, { profiles: [ok(null)] });
		expect(await actions.create(unreadable.e)).toMatchObject({
			status: 400,
			data: { error: m.teachers_error_duplicate() }
		});
		const noRow = event(
			{ ...base, promote: '1' },
			{ profiles: [parentProfile], parents: [ok(null)] }
		);
		expect(await actions.create(noRow.e)).toMatchObject({
			data: { error: m.teachers_error_duplicate() }
		});
		expect(unreadable.rpc).not.toHaveBeenCalled();
		expect(noRow.rpc).not.toHaveBeenCalled();
	});

	it.each([
		['parent_not_approved', m.teachers_error_parent_pending()],
		['not_parent_only', m.teachers_error_duplicate()],
		[null, m.teachers_error_promote_failed({ message: 'boom' })]
	] as const)('maps an RPC refusal with hint %s', async (hint, message) => {
		const { e, inserts } = event(
			{ ...base, promote: '1' },
			{ profiles: [parentProfile], parents: [ok({ status: 'approved' })] },
			{ data: null, error: { code: hint ? '22023' : '42501', hint, message: 'boom' } }
		);
		expect(await actions.create(e)).toMatchObject({ status: 400, data: { error: message } });
		expect(inserts).toEqual([]);
	});

	it('reports a class assignment failure after the promotion', async () => {
		const { e, rpc } = event(
			{ ...base, promote: '1' },
			{
				profiles: [parentProfile],
				parents: [ok({ status: 'approved' })],
				class_teachers: [{ data: null, error: { message: 'rls says no' } }]
			},
			ok('p1')
		);
		const result = await actions.create(e);
		expect(rpc).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.teachers_error_assign_failed({ message: 'rls says no' }) }
		});
		expect(result).not.toHaveProperty('data.tempPassword');
	});

	it('keeps the create error for a non-duplicate Auth failure', async () => {
		createUser.mockResolvedValue({
			data: { user: null },
			error: { code: 'unexpected', message: 'Auth is down' }
		});
		const { e, rpc } = event(base);
		expect(await actions.create(e)).toMatchObject({
			status: 400,
			data: { error: 'Auth is down' }
		});
		expect(rpc).not.toHaveBeenCalled();
	});
});

describe('remove (B14b dual-role teacher, #68)', () => {
	const teacherRow = ok({ id: 't1', email: 'dolma@example.com', display_name: 'Dolma' });

	beforeEach(() => {
		deleteUser.mockReset();
		deleteUser.mockResolvedValue({ data: {}, error: null });
	});

	it('makes a teacher with an approved parents row parent-only, never deleting the login', async () => {
		const { e, rpc } = event(
			{ teacherId: 't1' },
			{ profiles: [teacherRow], parents: [ok({ status: 'approved' })] },
			ok('t1')
		);
		const result = await actions.remove(e as unknown as Parameters<typeof actions.remove>[0]);
		expect(result).toEqual({ removed: 'Dolma', keptParent: true });
		expect(rpc).toHaveBeenCalledWith('demote_teacher_to_parent', { p_user_id: 't1' });
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('reports a demote failure without deleting', async () => {
		const { e } = event(
			{ teacherId: 't1' },
			{ profiles: [teacherRow], parents: [ok({ status: 'approved' })] },
			{ data: null, error: { code: '22023', hint: 'not_teacher', message: 'no' } }
		);
		expect(
			await actions.remove(e as unknown as Parameters<typeof actions.remove>[0])
		).toMatchObject({ status: 400, data: { error: m.teachers_error_remove_failed() } });
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('refuses to delete when the parents read fails', async () => {
		const { e, rpc } = event(
			{ teacherId: 't1' },
			{ profiles: [teacherRow], parents: [{ data: null, error: { message: 'down' } }] }
		);
		expect(
			await actions.remove(e as unknown as Parameters<typeof actions.remove>[0])
		).toMatchObject({ status: 400, data: { error: m.teachers_error_remove_failed() } });
		expect(rpc).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it.each([null, { status: 'pending' }])(
		'still deletes a plain teacher (parents row %j)',
		async (row) => {
			const { e, rpc } = event({ teacherId: 't1' }, { profiles: [teacherRow], parents: [ok(row)] });
			const result = await actions.remove(e as unknown as Parameters<typeof actions.remove>[0]);
			expect(result).toEqual({ removed: 'Dolma' });
			expect(deleteUser).toHaveBeenCalledWith('t1');
			expect(rpc).not.toHaveBeenCalled();
		}
	);
});

describe('load (B14b alsoParent, #68)', () => {
	const teachers = ok([
		{ id: 't1', email: 'a@example.com', display_name: 'A', created_at: '2026-01-01' },
		{ id: 't2', email: 'b@example.com', display_name: 'B', created_at: '2026-01-02' }
	]);

	function loadEvent(parents: Result) {
		const fake = fakeSupabase({
			classes: [ok([])],
			profiles: [teachers],
			class_teachers: [ok([])],
			parents: [parents]
		});
		const e = { locals: { supabase: fake.supabase } } as unknown as Parameters<typeof load>[0];
		return { e, ...fake };
	}

	it('marks only teachers with an approved parents row', async () => {
		const { e, eqs } = loadEvent(ok([{ id: 't1' }]));
		const result = (await load(e)) as {
			teachers: { id: string; alsoParent: boolean }[];
			loadError: boolean;
		};
		expect(result.teachers.map((t) => [t.id, t.alsoParent])).toEqual([
			['t1', true],
			['t2', false]
		]);
		expect(result.loadError).toBe(false);
		expect(eqs).toContainEqual({ table: 'parents', column: 'status', value: 'approved' });
	});

	it('reports loadError when the parents read fails', async () => {
		const { e } = loadEvent({ data: null, error: { message: 'down' } });
		const result = (await load(e)) as {
			teachers: { alsoParent: boolean }[];
			loadError: boolean;
		};
		expect(result.loadError).toBe(true);
		expect(result.teachers.every((t) => !t.alsoParent)).toBe(true);
	});
});
