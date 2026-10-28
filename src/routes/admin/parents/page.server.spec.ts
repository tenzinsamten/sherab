import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const LINKED_AT = '2026-10-01T10:00:00Z';
const ADMIN_ID = 'admin-1';

type Person = { display_name: string | null; email: string | null } | null;

/** An active student_parents row as the load reads it (spec-second-parent stories 2 and 4). */
function link(
	parentId: string,
	studentId: string,
	student: {
		display_name: string | null;
		registration_name: string | null;
		status: 'pending' | 'approved' | 'rejected';
	} | null,
	extra: { linked_at?: string; parent?: Person; inviter?: Person } = {}
) {
	return {
		parent_id: parentId,
		student_id: studentId,
		linked_at: extra.linked_at ?? LINKED_AT,
		student,
		parent: extra.parent ?? {
			display_name: `Parent ${parentId}`,
			email: `${parentId}@example.com`
		},
		inviter: extra.inviter ?? null
	};
}

/** A child row as the load returns it, for a child with one parent. */
const child = (id: string, name: string, status: 'pending' | 'approved' | 'rejected') => ({
	id,
	name,
	status,
	linkedAt: LINKED_AT,
	invitedBy: null,
	coParent: null,
	canRemove: false
});

const LINK_SELECT =
	'parent_id, student_id, linked_at, student:profiles!student_parents_student_id_fkey ( display_name, registration_name, status ), parent:profiles!student_parents_parent_id_fkey ( display_name, email ), inviter:profiles!student_parents_invited_by_fkey ( display_name, email )';

/**
 * #52 admin Parents list. `load()` is a plain async function taking
 * `locals`, so a mocked `locals.supabase` chain is enough (same pattern as
 * admin/page.server.spec.ts).
 */
type ChainResult = { data?: unknown; error: unknown };

