import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

/** An active student_parents row as the load reads it (spec-second-parent story 2). */
function link(
	parentId: string,
	studentId: string,
	student: {
		display_name: string | null;
		registration_name: string | null;
		status: 'pending' | 'approved' | 'rejected';
	} | null
) {
	return { parent_id: parentId, student_id: studentId, student };
}

const LINK_SELECT =
	'parent_id, student_id, student:profiles!student_parents_student_id_fkey ( display_name, registration_name, status )';

/**
 * #52 admin Parents list. `load()` is a plain async function taking
 * `locals`, so a mocked `locals.supabase` chain is enough (same pattern as
 * admin/page.server.spec.ts).
 */
type ChainResult = { data?: unknown; error: unknown };

function fakeLocals(results: { parents: ChainResult; links?: ChainResult }) {
	type Call = {
		table: string;
		select?: string;
		eqArgs?: unknown[];
		inArgs?: unknown[];
		notArgs?: unknown[];
		isArgs?: unknown[];
	};
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
			not: (...args: unknown[]) => {
				call.notArgs = args;
				return chain;
			},
			is: (...args: unknown[]) => {
				call.isArgs = args;
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
					table === 'parents' ? results.parents : (results.links ?? { data: [], error: null })
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
			links: {
				data: [
					link('p1', 'c2', { display_name: null, registration_name: 'Pema', status: 'pending' }),
					link('p1', 'c1', {
						display_name: 'Anna',
						registration_name: 'Anna R',
						status: 'approved'
					})
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
		const childrenCall = calls.find((c) => c.table === 'student_parents');
		expect(parentsCall?.select).toBe(
			'id, status, profiles!parents_id_fkey ( display_name, email, email_confirmed_at )'
		);
		expect(childrenCall?.select).toBe(LINK_SELECT);
		expect(childrenCall?.isArgs).toEqual(['removed_at', null]);
		expect(childrenCall?.inArgs).toBeUndefined();
		expect(JSON.stringify(calls)).not.toContain('registered_by_parent_id');
	});

	it('a child with two linked parents is listed under both (spec-second-parent story 2)', async () => {
		const anna = { display_name: 'Anna', registration_name: 'Anna', status: 'approved' as const };
		const { locals } = fakeLocals({
			parents: {
				data: [
					parentRow('pa', 'approved', {
						display_name: 'A',
						email: 'a@example.com',
						email_confirmed_at: 'x'
					}),
					parentRow('pb', 'approved', {
						display_name: 'B',
						email: 'b@example.com',
						email_confirmed_at: 'x'
					})
				],
				error: null
			},
			links: { data: [link('pa', 'c1', anna), link('pb', 'c1', anna)], error: null }
		});

		const result = await run(locals);
		if (!result) throw new Error('no result');

		expect(result.parents.map((p: { id: string }) => p.id)).toEqual(['pa', 'pb']);
		for (const p of result.parents) {
			expect(p.children).toEqual([{ id: 'c1', name: 'Anna', status: 'approved' }]);
		}
	});

	it('a link whose student the admin cannot read is skipped', async () => {
		const { locals } = fakeLocals({
			parents: {
				data: [
					parentRow('pa', 'approved', {
						display_name: 'A',
						email: 'a@example.com',
						email_confirmed_at: 'x'
					})
				],
				error: null
			},
			links: { data: [link('pa', 'c1', null)], error: null }
		});

		const result = await run(locals);
		expect(result?.parents[0].children).toEqual([]);
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

	it('returns an empty list when there are no parents (CAP-5: both reads in one round)', async () => {
		const { locals, calls } = fakeLocals({ parents: { data: [], error: null } });

		const result = await run(locals);

		expect(result).toEqual({ parents: [], pendingCount: 0, loadError: false });
		expect(calls.map((c) => c.table)).toEqual(['parents', 'student_parents']);
	});

	it('maps the children of 1 000 parents with no id list in the query (CAP-5)', async () => {
		const ids = Array.from({ length: 1000 }, (_, i) => `p${String(i).padStart(4, '0')}`);
		const { locals, calls } = fakeLocals({
			parents: {
				data: ids.map((id) =>
					parentRow(id, 'approved', {
						display_name: `Parent ${id}`,
						email: `${id}@example.com`,
						email_confirmed_at: 'x'
					})
				),
				error: null
			},
			links: {
				data: [
					...ids.map((id) =>
						link(id, `c-${id}`, {
							display_name: `Child ${id}`,
							registration_name: null,
							status: 'approved'
						})
					),
					// RLS may still return a child of a parent not listed; it is not shown.
					link('gone', 'c-orphan', {
						display_name: 'Orphan',
						registration_name: null,
						status: 'approved'
					})
				],
				error: null
			}
		});

		const result = await run(locals);
		if (!result) throw new Error('no result');

		expect(result.loadError).toBe(false);
		expect(result.parents).toHaveLength(1000);
		for (const p of result.parents) {
			expect(p.children).toEqual([{ id: `c-${p.id}`, name: `Child ${p.id}`, status: 'approved' }]);
		}
		const childrenCall = calls.find((c) => c.table === 'student_parents');
		expect(childrenCall?.inArgs).toBeUndefined();
		expect(childrenCall?.isArgs).toEqual(['removed_at', null]);
	});

	it('sets loadError and no rows when the parents query fails', async () => {
		const { locals } = fakeLocals({ parents: { data: null, error: { message: 'boom' } } });

		expect(await run(locals)).toEqual({ parents: [], pendingCount: 0, loadError: true });
	});

	it('a failed children query with no parents is no load error (logged only)', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { locals } = fakeLocals({
			parents: { data: [], error: null },
			links: { data: null, error: { message: 'boom' } }
		});

		expect(await run(locals)).toEqual({ parents: [], pendingCount: 0, loadError: false });
		expect(logged).toHaveBeenCalledWith('admin parents load: children failed', 'boom');
		logged.mockRestore();
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
			links: { data: null, error: { message: 'boom' } }
		});

		expect(await run(locals)).toEqual({ parents: [], pendingCount: 0, loadError: true });
	});
});
