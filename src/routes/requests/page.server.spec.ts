import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteUser = vi.fn();
const updateUserById = vi.fn();
const resend = vi.fn();
const getCapabilities = vi.fn();
const updateAuthUserEmailAndPassword = vi.fn();
vi.mock('$lib/supabase/admin', () => {
	// The approve action's username scan: no student logins exist yet.
	const scan = { select: () => scan, ilike: () => Promise.resolve({ data: [], error: null }) };
	return {
		createSupabaseAdminClient: () => ({
			auth: { admin: { deleteUser, updateUserById } },
			from: () => scan
		}),
		updateAuthUserEmailAndPassword: (...args: unknown[]) => updateAuthUserEmailAndPassword(...args)
	};
});
vi.mock('$lib/server/capabilities', () => ({
	getCapabilities: (...args: unknown[]) => getCapabilities(...args)
}));

const { actions, load } = await import('./+page.server');
const { loadSickLeave } = await import('$lib/server/leave');
const m = await import('$lib/paraglide/messages.js');

/**
 * Story 7-1 parent actions. `locals.supabase` answers each table's calls
 * from a queue, in call order, and records every update.
 */
type Result = { data: unknown; error: unknown };

function fakeSupabase(queues: Record<string, Result[]>) {
	const updates: { table: string; values: unknown }[] = [];
	const cursors: Record<string, number> = {};
	const supabase = {
		auth: { resend },
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

function event(queues: Record<string, Result[]>, fields: Record<string, string> = {}) {
	const body = new FormData();
	body.set('parentId', 'p1');
	body.set('parentName', 'Dolma');
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const { supabase, updates } = fakeSupabase(queues);
	const e = {
		request: new Request('https://app.test/requests', { method: 'POST', body }),
		url: new URL('https://app.test/requests'),
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 'admin1' } })
		}
	} as unknown as Parameters<typeof actions.resendParentConfirmation>[0];
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

	it('B14a: rejects a teacher parent-access request without deleting the login', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'pending' }), ok({ id: 'p1' })],
			profiles: [ok({ role: 'teacher' })]
		});
		expect(await actions.rejectParent(e)).toMatchObject({
			success: true,
			action: 'parentStaffRejected'
		});
		expect(updates).toEqual([{ table: 'parents', values: { status: 'rejected' } }]);
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('B14a: never deletes an admin login, and an already rejected staff row is a no-op', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'rejected' })],
			profiles: [ok({ role: 'admin' })]
		});
		expect(await actions.rejectParent(e)).toMatchObject({
			success: true,
			action: 'parentStaffRejected'
		});
		expect(updates).toEqual([]);
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('B14a: a failed staff reject update deletes nothing', async () => {
		const { e } = event({
			parents: [ok({ id: 'p1', status: 'pending' }), { data: null, error: { message: 'x' } }],
			profiles: [ok({ role: 'teacher' })]
		});
		expect(await actions.rejectParent(e)).toMatchObject({ status: 400 });
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('deletes nothing when the login role read errors', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'pending' })],
			profiles: [{ data: null, error: { message: 'boom' } }]
		});
		expect(await actions.rejectParent(e)).toMatchObject({ status: 400 });
		expect(deleteUser).not.toHaveBeenCalled();
		expect(updates).toEqual([]);
	});

	it('deletes nothing when the login role cannot be read', async () => {
		const { e, updates } = event({
			parents: [ok({ id: 'p1', status: 'pending' })],
			profiles: [ok(null)]
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

const parentRow = (emailConfirmedAt: string | null) =>
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

describe('approveParent', () => {
	beforeEach(() => {
		getCapabilities.mockReset();
		getCapabilities.mockResolvedValue({ role: 'admin', parentStatus: null });
		updateUserById.mockReset();
		updateUserById.mockResolvedValue({ data: {}, error: null });
	});

	const row = parentRow;

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
		expect(updateUserById).not.toHaveBeenCalled();
	});

	it('#90: approves an unconfirmed parent when asked to, confirming the email first', async () => {
		const { e, updates } = event(
			{ parents: [row(null), ok({ id: 'p1' })] },
			{ withoutConfirmation: '1' }
		);
		expect(await actions.approveParent(e)).toMatchObject({
			success: true,
			action: 'parentApproved'
		});
		expect(updateUserById).toHaveBeenCalledWith('p1', { email_confirm: true });
		expect(updates).toEqual([{ table: 'parents', values: { status: 'approved' } }]);
	});

	it('#90: does not approve when confirming the email fails', async () => {
		updateUserById.mockResolvedValue({ data: null, error: { message: 'boom' } });
		const { e, updates } = event({ parents: [row(null)] }, { withoutConfirmation: '1' });
		expect(await actions.approveParent(e)).toMatchObject({ status: 400 });
		expect(updates).toEqual([]);
	});

	it('#90: a non-admin cannot confirm an email through the flag', async () => {
		getCapabilities.mockResolvedValue({ role: 'teacher', parentStatus: null });
		const { e } = event({ parents: [row(null)] }, { withoutConfirmation: '1' });
		expect(await actions.approveParent(e)).toMatchObject({ status: 403 });
		expect(updateUserById).not.toHaveBeenCalled();
	});

	it('#90: leaves a confirmed email alone', async () => {
		const { e } = event(
			{ parents: [row('2026-01-02T00:00:00Z'), ok({ id: 'p1' })] },
			{ withoutConfirmation: '1' }
		);
		expect(await actions.approveParent(e)).toMatchObject({ success: true });
		expect(updateUserById).not.toHaveBeenCalled();
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

describe('resendParentConfirmation (#90)', () => {
	beforeEach(() => {
		getCapabilities.mockReset();
		getCapabilities.mockResolvedValue({ role: 'admin', parentStatus: null });
		resend.mockReset();
		resend.mockResolvedValue({ data: {}, error: null });
	});

	it('refuses a non-admin with 403', async () => {
		getCapabilities.mockResolvedValue({ role: 'teacher', parentStatus: null });
		const { e } = event({ parents: [parentRow(null)] });
		expect(await actions.resendParentConfirmation(e)).toMatchObject({ status: 403 });
		expect(resend).not.toHaveBeenCalled();
	});

	it('refuses a request that is no longer pending', async () => {
		const { e } = event({ parents: [ok(null)] });
		expect(await actions.resendParentConfirmation(e)).toMatchObject({ status: 400 });
		expect(resend).not.toHaveBeenCalled();
	});

	it('sends nothing for a confirmed email', async () => {
		const { e } = event({ parents: [parentRow('2026-01-02T00:00:00Z')] });
		expect(await actions.resendParentConfirmation(e)).toMatchObject({
			status: 400,
			data: { error: m.requests_parent_error_resend_confirmed() }
		});
		expect(resend).not.toHaveBeenCalled();
	});

	it("sends the sign-up mail to the parent's stored email", async () => {
		const { e } = event({ parents: [parentRow(null)] });
		expect(await actions.resendParentConfirmation(e)).toMatchObject({
			success: true,
			action: 'parentConfirmationResent',
			parentName: 'Dolma'
		});
		expect(resend).toHaveBeenCalledWith({
			type: 'signup',
			email: 'd@example.com',
			options: { emailRedirectTo: 'https://app.test/auth/confirm?flow=signup' }
		});
	});

	it('reports a failed send', async () => {
		resend.mockResolvedValue({ data: null, error: { message: 'rate limit' } });
		const { e } = event({ parents: [parentRow(null)] });
		expect(await actions.resendParentConfirmation(e)).toMatchObject({
			status: 400,
			data: { error: m.requests_parent_error_resend_failed() }
		});
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

/**
 * Story 7-5: the Sick leave decision action and the queue split. The
 * database stamps the actor and refuses everything else; the action only
 * validates the form and maps the refusal.
 */
describe('decideSick', () => {
	const SESSION = '66666666-7777-4888-8999-000000000000';
	const STUDENT = '11111111-2222-4333-8444-555555555555';

	function sickEvent(fields: Record<string, string>, result: Result, user = true) {
		const inserted: unknown[] = [];
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const chain = {
			insert: (row: unknown) => {
				inserted.push(row);
				return chain;
			},
			select: () => chain,
			single: () => Promise.resolve(result)
		};
		const e = {
			request: new Request('https://app.test/requests', { method: 'POST', body }),
			locals: {
				supabase: { from: () => chain },
				safeGetSession: async () => ({ user: user ? { id: 't1' } : null })
			}
		} as unknown as Parameters<typeof actions.decideSick>[0];
		return { e, inserted };
	}

	const fields = (decision: string) => ({
		sessionId: SESSION,
		studentId: STUDENT,
		studentName: 'Dawa',
		decision
	});

	it.each(['approved', 'rejected'] as const)(
		'inserts only session, student and decision (%s)',
		async (decision) => {
			const { e, inserted } = sickEvent(fields(decision), ok({ id: 1 }));
			expect(await actions.decideSick(e)).toEqual({
				success: true,
				action: decision === 'approved' ? 'sickApproved' : 'sickRejected',
				sessionId: SESSION,
				studentId: STUDENT,
				sickStudentName: 'Dawa'
			});
			expect(inserted).toEqual([{ class_session_id: SESSION, student_id: STUDENT, decision }]);
		}
	);

	it('refuses a bad decision or ids without writing', async () => {
		for (const f of [
			fields('maybe'),
			{ ...fields('approved'), sessionId: 'x' },
			{ ...fields('approved'), studentId: '' }
		]) {
			const { e, inserted } = sickEvent(f, ok({ id: 1 }));
			expect(await actions.decideSick(e)).toMatchObject({ status: 400 });
			expect(inserted).toEqual([]);
		}
	});

	it('refuses a signed-out caller', async () => {
		const { e, inserted } = sickEvent(fields('approved'), ok({ id: 1 }), false);
		expect(await actions.decideSick(e)).toMatchObject({ status: 401 });
		expect(inserted).toEqual([]);
	});

	it.each([
		[{ code: '42501' }, 403, m.requests_sick_error_not_allowed()],
		[{ code: '23505' }, 400, m.requests_sick_error_decided()],
		[{ code: '22023', hint: 'leave_not_sick' }, 400, m.requests_sick_error_not_sick()],
		[{ code: '08006' }, 400, m.requests_sick_error_failed()]
	])('maps %o to its message', async (err, status, message) => {
		const { e } = sickEvent(fields('approved'), { data: null, error: err });
		expect(await actions.decideSick(e)).toMatchObject({
			status,
			data: { error: message, sessionId: SESSION, studentId: STUDENT }
		});
	});
});

describe('loadSickLeave', () => {
	const row = (id: string, decision: 'approved' | 'rejected' | null, decidedAt: string | null) => ({
		class_session_id: `s-${id}`,
		student_id: `k-${id}`,
		student_name: `Kid ${id}`,
		class_id: 'c1',
		class_name: 'Alphabet',
		day: '2026-09-27',
		start_time: id === 'a' ? '10:00:00' : null,
		answered_at: '2026-09-27T08:00:00Z',
		decision,
		decided_at: decidedAt,
		decided_by_system: id === 'c',
		own_child: id === 'b'
	});

	it('splits pending from decided (newest decision first)', async () => {
		const rpc = vi.fn(async () => ({
			data: [
				row('a', null, null),
				row('b', null, null),
				row('c', 'approved', '2026-09-01T00:00:00Z'),
				row('d', 'rejected', '2026-09-20T00:00:00Z')
			],
			error: null
		}));
		const result = await loadSickLeave({ rpc } as unknown as Parameters<typeof loadSickLeave>[0]);
		expect(rpc).toHaveBeenCalledWith('sick_leave_queue');
		expect(result.sickError).toBe(false);
		expect(result.sickPending.map((r) => [r.studentId, r.startTime, r.ownChild])).toEqual([
			['k-a', '10:00', false],
			['k-b', null, true]
		]);
		expect(result.sickDecided.map((r) => [r.studentId, r.decision, r.decidedBySystem])).toEqual([
			['k-d', 'rejected', false],
			['k-c', 'approved', true]
		]);
	});

	it('flags an error', async () => {
		const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
		const result = await loadSickLeave({ rpc } as unknown as Parameters<typeof loadSickLeave>[0]);
		expect(result).toEqual({ sickPending: [], sickDecided: [], sickError: true });
	});
});

describe('approveDeletion / rejectDeletion (Story 7-6)', () => {
	const REQUEST = '11111111-2222-4333-8444-555555555555';

	beforeEach(() => {
		getCapabilities.mockReset();
		getCapabilities.mockResolvedValue({ role: 'admin', parentStatus: null });
	});

	function deletionEvent(queues: Record<string, Result[]>, requestId = REQUEST) {
		const body = new FormData();
		body.set('requestId', requestId);
		body.set('studentName', 'Dawa');
		const { supabase, updates } = fakeSupabase(queues);
		const e = {
			request: new Request('https://app.test/requests', { method: 'POST', body }),
			locals: {
				supabase,
				safeGetSession: async () => ({ session: {}, user: { id: 'admin1' } })
			}
		} as unknown as Parameters<typeof actions.approveDeletion>[0];
		return { e, updates };
	}

	it('refuses a non-admin with 403 and updates nothing', async () => {
		getCapabilities.mockResolvedValue({ role: 'teacher', parentStatus: null });
		for (const action of [actions.approveDeletion, actions.rejectDeletion]) {
			const { e, updates } = deletionEvent({});
			expect(await action(e)).toMatchObject({
				status: 403,
				data: { error: m.requests_deletion_error_not_allowed() }
			});
			expect(updates).toEqual([]);
		}
	});

	it('refuses a malformed id', async () => {
		const { e, updates } = deletionEvent({}, 'nope');
		expect(await actions.approveDeletion(e)).toMatchObject({ status: 400 });
		expect(updates).toEqual([]);
	});

	it('approve sets only the status (the database stamps the reviewer and erases)', async () => {
		const { e, updates } = deletionEvent({ deletion_requests: [ok({ id: REQUEST })] });
		expect(await actions.approveDeletion(e)).toEqual({
			success: true,
			action: 'deletionApproved',
			requestId: REQUEST,
			deletionStudentName: 'Dawa'
		});
		expect(updates).toEqual([{ table: 'deletion_requests', values: { status: 'approved' } }]);
	});

	it('reject sets status rejected', async () => {
		const { e, updates } = deletionEvent({ deletion_requests: [ok({ id: REQUEST })] });
		expect(await actions.rejectDeletion(e)).toMatchObject({
			success: true,
			action: 'deletionRejected'
		});
		expect(updates).toEqual([{ table: 'deletion_requests', values: { status: 'rejected' } }]);
	});

	it('no pending row -> not found; 42501 (own child) -> 403; other errors -> failed', async () => {
		const notFound = deletionEvent({ deletion_requests: [ok(null)] });
		expect(await actions.approveDeletion(notFound.e)).toMatchObject({
			status: 400,
			data: { error: m.requests_error_not_found() }
		});
		const own = deletionEvent({ deletion_requests: [{ data: null, error: { code: '42501' } }] });
		expect(await actions.approveDeletion(own.e)).toMatchObject({
			status: 403,
			data: { error: m.requests_deletion_error_not_allowed() }
		});
		const other = deletionEvent({ deletion_requests: [{ data: null, error: { code: '08006' } }] });
		expect(await actions.rejectDeletion(other.e)).toMatchObject({
			status: 400,
			data: { error: m.requests_deletion_error_failed() }
		});
	});
});

describe('load: deletion requests section (Story 7-6)', () => {
	/**
	 * deletions[0] answers the pending query, deletions[1] (or [0]) the decided
	 * one -- chosen by the status filter the query applied, never by call
	 * order. A deletion_requests query with neither filter gets an error.
	 */
	function loadWith(role: 'admin' | 'teacher', deletions: Result[]) {
		const queried: string[] = [];
		const calls: { table: string; query: number; method: string; args: unknown[] }[] = [];
		let queryCount = 0;
		const from = (table: string) => {
			queried.push(table);
			const query = queryCount++;
			const own: unknown[][] = [];
			const chain: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'in', 'order']) {
				chain[method] = (...args: unknown[]) => {
					calls.push({ table, query, method, args });
					own.push([method, ...args]);
					return chain;
				};
			}
			const has = (expected: unknown[]) =>
				own.some((c) => JSON.stringify(c) === JSON.stringify(expected));
			const result = (): Result => {
				if (table !== 'deletion_requests') return { data: [], error: null };
				if (has(['eq', 'status', 'pending'])) return deletions[0];
				if (has(['in', 'status', ['approved', 'rejected']])) return deletions[1] ?? deletions[0];
				return { data: null, error: { message: 'unfiltered deletion query' } };
			};
			chain.single = async () => ({ data: { role }, error: null });
			chain.then = (resolve: (value: Result) => unknown) => resolve(result());
			return chain;
		};
		const supabase = { from, rpc: async () => ({ data: [], error: null }) };
		const run = load({
			locals: {
				supabase,
				safeGetSession: async () => ({
					session: { user: { id: 'admin1' } },
					user: { id: 'admin1' }
				})
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>;
		return { run, queried, calls };
	}

	const row = (overrides: Record<string, unknown>) => ({
		id: 'r1',
		student_id: 'k1',
		requested_by: 'p1',
		status: 'pending',
		requested_at: '2026-09-27T08:00:00Z',
		reviewed_at: null,
		student: { display_name: null, registration_name: 'Dawa' },
		requester: { display_name: 'Dolma', email: 'dolma@example.test' },
		...overrides
	});

	it('maps pending rows (own child flagged) and de-identified decided rows', async () => {
		const { run } = loadWith('admin', [
			ok([row({}), row({ id: 'r2', requested_by: 'admin1' })]),
			ok([
				row({
					id: 'r3',
					student_id: null,
					student: null,
					status: 'approved',
					reviewed_at: '2026-09-27T09:00:00Z'
				})
			])
		]);
		const result = await run;
		expect(result.deletionPending).toEqual([
			{
				id: 'r1',
				status: 'pending',
				studentName: 'Dawa',
				requesterName: 'Dolma',
				requestedAt: '2026-09-27T08:00:00Z',
				reviewedAt: null,
				ownChild: false
			},
			expect.objectContaining({ id: 'r2', ownChild: true })
		]);
		expect(result.deletionDecided).toEqual([
			expect.objectContaining({ id: 'r3', status: 'approved', studentName: null })
		]);
		expect(result.loadError).toBe(false);
	});

	it('filters the pending query by pending and the decided query by approved / rejected', async () => {
		const { run, calls } = loadWith('admin', [ok([]), ok([])]);
		await run;
		const deletionQueries = new Map<number, unknown[][]>();
		for (const c of calls.filter((c) => c.table === 'deletion_requests')) {
			deletionQueries.set(c.query, [
				...(deletionQueries.get(c.query) ?? []),
				[c.method, ...c.args]
			]);
		}
		const [pendingQuery, decidedQuery] = [...deletionQueries.values()];
		expect(pendingQuery).toEqual(
			expect.arrayContaining([
				['eq', 'status', 'pending'],
				['order', 'requested_at', { ascending: true }]
			])
		);
		expect(pendingQuery).not.toContainEqual(['in', 'status', ['approved', 'rejected']]);
		expect(decidedQuery).toEqual(
			expect.arrayContaining([
				['in', 'status', ['approved', 'rejected']],
				['order', 'reviewed_at', { ascending: false }]
			])
		);
		expect(decidedQuery).not.toContainEqual(['eq', 'status', 'pending']);
	});

	it('a teacher never queries the deletion queue', async () => {
		const { run, queried } = loadWith('teacher', [ok([row({})])]);
		const result = await run;
		expect(queried).not.toContain('deletion_requests');
		expect(result).toMatchObject({ deletionPending: [], deletionDecided: [] });
	});

	it('flags a load error when the queue cannot be read', async () => {
		const { run } = loadWith('admin', [{ data: null, error: { message: 'boom' } }]);
		expect((await run).loadError).toBe(true);
	});
});

describe('approveJoin / rejectJoin (B12b, #67)', () => {
	const REQUEST = '11111111-2222-4333-8444-555555555555';

	function joinEvent(fields: Record<string, string>, result: { error: unknown }, user = true) {
		const calls: { fn: string; args: unknown }[] = [];
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const e = {
			request: new Request('https://app.test/requests', { method: 'POST', body }),
			locals: {
				supabase: {
					rpc: async (fn: string, args: unknown) => {
						calls.push({ fn, args });
						return { data: null, ...result };
					}
				},
				safeGetSession: async () => ({ user: user ? { id: 't1' } : null })
			}
		} as unknown as Parameters<typeof actions.approveJoin>[0];
		return { e, calls };
	}

	const fields = { requestId: REQUEST };

	it.each([
		['approveJoin', 'approved', 'joinApproved'],
		['rejectJoin', 'rejected', 'joinRejected']
	] as const)('%s calls decide_class_join with %s', async (action, decision, outcome) => {
		const { e, calls } = joinEvent(fields, { error: null });
		expect(await actions[action](e)).toEqual({
			success: true,
			action: outcome,
			requestId: REQUEST
		});
		expect(calls).toEqual([
			{ fn: 'decide_class_join', args: { p_request_id: REQUEST, p_decision: decision } }
		]);
	});

	it('refuses a malformed id or a signed-out caller without calling the database', async () => {
		const bad = joinEvent({ requestId: 'x' }, { error: null });
		expect(await actions.approveJoin(bad.e)).toMatchObject({
			status: 400,
			data: { error: m.requests_error_not_found(), requestId: 'x' }
		});
		expect(bad.calls).toEqual([]);

		const out = joinEvent(fields, { error: null }, false);
		expect(await actions.rejectJoin(out.e)).toMatchObject({
			status: 401,
			data: { error: m.requests_error_not_signed_in(), requestId: REQUEST }
		});
		expect(out.calls).toEqual([]);
	});

	it.each([
		[{ code: '42501' }, 403, m.class_join_error_not_allowed(), false],
		[{ code: '22023', hint: 'join_not_pending' }, 400, m.class_join_error_not_pending(), true],
		[
			{ code: '22023', hint: 'join_decision_invalid' },
			400,
			m.class_join_error_decision_invalid(),
			false
		],
		[
			{ code: '22023', hint: 'join_student_not_approved' },
			400,
			m.class_join_error_student_not_approved(),
			false
		],
		[{ code: '08006' }, 400, m.class_join_error_failed(), false]
	])('maps %o to its message', async (err, status, message, joinStale) => {
		const { e } = joinEvent(fields, { error: err });
		expect(await actions.approveJoin(e)).toMatchObject({
			status,
			data: { error: message, requestId: REQUEST, joinStale }
		});
	});
});

describe('load: class join requests section (B12b, #67)', () => {
	function loadWithJoin(join: { data: unknown; error: unknown }) {
		const rpcCalls: string[] = [];
		const from = () => {
			const chain: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'in', 'order']) chain[method] = () => chain;
			chain.single = async () => ({ data: { role: 'teacher' }, error: null });
			chain.then = (resolve: (value: Result) => unknown) => resolve({ data: [], error: null });
			return chain;
		};
		const supabase = {
			from,
			rpc: async (fn: string) => {
				rpcCalls.push(fn);
				return fn === 'list_class_join_requests' ? join : { data: [], error: null };
			}
		};
		const run = load({
			locals: {
				supabase,
				safeGetSession: async () => ({ session: { user: { id: 't1' } }, user: { id: 't1' } })
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>;
		return { run, rpcCalls };
	}

	it('maps the queue, own child flagged', async () => {
		const { run, rpcCalls } = loadWithJoin(
			ok([
				{
					request_id: 'r1',
					student_id: 'k1',
					student_name: 'Dawa',
					current_classes: 'Alphabet, Reading',
					class_id: 'c2',
					class_name: 'Grammar',
					requested_at: '2026-09-29T08:00:00Z',
					own_child: false
				},
				{
					request_id: 'r2',
					student_id: 'k2',
					student_name: null,
					current_classes: '',
					class_id: 'c2',
					class_name: 'Grammar',
					requested_at: '2026-09-29T09:00:00Z',
					own_child: true
				}
			])
		);
		const result = await run;
		expect(rpcCalls).toContain('list_class_join_requests');
		expect(result.joinPending).toEqual([
			{
				id: 'r1',
				studentId: 'k1',
				studentName: 'Dawa',
				currentClasses: 'Alphabet, Reading',
				classId: 'c2',
				className: 'Grammar',
				requestedAt: '2026-09-29T08:00:00Z',
				ownChild: false
			},
			expect.objectContaining({
				id: 'r2',
				studentName: m.requests_join_unnamed_student(),
				currentClasses: '',
				ownChild: true
			})
		]);
		expect(result).toMatchObject({ joinLoadError: false, loadError: false });
	});

	it('a failed queue affects only its section, not the page', async () => {
		const { run } = loadWithJoin({ data: null, error: { message: 'boom' } });
		expect(await run).toMatchObject({ joinPending: [], joinLoadError: true, loadError: false });
	});
});

describe('load: parent queue marks staff requests (B14a, #68)', () => {
	function loadWithParents(pending: unknown[]) {
		const from = (table: string) => {
			const own: unknown[][] = [];
			const chain: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'in', 'order', 'neq']) {
				chain[method] = (...args: unknown[]) => {
					own.push([method, ...args]);
					return chain;
				};
			}
			const pendingQuery = () =>
				own.some((c) => JSON.stringify(c) === JSON.stringify(['eq', 'status', 'pending']));
			chain.single = async () => ({ data: { role: 'admin' }, error: null });
			chain.then = (resolve: (value: Result) => unknown) =>
				resolve(
					table === 'parents' && pendingQuery()
						? { data: pending, error: null }
						: { data: [], error: null }
				);
			return chain;
		};
		const supabase = { from, rpc: async () => ({ data: [], error: null }) };
		return load({
			locals: {
				supabase,
				safeGetSession: async () => ({
					session: { user: { id: 'admin1' } },
					user: { id: 'admin1' }
				})
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>;
	}

	const parentRow = (id: string, role: string) => ({
		id,
		status: 'pending',
		created_at: '2026-09-29T08:00:00Z',
		reviewed_at: null,
		profiles: { display_name: id, email: `${id}@example.test`, email_confirmed_at: 'x', role }
	});

	it('flags teacher and admin requests and the admin own row', async () => {
		const data = await loadWithParents([
			parentRow('p1', 'parent'),
			parentRow('t1', 'teacher'),
			parentRow('admin1', 'admin')
		]);
		const rows = data.parentsPending as { id: string; staffRole: unknown; ownRequest: boolean }[];
		expect(rows.map((r) => [r.id, r.staffRole, r.ownRequest])).toEqual([
			['p1', null, false],
			['t1', 'teacher', false],
			['admin1', 'admin', true]
		]);
	});
});
