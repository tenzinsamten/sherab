import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import { actions, load } from './+page.server';

// #92: the key is null while push notifications are not set up.
const push = vi.hoisted(() => ({ key: null as string | null }));
vi.mock('$lib/server/push', () => ({ pushPublicKey: () => push.key }));

/**
 * /account (#23, #44, #46). `load` reads the layout's profile via
 * `parent()`; the actions go through a mocked `locals.supabase` chain, one
 * queued result per table.
 */
type Result = { data?: unknown; error: unknown };

function makeChain(result: Result) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		in: () => chain,
		order: () => chain,
		maybeSingle: () => chain,
		single: () => chain,
		update: () => chain,
		then: (resolve: (value: Result) => unknown) => resolve(result)
	};
	return chain;
}

function fakeSupabase(results: Record<string, Result>) {
	return { from: (table: string) => makeChain(results[table] ?? { data: [], error: null }) };
}

const session = { user: { id: 'u1', email: 'x@example.com' } };

function runLoad(
	profile: Record<string, unknown> | null,
	parentRow: Result = { data: null, error: null }
) {
	return load({
		parent: async () => ({ session, profile }),
		locals: {
			supabase: fakeSupabase({
				profiles: { data: profile ? { role: profile.role } : null, error: null },
				parents: parentRow
			})
		}
	} as unknown as Parameters<typeof load>[0]);
}

describe('account load', () => {
	it('gives a teacher their name and email only', async () => {
		const result = await runLoad({
			id: 'u1',
			role: 'teacher',
			display_name: 'Pema',
			email: 'pema@example.com'
		});
		expect(result).toEqual({
			role: 'teacher',
			displayName: 'Pema',
			email: 'pema@example.com',
			parentStatus: null
		});
	});

	it.each(['pending', 'approved', 'rejected'] as const)(
		'gives staff their parent-access status %s (B14a)',
		async (status) => {
			const result = await runLoad(
				{ id: 'u1', role: 'admin', display_name: 'Karma', email: 'karma@example.com' },
				{ data: { status }, error: null }
			);
			expect(result).toMatchObject({ role: 'admin', parentStatus: status });
		}
	);

	it('gives a student their name and username only (#46)', async () => {
		const result = await runLoad({
			id: 'u1',
			role: 'student',
			display_name: 'Tashi',
			email: `tashi-d@${STUDENT_EMAIL_DOMAIN}`
		});
		expect(result).toEqual({ role: 'student', displayName: 'Tashi', username: 'tashi-d' });
	});

	it('gives a parent their name and read-only email (Story 7-1)', async () => {
		const result = await runLoad({
			id: 'u1',
			role: 'parent',
			display_name: 'Dolma',
			email: 'dolma@example.com'
		});
		expect(result).toEqual({ role: 'parent', displayName: 'Dolma', email: 'dolma@example.com' });
	});

	it('refuses a session without a profile', async () => {
		await expect(runLoad(null)).rejects.toMatchObject({ status: 403 });
	});

	describe('push key (#92)', () => {
		const withKey = async (
			profile: Record<string, unknown>,
			parentStatus: string | null = null
		) => {
			push.key = 'vapid-public-key';
			try {
				return await runLoad(
					{ id: 'u1', display_name: 'Dolma', email: 'dolma@example.com', ...profile },
					{ data: parentStatus ? { status: parentStatus } : null, error: null }
				);
			} finally {
				push.key = null;
			}
		};

		it('goes to an approved student', async () => {
			expect(await withKey({ role: 'student', status: 'approved' })).toMatchObject({
				pushKey: 'vapid-public-key'
			});
		});

		it('goes to an approved parent, and to staff who are approved parents', async () => {
			for (const role of ['parent', 'teacher', 'admin']) {
				expect(await withKey({ role }, 'approved')).toMatchObject({
					pushKey: 'vapid-public-key'
				});
			}
		});

		it.each([
			['a pending student', { role: 'student', status: 'pending' }, null],
			['a pending parent', { role: 'parent' }, 'pending'],
			['a teacher who is no parent', { role: 'teacher' }, null],
			['an admin whose parent access was rejected', { role: 'admin' }, 'rejected']
		])('does not go to %s', async (_label, profile, parentStatus) => {
			const result = (await withKey(profile, parentStatus)) as { pushKey?: string };
			expect(result.pushKey).toBeUndefined();
		});

		it('goes to nobody while the feature is not set up', async () => {
			const result = (await runLoad({ id: 'u1', role: 'student', status: 'approved' })) as {
				pushKey?: string;
			};
			expect(result.pushKey).toBeUndefined();
		});
	});
});

