import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteUser = vi.fn();
const getCapabilities = vi.fn();
const updateAuthUserEmailAndPassword = vi.fn();
vi.mock('$lib/supabase/admin', () => {
	// The approve action's username scan: no student logins exist yet.
	const scan = { select: () => scan, ilike: () => Promise.resolve({ data: [], error: null }) };
	return {
		createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser } }, from: () => scan }),
		updateAuthUserEmailAndPassword: (...args: unknown[]) => updateAuthUserEmailAndPassword(...args)
	};
});
vi.mock('$lib/server/capabilities', () => ({
	getCapabilities: (...args: unknown[]) => getCapabilities(...args)
}));

const { actions } = await import('./+page.server');

/**
 * Story 7-1 parent actions. `locals.supabase` answers each table's calls
 * from a queue, in call order, and records every update.
 */
type Result = { data: unknown; error: unknown };

function fakeSupabase(queues: Record<string, Result[]>) {
	const updates: { table: string; values: unknown }[] = [];
	const cursors: Record<string, number> = {};
	const supabase = {
		from: (table: string) => {
			const next = () => {
				const queue = queues[table] ?? [{ data: null, error: null }];
				const i = Math.min(cursors[table] ?? 0, queue.length - 1);
				cursors[table] = (cursors[table] ?? 0) + 1;
				return queue[i];
			};
			const chain = {
				select: () => chain,
				eq: () => chain,
				in: () => chain,
				update: (values: unknown) => {
					updates.push({ table, values });
					return chain;
				},
				maybeSingle: () => Promise.resolve(next()),
				single: () => Promise.resolve(next())
			};
			return chain;
		}
	};
	return { supabase, updates };
}

function event(queues: Record<string, Result[]>) {
	const body = new FormData();
	body.set('parentId', 'p1');
	body.set('parentName', 'Dolma');
	const { supabase, updates } = fakeSupabase(queues);
	const e = {
		request: new Request('https://app.test/requests', { method: 'POST', body }),
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 'admin1' } })
		}
	} as unknown as Parameters<typeof actions.rejectParent>[0];
	return { e, updates };
}

const ok = (data: unknown): Result => ({ data, error: null });

describe('rejectParent', () => {
	beforeEach(() => {
		deleteUser.mockReset();
		deleteUser.mockResolvedValue({ error: null });
		getCapabilities.mockReset();
		getCapabilities.mockResolvedValue({ role: 'admin', parentStatus: null });
	});

	it('refuses a non-admin with 403 and deletes nothing', async () => {
		getCapabilities.mockResolvedValue({ role: 'teacher', parentStatus: null });
		const { e } = event({});
		expect(await actions.rejectParent(e)).toMatchObject({ status: 403 });
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('deletes nothing when the RLS read finds no row', async () => {
		const { e } = event({ parents: [ok(null)] });
		expect(await actions.rejectParent(e)).toMatchObject({ status: 400 });
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('deletes nothing when the login is not parent-only', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'pending' })],
			profiles: [ok({ role: 'teacher' })]
		});
		expect(await actions.rejectParent(e)).toMatchObject({ status: 400 });
		expect(deleteUser).not.toHaveBeenCalled();
		expect(updates).toEqual([]);
	});

	it('marks a pending parent rejected, then deletes the auth user once', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'pending' }), ok({ id: 'p1' })],
			profiles: [ok({ role: 'parent' })]
		});
		expect(await actions.rejectParent(e)).toMatchObject({
			success: true,
			action: 'parentRejected'
		});
		expect(updates).toEqual([{ table: 'parents', values: { status: 'rejected' } }]);
		expect(deleteUser).toHaveBeenCalledTimes(1);
		expect(deleteUser).toHaveBeenCalledWith('p1');
	});

	it('retries only the delete for an already rejected row', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'rejected' })],
			profiles: [ok({ role: 'parent' })]
		});
		expect(await actions.rejectParent(e)).toMatchObject({ success: true });
		expect(updates).toEqual([]);
		expect(deleteUser).toHaveBeenCalledTimes(1);
	});
});

describe('approveParent', () => {
	beforeEach(() => {
		getCapabilities.mockReset();
		getCapabilities.mockResolvedValue({ role: 'admin', parentStatus: null });
	});

	const row = (emailConfirmedAt: string | null) =>
		ok({
			id: 'p1',
			status: 'pending',
			created_at: '2026-01-01T00:00:00Z',
			reviewed_at: null,
			profiles: {
				display_name: 'Dolma',
				email: 'd@example.com',
				email_confirmed_at: emailConfirmedAt
			}
		});

	it('refuses a non-admin with 403', async () => {
		getCapabilities.mockResolvedValue({ role: 'teacher', parentStatus: null });
		const { e, updates } = event({});
		expect(await actions.approveParent(e)).toMatchObject({ status: 403 });
		expect(updates).toEqual([]);
	});

	it('refuses while the email is unconfirmed, without updating', async () => {
		const { e, updates } = event({ parents: [row(null)] });
		expect(await actions.approveParent(e)).toMatchObject({ status: 400 });
		expect(updates).toEqual([]);
	});

	it('approves a confirmed parent', async () => {
		const { e, updates } = event({ parents: [row('2026-01-02T00:00:00Z'), ok({ id: 'p1' })] });
		expect(await actions.approveParent(e)).toMatchObject({
			success: true,
			action: 'parentApproved'
		});
		expect(updates).toEqual([{ table: 'parents', values: { status: 'approved' } }]);
	});
});

describe('approve (student)', () => {
	beforeEach(() => {
		updateAuthUserEmailAndPassword.mockReset();
		updateAuthUserEmailAndPassword.mockResolvedValue({ error: null });
	});

	function approveEvent(queues: Record<string, Result[]>) {
		const body = new FormData();
		body.set('studentId', 's1');
		body.set('studentName', 'Tenzin');
		body.set('teamId', 't1');
		const { supabase, updates } = fakeSupabase(queues);
		const e = {
			request: new Request('https://app.test/requests', { method: 'POST', body }),
			locals: {
				supabase,
				safeGetSession: async () => ({ session: {}, user: { id: 'teacher1' } })
			}
		} as unknown as Parameters<typeof actions.approve>[0];
		return { e, updates };
	}

	it('approves a pending student without any guardian email confirmation (Story 7-2)', async () => {
		const { e, updates } = approveEvent({
			profiles: [ok({ id: 's1', registration_name: 'Tenzin Dolma' }), ok({ id: 's1' })]
		});
		const result = await actions.approve(e);
		expect(result).toMatchObject({
			success: true,
			action: 'approved',
			studentId: 's1',
			username: 'tenzindolma'
		});
		expect(updateAuthUserEmailAndPassword).toHaveBeenCalledTimes(1);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			table: 'profiles',
			values: { status: 'approved', team_id: 't1' }
		});
	});

	it('refuses when the RLS read finds no pending student, minting nothing', async () => {
		const { e, updates } = approveEvent({ profiles: [ok(null)] });
		expect(await actions.approve(e)).toMatchObject({ status: 400 });
		expect(updateAuthUserEmailAndPassword).not.toHaveBeenCalled();
		expect(updates).toEqual([]);
	});
});
