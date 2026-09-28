import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * #52 admin Parents list. `load()` is a plain async function taking
 * `locals`, so a mocked `locals.supabase` chain is enough (same pattern as
 * admin/page.server.spec.ts).
 */
type ChainResult = { data?: unknown; error: unknown };

function fakeLocals(results: { parents: ChainResult; profiles?: ChainResult }) {
	type Call = { table: string; select?: string; eqArgs?: unknown[]; inArgs?: unknown[] };
	const calls: Call[] = [];
	const makeChain = (table: string, result: ChainResult) => {
		const call: Call = { table };
		calls.push(call);
		const chain = {
			select: (columns: string) => {
				call.select = columns;
				return chain;
			},
			eq: (...args: unknown[]) => {
				call.eqArgs = args;
				return chain;
			},
			in: (...args: unknown[]) => {
				call.inArgs = args;
				return chain;
			},
			then: (resolve: (value: ChainResult) => unknown) => resolve(result)
		};
		return chain;
	};
	const locals = {
		supabase: {
			from: (table: string) =>
				makeChain(
					table,
					table === 'parents' ? results.parents : (results.profiles ?? { data: [], error: null })
				)
		}
	} as unknown as Parameters<typeof load>[0]['locals'];
	return { locals, calls };
}

const run = (locals: Parameters<typeof load>[0]['locals']) =>
	load({ locals } as Parameters<typeof load>[0]);

function parentRow(
	id: string,
	status: 'pending' | 'approved' | 'rejected',
	profile: { display_name: string | null; email: string; email_confirmed_at: string | null }
) {
	return { id, status, profiles: profile };
}

describe('admin parents +page.server.ts load', () => {
	it('lists an approved parent with an approved and a pending child (acceptance)', async () => {
		const { locals, calls } = fakeLocals({
			parents: {
				data: [
					parentRow('p1', 'approved', {
						display_name: 'Dolma',
						email: 'dolma@example.com',
						email_confirmed_at: '2026-01-01T00:00:00Z'
					})
				],
				error: null
			},
			profiles: {
				data: [
					{
						id: 'c2',
						parent_id: 'p1',
						display_name: null,
						registration_name: 'Pema',
						status: 'pending'
					},
					{
						id: 'c1',
						parent_id: 'p1',
						display_name: 'Anna',
						registration_name: 'Anna R',
						status: 'approved'
					}
				],
				error: null
			}
		});

		const result = await run(locals);

		expect(result).toEqual({
			parents: [
				{
					id: 'p1',
					status: 'approved',
					name: 'Dolma',
					email: 'dolma@example.com',
					emailConfirmedAt: '2026-01-01T00:00:00Z',
					children: [
						{ id: 'c1', name: 'Anna', status: 'approved' },
						{ id: 'c2', name: 'Pema', status: 'pending' }
					]
				}
			],
			pendingCount: 0,
			loadError: false
		});
		const parentsCall = calls.find((c) => c.table === 'parents');
		const childrenCall = calls.find((c) => c.table === 'profiles');
		expect(parentsCall?.select).toBe(
			'id, status, profiles!parents_id_fkey ( display_name, email, email_confirmed_at )'
		);
		expect(childrenCall?.select).toBe('id, parent_id, display_name, registration_name, status');
		expect(childrenCall?.eqArgs).toEqual(['role', 'student']);
		expect(childrenCall?.inArgs).toEqual(['parent_id', ['p1']]);
	});

	it('orders pending, then approved, then rejected, each by name (email fallback)', async () => {
		const { locals } = fakeLocals({
			parents: {
				data: [
					parentRow('r', 'rejected', {
						display_name: 'Aaron',
						email: 'r@example.com',
						email_confirmed_at: 'x'
					}),
					parentRow('a', 'approved', {
						display_name: 'Zara',
						email: 'z@example.com',
						email_confirmed_at: 'x'
					}),
					parentRow('b', 'approved', {
						display_name: 'Anna',
						email: 'a@example.com',
						email_confirmed_at: 'x'
					}),
					parentRow('c', 'pending', {
						display_name: null,
						email: 'new@example.com',
						email_confirmed_at: null
					})
				],
				error: null
			}
		});

		const result = await run(locals);
		if (!result) throw new Error('no result');

		expect(result.parents.map((p: { name: string }) => p.name)).toEqual([
			'new@example.com',
			'Anna',
			'Zara',
			'Aaron'
		]);
		expect(result.parents[3]).toMatchObject({ status: 'rejected' });
		expect(result.parents[0]).toMatchObject({
			status: 'pending',
			emailConfirmedAt: null,
			children: []
		});
		expect(result.pendingCount).toBe(1);
	});

	it('skips the children query and returns an empty list when there are no parents', async () => {
		const { locals, calls } = fakeLocals({ parents: { data: [], error: null } });

		const result = await run(locals);

		expect(result).toEqual({ parents: [], pendingCount: 0, loadError: false });
		expect(calls.map((c) => c.table)).toEqual(['parents']);
	});

	it('sets loadError and no rows when the parents query fails', async () => {
		const { locals } = fakeLocals({ parents: { data: null, error: { message: 'boom' } } });

		expect(await run(locals)).toEqual({ parents: [], pendingCount: 0, loadError: true });
	});

	it('sets loadError when the children query fails', async () => {
		const { locals } = fakeLocals({
			parents: {
				data: [
					parentRow('p1', 'approved', {
						display_name: 'Dolma',
						email: 'd@example.com',
						email_confirmed_at: 'x'
					})
				],
				error: null
			},
			profiles: { data: null, error: { message: 'boom' } }
		});

		expect(await run(locals)).toEqual({ parents: [], pendingCount: 0, loadError: true });
	});
});
