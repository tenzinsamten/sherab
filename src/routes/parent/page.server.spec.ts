import { describe, expect, it, vi } from 'vitest';
import { load as layoutLoad } from './+layout.server';
import { actions, load as pageLoad } from './+page.server';

function fakeSupabase(role: string, parentStatus: string | null) {
	return {
		from: (table: string) => {
			const result =
				table === 'profiles'
					? { data: { role }, error: null }
					: { data: parentStatus ? { status: parentStatus } : null, error: null };
			const chain = {
				select: () => chain,
				eq: () => chain,
				maybeSingle: () => Promise.resolve(result)
			};
			return chain;
		}
	};
}

const session = { user: { id: 'p1', email: 'p@example.com' } };

function runLayout(role: string, parentStatus: string | null, withSession = true) {
	return layoutLoad({
		parent: async () => ({ session: withSession ? session : null }),
		locals: { supabase: fakeSupabase(role, parentStatus) }
	} as unknown as Parameters<typeof layoutLoad>[0]);
}

type RpcResult = { data: unknown; error: { message: string } | null };
type TableResult = { data: unknown; error: { message: string } | null };

/** A PostgREST-like chain over one table result, honouring `.eq()` and `.in()`. */
function tableChain(result: TableResult) {
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
		then: (resolve: (value: TableResult) => unknown) => {
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

function runPage(
	parentStatus: string,
	emailConfirmedAt: string | null,
	rpcResult: RpcResult = { data: [], error: null },
	opts: {
		tables?: Record<string, TableResult>;
		counts?: Record<string, RpcResult>;
		/** spec-second-parent story 3: list_my_parent_invites(). */
		invites?: RpcResult;
	} = {}
) {
	const rpc = vi.fn(async (name: string, args?: { p_student_id?: string }) =>
		name === 'homework_counts'
			? (opts.counts?.[args?.p_student_id ?? ''] ?? { data: [], error: null })
			: name === 'list_my_parent_invites'
				? (opts.invites ?? { data: [], error: null })
				: rpcResult
	);
	const from = vi.fn((table: string) =>
		tableChain(opts.tables?.[table] ?? { data: [], error: null })
	);
	const result = Promise.resolve(
		pageLoad({
			parent: async () => ({
				session,
				parentStatus,
				profile: { email: 'p@example.com', email_confirmed_at: emailConfirmedAt }
			}),
			locals: { supabase: { rpc, from } }
		} as unknown as Parameters<typeof pageLoad>[0])
	);
	return Object.assign(result, { rpc, from });
}

describe('parent layout guard', () => {
	it('refuses a login without a parents row, even with profiles.role parent', async () => {
		await expect(runLayout('parent', null)).rejects.toMatchObject({ status: 403 });
		await expect(runLayout('teacher', null)).rejects.toMatchObject({ status: 403 });
	});

	it('sends a signed-out visitor to login', async () => {
		await expect(runLayout('parent', 'pending', false)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});

	it('passes the parent status through', async () => {
		expect(await runLayout('parent', 'pending')).toEqual({ parentStatus: 'pending' });
	});
});

describe('parent page state', () => {
	it.each([
		['pending', null, 'unconfirmed'],
		['approved', null, 'unconfirmed'],
		['pending', '2026-01-01T00:00:00Z', 'pending'],
		['approved', '2026-01-01T00:00:00Z', 'approved'],
		['rejected', '2026-01-01T00:00:00Z', 'rejected']
	])('status %s, confirmed %s -> %s', async (status, confirmedAt, state) => {
		expect(await runPage(status, confirmedAt)).toEqual({
			state,
			email: 'p@example.com',
			children: [],
			loadError: false,
			invites: [],
			invitesLoadError: false
		});
	});
});

describe('parent page children (Story 7-2)', () => {
	const confirmed = '2026-01-01T00:00:00Z';

	it('reads linked_children() only for an approved parent', async () => {
		const pending = runPage('pending', confirmed);
		await pending;
		expect(pending.rpc).not.toHaveBeenCalled();

		const approved = runPage('approved', confirmed);
		await approved;
		expect(approved.rpc).toHaveBeenCalledWith('linked_children');
	});

	it('lists pending and approved children, with their status', async () => {
		const result = await runPage('approved', confirmed, {
			data: [
				{ id: 'c1', name: 'Dawa', status: 'approved' },
				{ id: 'c2', name: 'Pema', status: 'pending' }
			],
			error: null
		});
		expect(result).toMatchObject({
			state: 'approved',
			loadError: false,
			children: [
				{ id: 'c1', name: 'Dawa', status: 'approved' },
				{ id: 'c2', name: 'Pema', status: 'pending' }
			]
		});
	});

	it('never shows a rejected child, even if one is returned', async () => {
		const result = await runPage('approved', confirmed, {
			data: [{ id: 'c3', name: 'Tashi', status: 'rejected' }],
			error: null
		});
		expect(result).toMatchObject({ children: [] });
	});

	it('flags a load error instead of pretending there are no children', async () => {
		const result = await runPage('approved', confirmed, {
			data: null,
			error: { message: 'boom' }
		});
		expect(result).toMatchObject({ children: [], loadError: true });
	});
});

describe('parent child cards (Story 7-3)', () => {
	const confirmed = '2026-01-01T00:00:00Z';
	const children: RpcResult = {
		data: [
			{ id: 'c1', name: 'Dawa', status: 'approved' },
			{ id: 'c2', name: 'Pema', status: 'pending' }
		],
		error: null
	};
	const tables: Record<string, TableResult> = {
		class_enrollments: {
			data: [
				{ student_id: 'c1', class_id: 'k2' },
				{ student_id: 'c1', class_id: 'k1' },
				{ student_id: 'other', class_id: 'k3' }
			],
			error: null
		},
		classes: {
			data: [
				{ id: 'k1', name: 'Alphabet' },
				{ id: 'k2', name: 'Songs' },
				{ id: 'k3', name: 'Other class' }
			],
			error: null
		},
		class_syllabi: { data: [], error: null }
	};
	const counts: Record<string, RpcResult> = {
		c1: { data: [{ open_count: 2, overdue_count: 1 }], error: null }
	};

	it('an approved child gets classes and Open/Overdue counts; a pending child only its name', async () => {
		const page = runPage('approved', confirmed, children, { tables, counts });
		const result = await page;
		expect(result).toEqual({
			state: 'approved',
			email: 'p@example.com',
			loadError: false,
			invites: [],
			invitesLoadError: false,
			children: [
				{
					id: 'c1',
					name: 'Dawa',
					status: 'approved',
					classes: ['Alphabet', 'Songs'],
					open: 2,
					overdue: 1
				},
				{ id: 'c2', name: 'Pema', status: 'pending' }
			]
		});
		// Every read uses the child's explicit id; nothing for the pending child.
		expect(page.rpc).toHaveBeenCalledWith('homework_counts', { p_student_id: 'c1' });
		expect(page.rpc).not.toHaveBeenCalledWith('homework_counts', { p_student_id: 'c2' });
	});

	it('flags a load error when homework_counts() fails', async () => {
		const result = await runPage('approved', confirmed, children, {
			tables,
			counts: { c1: { data: null, error: { message: 'boom' } } }
		});
		expect(result).toMatchObject({
			loadError: true,
			children: [{ id: 'c1', open: 0, overdue: 0 }, { id: 'c2' }]
		});
	});

	it('logs one error per failing child with its id and both failures', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await runPage('approved', confirmed, children, {
				tables: { ...tables, class_enrollments: { data: null, error: { message: 'boom' } } },
				counts: { c1: { data: null, error: { message: 'counts boom' } } }
			});
			expect(log).toHaveBeenCalledTimes(1);
			expect(log).toHaveBeenCalledWith('parent load: child details failed', {
				childId: 'c1',
				classes: 'classes query failed',
				homeworkCounts: 'counts boom'
			});
		} finally {
			log.mockRestore();
		}
	});

	it('flags a load error when the classes cannot be read', async () => {
		const result = await runPage('approved', confirmed, children, {
			tables: { ...tables, class_enrollments: { data: null, error: { message: 'boom' } } },
			counts
		});
		expect(result).toMatchObject({
			loadError: true,
			children: [{ id: 'c1', classes: [] }, { id: 'c2' }]
		});
	});
});

describe('parent page invites (spec-second-parent story 3)', () => {
	const confirmed = '2026-01-01T00:00:00Z';
	const INVITE = '11111111-2222-4333-8444-555555555555';

	it('reads list_my_parent_invites() only for an approved parent, even with no children', async () => {
		const pending = runPage('pending', confirmed);
		await pending;
		expect(pending.rpc).not.toHaveBeenCalledWith('list_my_parent_invites');

		const approved = runPage(
			'approved',
			confirmed,
			{ data: [], error: null },
			{
				invites: {
					data: [
						{
							id: INVITE,
							child_name: 'Dawa',
							invited_by_name: 'Pema',
							expires_at: '2026-02-01T00:00:00Z'
						},
						{
							id: 'i2',
							child_name: null,
							invited_by_name: null,
							expires_at: '2026-02-02T00:00:00Z'
						}
					],
					error: null
				}
			}
		);
		expect(await approved).toMatchObject({
			children: [],
			invitesLoadError: false,
			invites: [
				{ id: INVITE, childName: 'Dawa', invitedBy: 'Pema', expiresAt: '2026-02-01T00:00:00Z' },
				{ id: 'i2', childName: 'A child', invitedBy: null, expiresAt: '2026-02-02T00:00:00Z' }
			]
		});
		expect(approved.rpc).toHaveBeenCalledWith('list_my_parent_invites');
	});

	it('flags an invites load error without touching the children', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const result = await runPage(
				'approved',
				confirmed,
				{ data: [], error: null },
				{
					invites: { data: null, error: { message: 'boom' } }
				}
			);
			expect(result).toMatchObject({ invites: [], invitesLoadError: true, loadError: false });
		} finally {
			log.mockRestore();
		}
	});

	function acceptEvent(inviteId: string, result: { error: unknown }) {
		const body = new FormData();
		body.append('inviteId', inviteId);
		const rpc = vi.fn(async () => ({ data: null, ...result }));
		const event = {
			request: new Request('http://localhost/parent', { method: 'POST', body }),
			locals: {
				supabase: { rpc },
				safeGetSession: async () => ({ user: { id: 'p1' } })
			}
		} as unknown as Parameters<typeof actions.acceptInvite>[0];
		return { event, rpc };
	}

	it('accepts through accept_parent_invite()', async () => {
		const { event, rpc } = acceptEvent(INVITE, { error: null });
		expect(await actions.acceptInvite(event)).toEqual({ action: 'acceptInvite', success: true });
		expect(rpc).toHaveBeenCalledWith('accept_parent_invite', { p_invite_id: INVITE });
	});

	it('refuses a malformed id without a call', async () => {
		const { event, rpc } = acceptEvent('nope', { error: null });
		expect(await actions.acceptInvite(event)).toMatchObject({
			status: 400,
			data: { acceptError: 'Could not accept the invite. Please try again.' }
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it.each([
		[{ code: '42501' }, 403, "You can't accept this invite."],
		[{ code: '22023', hint: 'invite_not_live' }, 400, 'This invite can no longer be accepted.'],
		[{ code: '22023', hint: 'child_has_two_parents' }, 400, 'This child already has two parents.'],
		[
			{ code: '22023', hint: 'removed_parent' },
			400,
			"The admin removed your link to this child, so this invite can't be accepted."
		],
		[
			{ code: '22023', hint: 'duplicate_child_name' },
			400,
			'You already have a child with this name.'
		]
	])('maps a refusal %o', async (error, status, message) => {
		const { event } = acceptEvent(INVITE, { error });
		expect(await actions.acceptInvite(event)).toMatchObject({
			status,
			data: { inviteId: INVITE, acceptError: message }
		});
	});
});