function fakeLocals(results: { parents: ChainResult; links?: ChainResult; own?: ChainResult }) {
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
			// The admin's own links (readOwnLinkedStudentIds) filter on parent_id.
			then: (resolve: (value: ChainResult) => unknown) =>
				resolve(
					table === 'student_parents' && call.eqArgs?.[0] === 'parent_id'
						? (results.own ?? { data: [], error: null })
						: result
				)
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
		},
		safeGetSession: async () => ({ user: { id: ADMIN_ID } })
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
					children: [child('c1', 'Anna', 'approved'), child('c2', 'Pema', 'pending')]
				}
			],
			pendingCount: 0,
			loadError: false
		});
		const parentsCall = calls.find((c) => c.table === 'parents');
		const childrenCall = calls.find((c) => c.table === 'student_parents' && !c.eqArgs);
		expect(parentsCall?.select).toBe(
			'id, status, profiles!parents_id_fkey ( display_name, email, email_confirmed_at )'
		);
		expect(childrenCall?.select).toBe(LINK_SELECT);
		expect(childrenCall?.isArgs).toEqual(['removed_at', null]);
		expect(childrenCall?.inArgs).toBeUndefined();
		expect(JSON.stringify(calls)).not.toContain('registered_by_parent_id');
	});

	const anna = { display_name: 'Anna', registration_name: 'Anna', status: 'approved' as const };
	const twoParents = () => ({
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
	});
	/** A registered the child; B was invited by A a day later. */
	const familyLinks = () => ({
		data: [
			link('pa', 'c1', anna, {
				linked_at: '2026-09-01T10:00:00Z',
				parent: { display_name: 'A', email: 'a@example.com' }
			}),
			link('pb', 'c1', anna, {
				linked_at: '2026-09-02T10:00:00Z',
				parent: { display_name: null, email: 'b@example.com' },
				inviter: { display_name: 'A', email: 'a@example.com' }
			})
		],
		error: null
	});

	it('a child with two parents: inviter, link date, co-parent and Remove under both (stories 2 and 4)', async () => {
		const { locals, calls } = fakeLocals({ parents: twoParents(), links: familyLinks() });

		const result = await run(locals);
		if (!result) throw new Error('no result');

		expect(result.parents.map((p: { id: string }) => p.id)).toEqual(['pa', 'pb']);
		expect(result.parents[0].children).toEqual([
			{
				id: 'c1',
				name: 'Anna',
				status: 'approved',
				linkedAt: '2026-09-01T10:00:00Z',
				invitedBy: null,
				coParent: 'b@example.com',
				canRemove: true
			}
		]);
		expect(result.parents[1].children).toEqual([
			{
				id: 'c1',
				name: 'Anna',
				status: 'approved',
				linkedAt: '2026-09-02T10:00:00Z',
				invitedBy: 'A',
				coParent: 'A',
				canRemove: true
			}
		]);
		const ownCall = calls.find((c) => c.table === 'student_parents' && c.eqArgs);
		expect(ownCall?.eqArgs).toEqual(['parent_id', ADMIN_ID]);
		expect(ownCall?.isArgs).toEqual(['removed_at', null]);
	});

	it("no Remove for the admin's own child (AD-4)", async () => {
		const { locals } = fakeLocals({
			parents: twoParents(),
			links: familyLinks(),
			own: { data: [{ student_id: 'c1' }], error: null }
		});

		const result = await run(locals);
		for (const p of result?.parents ?? []) expect(p.children[0].canRemove).toBe(false);
	});

	it("no Remove anywhere when the admin's own links cannot be read", async () => {
		const { locals } = fakeLocals({
			parents: twoParents(),
			links: familyLinks(),
			own: { data: null, error: { message: 'boom' } }
		});

		const result = await run(locals);
		expect(result?.loadError).toBe(false);
		for (const p of result?.parents ?? []) expect(p.children[0].canRemove).toBe(false);
	});

	it('a child with one parent left has no co-parent and no Remove (acceptance)', async () => {
		const { locals } = fakeLocals({
			parents: twoParents(),
			links: { data: [familyLinks().data[0]], error: null }
		});

		const result = await run(locals);
		if (!result) throw new Error('no result');
		expect(result.parents[0].children).toEqual([
			{
				id: 'c1',
				name: 'Anna',
				status: 'approved',
				linkedAt: '2026-09-01T10:00:00Z',
				invitedBy: null,
				coParent: null,
				canRemove: false
			}
		]);
		expect(result.parents[1].children).toEqual([]);
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
		expect(calls.map((c) => c.table)).toEqual(['parents', 'student_parents', 'student_parents']);
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
			expect(p.children).toEqual([child(`c-${p.id}`, `Child ${p.id}`, 'approved')]);
		}
		const childrenCall = calls.find((c) => c.table === 'student_parents' && !c.eqArgs);
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

const STUDENT = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';

/** spec-second-parent story 4: the removeParentLink action. */
describe('admin parents removeParentLink action', () => {
	function actionEvent(
		fields: Record<string, string>,
		rpcResult: { error: unknown } = { error: null },
		user: { id: string } | null = { id: ADMIN_ID }
	) {
		const rpc = vi.fn(async () => rpcResult);
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const event = {
			request: new Request('http://localhost/admin/parents?/removeParentLink', {
				method: 'POST',
				body
			}),
			locals: { supabase: { rpc }, safeGetSession: async () => ({ user }) }
		} as unknown as Parameters<typeof actions.removeParentLink>[0];
		return { event, rpc };
	}

	it('calls remove_parent_link with the two ids', async () => {
		const { event, rpc } = actionEvent({ studentId: STUDENT, parentId: PARENT });

		expect(await actions.removeParentLink(event)).toEqual({ linkRemoved: true });
		expect(rpc).toHaveBeenCalledWith('remove_parent_link', {
			p_student_id: STUDENT,
			p_parent_id: PARENT
		});
	});

	it('refuses a malformed id without calling the database', async () => {
		const { event, rpc } = actionEvent({ studentId: 'nope', parentId: PARENT });

		const result = await actions.removeParentLink(event);
		expect(result).toMatchObject({
			status: 400,
			data: { error: "You can't remove this parent link." }
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it('refuses without a session', async () => {
		const { event, rpc } = actionEvent({ studentId: STUDENT, parentId: PARENT }, undefined, null);

		expect(await actions.removeParentLink(event)).toMatchObject({ status: 401 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it.each([
		[
			{ code: '42501', hint: 'own_child' },
			403,
			"You can't remove a parent link of your own child."
		],
		[{ code: '42501' }, 403, "You can't remove this parent link."],
		[
			{ code: '22023', hint: 'last_parent_link' },
			400,
			"This is the child's only parent link, so it can't be removed."
		],
		[{ code: '22023', hint: 'link_removed' }, 400, 'This parent link is already removed.']
	])('maps the refusal %o', async (err, status, message) => {
		const { event } = actionEvent({ studentId: STUDENT, parentId: PARENT }, { error: err });

		expect(await actions.removeParentLink(event)).toMatchObject({
			status,
			data: { error: message }
		});
	});
});
