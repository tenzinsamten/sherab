import { describe, expect, it, vi } from 'vitest';
import { load as layoutLoad } from './+layout.server';
import { load as pageLoad } from './+page.server';

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

function runPage(
	parentStatus: string,
	emailConfirmedAt: string | null,
	rpcResult: RpcResult = { data: [], error: null }
) {
	const rpc = vi.fn().mockResolvedValue(rpcResult);
	const result = Promise.resolve(
		pageLoad({
			parent: async () => ({
				session,
				parentStatus,
				profile: { email: 'p@example.com', email_confirmed_at: emailConfirmedAt }
			}),
			locals: { supabase: { rpc } }
		} as unknown as Parameters<typeof pageLoad>[0])
	);
	return Object.assign(result, { rpc });
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
			loadError: false
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