describe('account actions', () => {
	function event(role: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		return {
			request: new Request('http://localhost/account', { method: 'POST', body }),
			locals: {
				supabase: fakeSupabase({ profiles: { data: { role }, error: null } }),
				safeGetSession: async () => ({ session, user: session.user })
			}
		} as unknown as Parameters<typeof actions.changePassword>[0];
	}

	it('does not let a student change their PIN here', async () => {
		const result = await actions.changePassword(
			event('student', { currentPassword: 'a', password: 'bbbbbb', confirm: 'bbbbbb' })
		);
		expect(result).toMatchObject({ status: 403 });
	});

	it('rejects an empty name before saving', async () => {
		const result = await actions.updateName(event('student', { displayName: '  ' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('lets a parent past the role gate for a password change (Story 7-1)', async () => {
		// Mismatched confirmation: fails on the rules, not on the role gate.
		const result = await actions.changePassword(
			event('parent', { currentPassword: 'a', password: 'bbbbbb', confirm: 'cccccc' })
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('lets a parent past the role gate for a name change (Story 7-1)', async () => {
		const result = await actions.updateName(event('parent', { displayName: '  ' }));
		expect(result).toMatchObject({ status: 400 });
	});
});

describe('requestParentAccess (B14a, #68)', () => {
	function event(role: string, rpcResult: { data?: unknown; error: unknown }) {
		const rpc = vi.fn(async () => rpcResult);
		return {
			rpc,
			e: {
				request: new Request('http://localhost/account', { method: 'POST' }),
				locals: {
					supabase: {
						...fakeSupabase({ profiles: { data: { role }, error: null } }),
						rpc
					},
					safeGetSession: async () => ({ session, user: session.user })
				}
			} as unknown as Parameters<typeof actions.requestParentAccess>[0]
		};
	}

	it.each(['teacher', 'admin'])('lets a %s request it', async (role) => {
		const { e, rpc } = event(role, { data: 'pending', error: null });
		expect(await actions.requestParentAccess(e)).toEqual({
			success: true,
			action: 'requestParentAccess'
		});
		expect(rpc).toHaveBeenCalledWith('request_parent_access');
	});

	it.each(['parent', 'student'])('refuses a %s before calling the RPC', async (role) => {
		const { e, rpc } = event(role, { data: 'pending', error: null });
		expect(await actions.requestParentAccess(e)).toMatchObject({ status: 403 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('maps an RPC 42501 to 403', async () => {
		const { e } = event('teacher', { data: null, error: { code: '42501', hint: null } });
		const result = await actions.requestParentAccess(e);
		expect(result).toMatchObject({
			status: 403,
			data: { error: m.account_parent_error_failed() }
		});
	});

	it.each([
		['already_pending', 'account_parent_error_pending'],
		['already_parent', 'account_parent_error_parent'],
		['rejected', 'account_parent_error_rejected'],
		[null, 'account_parent_error_failed']
	] as const)('maps hint %s to its message', async (hint, key) => {
		const { e } = event('teacher', { data: null, error: { code: '22023', hint } });
		const result = await actions.requestParentAccess(e);
		expect(result).toMatchObject({ status: 400, data: { error: m[key]() } });
	});
});
