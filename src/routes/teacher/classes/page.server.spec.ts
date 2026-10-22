import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * Teacher classes page load (#108). Same approach as
 * ../page.server.spec.ts: a mocked `locals.supabase` chain with one queued
 * result per table.
 */
type ChainResult = { data?: unknown; error: unknown };

function makeChain(result: ChainResult) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		then: (resolve: (value: ChainResult) => unknown) => resolve(result)
	};
	return chain;
}

function fakeLocals(result: ChainResult, user: { id: string } | null = { id: 't1' }) {
	const tables: string[] = [];
	const locals = {
		safeGetSession: async () => ({ session: null, user }),
		supabase: {
			from: (table: string) => {
				tables.push(table);
				return makeChain(result);
			}
		}
	} as unknown as Parameters<typeof load>[0]['locals'];
	return { locals, tables };
}

async function run(result: ChainResult, user?: { id: string } | null) {
	const { locals, tables } = fakeLocals(result, user);
	return { result: await load({ locals } as Parameters<typeof load>[0]), tables };
}

describe('teacher classes +page.server.ts load', () => {
	it('returns the assigned classes with their codes from class_teachers', async () => {
		const { result, tables } = await run({
			data: [
				{ classes: { id: 'c1', name: 'Yaks', name_bo: null, name_de: null, code: 'RV7V4W' } },
				{ classes: null }
			],
			error: null
		});
		expect(tables).toEqual(['class_teachers']);
		expect(result).toEqual({
			classes: [{ id: 'c1', name: 'Yaks', code: 'RV7V4W' }],
			loadError: false
		});
	});

	it('returns an empty list when the teacher has no classes', async () => {
		const { result } = await run({ data: [], error: null });
		expect(result).toEqual({ classes: [], loadError: false });
	});

	it('sets loadError with an empty list when the query fails', async () => {
		const { result } = await run({ data: null, error: { message: 'boom' } });
		expect(result).toEqual({ classes: [], loadError: true });
	});

	it('queries nothing without a user', async () => {
		const { result, tables } = await run({ data: [], error: null }, null);
		expect(result).toEqual({ classes: [], loadError: false });
		expect(tables).toEqual([]);
	});
});
