import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * Closes the Story 5-1 I/O matrix's "Any one query fails" row: `load()`
 * issues six parallel queries and OR-chains their errors into `loadError`,
 * but nothing exercised that chain directly. Mirrors Story 4-3's
 * `leaderboard/page.server.spec.ts` precedent -- `load()` is a plain async
 * function taking `locals`, so no SvelteKit test harness is needed, just a
 * mocked `locals.supabase` chain.
 */
type ChainResult = { data?: unknown; count?: number | null; error: unknown };

function makeChain(result: ChainResult) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		range: () => chain,
		then: (resolve: (value: ChainResult) => unknown) => resolve(result)
	};
	return chain;
}

function fakeLocals(overrides: Partial<Record<string, ChainResult>> = {}) {
	const ok: ChainResult = { data: [], count: 0, error: null };
	const results: Record<string, ChainResult> = {
		classes: ok,
		profiles: ok,
		homework_assignments: ok,
		homework_status_history: ok,
		...overrides
	};
	return {
		supabase: {
			from: (table: string) => makeChain(results[table])
		}
	} as unknown as Parameters<typeof load>[0]['locals'];
}

describe('admin dashboard +page.server.ts load', () => {
	it('sets loadError false and zeroed defaults when every query succeeds with no rows', async () => {
		const result = await load({ locals: fakeLocals() } as Parameters<typeof load>[0]);

		expect(result).toEqual({
			classesCount: 0,
			teachersCount: 0,
			studentsCount: 0,
			pendingRequestsCount: 0,
			homeworkAssignmentsCount: 0,
			homeworkCompletionPercent: 0,
			loadError: false
		});
	});

	it('sets loadError true when any one of the six parallel queries fails (I/O matrix: "Any one query fails")', async () => {
		const result = await load({
			locals: fakeLocals({
				homework_status_history: { data: null, error: { message: 'boom' } }
			})
		} as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ loadError: true });
	});
});
