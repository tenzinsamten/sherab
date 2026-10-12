import { describe, expect, it, vi } from 'vitest';
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
	user: { id: string } | null = { id: 'user-1' },
	// #97: viewable_team_ids() -- the teams this viewer may open.
	openable: { data: unknown; error: unknown } = { data: [], error: null }
) {
	return {
		supabase: {
			rpc: async (name: string) => (name === 'viewable_team_ids' ? openable : rpcResult)
		},
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
			teams: [{ teamId: 't1', teamName: 'Snow Lions', totalStreak: 5, canOpen: false }],
			loadError: false
		});
	});

	const twoTeams = {
		data: [
			{ team_id: 't1', team_name: 'Snow Lions', total_streak: 5 },
			{ team_id: 't2', team_name: 'Yaks', total_streak: 3 }
		],
		error: null
	};

	it("#97: a team is a link only where the database says this viewer may open it (a parent: their child's team)", async () => {
		const result = await load({
			locals: fakeLocals(twoTeams, { id: 'parent-1' }, { data: [{ team_id: 't2' }], error: null })
		} as Parameters<typeof load>[0]);

		expect(result).toEqual({
			teams: [
				{ teamId: 't1', teamName: 'Snow Lions', totalStreak: 5, canOpen: false },
				{ teamId: 't2', teamName: 'Yaks', totalStreak: 3, canOpen: true }
			],
			loadError: false
		});
	});

	it('#97: every team is a link for a viewer who may open them all', async () => {
		const result = await load({
			locals: fakeLocals(
				twoTeams,
				{ id: 'student-1' },
				{ data: [{ team_id: 't1' }, { team_id: 't2' }], error: null }
			)
		} as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ teams: [{ canOpen: true }, { canOpen: true }] });
	});

	it('#97: when the openable teams cannot be read, the leaderboard still loads, no team is a link, and the failure is logged', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const result = await load({
				locals: fakeLocals(twoTeams, { id: 'u' }, { data: null, error: { message: 'boom' } })
			} as Parameters<typeof load>[0]);

			expect(result).toMatchObject({
				teams: [{ canOpen: false }, { canOpen: false }],
				loadError: false
			});
			expect(logged).toHaveBeenCalledTimes(1);
			expect(logged.mock.calls[0][0]).toContain('boom');
		} finally {
			logged.mockRestore();
		}
	});

	it('#97: the rows carry team totals only -- nothing about a student', async () => {
		const result = await load({
			locals: fakeLocals(twoTeams, { id: 'u' }, { data: [{ team_id: 't1' }], error: null })
		} as Parameters<typeof load>[0]);

		for (const team of (result as { teams: object[] }).teams) {
			expect(Object.keys(team).sort()).toEqual(['canOpen', 'teamId', 'teamName', 'totalStreak']);
		}
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
