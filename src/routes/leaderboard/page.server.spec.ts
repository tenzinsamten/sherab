import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * Closes the Story 4-3 I/O matrix's "RPC call fails" row: `+page.server.ts`
 * itself has no load-function test scaffolding precedent anywhere else in
 * this codebase (RLS specs exercise tables directly, never a load function),
 * but `load()` is a plain async function taking `locals` -- no SvelteKit
 * test harness is needed to call it directly with a mocked `locals`.
 */
function fakeLocals(
	rpcResult: { data: unknown; error: unknown },
	user: { id: string } | null = { id: 'user-1' }
) {
	return {
		supabase: { rpc: async () => rpcResult },
		safeGetSession: async () => ({ user })
	} as unknown as Parameters<typeof load>[0]['locals'];
}

describe('leaderboard +page.server.ts load', () => {
	it('sets loadError true and returns an empty team list when the RPC fails', async () => {
		const result = await load({
			locals: fakeLocals({ data: null, error: { message: 'boom' } })
		} as Parameters<typeof load>[0]);

		expect(result).toEqual({ teams: [], loadError: true });
	});

	it('sets loadError false and shapes the rows when the RPC succeeds', async () => {
		const result = await load({
			locals: fakeLocals({
				data: [{ team_id: 't1', team_name: 'Snow Lions', total_streak: 5 }],
				error: null
			})
		} as Parameters<typeof load>[0]);

		expect(result).toEqual({
			teams: [{ teamId: 't1', teamName: 'Snow Lions', totalStreak: 5 }],
			loadError: false
		});
	});

	it('sets loadError false and returns an empty team list when the RPC succeeds with zero teams (I/O matrix: "No teams exist at all")', async () => {
		const result = await load({
			locals: fakeLocals({ data: [], error: null })
		} as Parameters<typeof load>[0]);

		expect(result).toEqual({ teams: [], loadError: false });
	});

	it("redirects an unauthenticated caller to /login -- the route's real access barrier (the RPC grant alone does not block anon locally)", async () => {
		await expect(
			load({
				locals: fakeLocals({ data: null, error: null }, null)
			} as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 303, location: '/login' });
	});
});
