import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';

/**
 * My classes load and (#113, moved from the dashboard) the "Join another
 * class" actions, with a mocked `locals.supabase`: one queued result per
 * table and per RPC, `.in()` honoured like PostgREST would.
 */
type Result = { data: unknown; error: unknown };

function makeChain(result: Result) {
	let filter: { column: string; values: unknown[] } | null = null;
	const chain = {
		select: () => chain,
		eq: () => chain,
		in: (column: string, values: unknown[]) => {
			filter = { column, values };
			return chain;
		},
		order: () => chain,
		range: () => chain,
		single: () => chain,
		maybeSingle: () => chain,
		then: (resolve: (value: Result) => unknown) => {
			const f = filter;
			const data =
				f && Array.isArray(result.data)
					? result.data.filter((r: Record<string, unknown>) => f.values.includes(r[f.column]))
					: result.data;
			return resolve({ ...result, data });
		}
	};
	return chain;
}

const base: Record<string, Result> = {
	class_enrollments: { data: [{ class_id: 'c1' }], error: null },
	classes: { data: [{ id: 'c1', name: 'Yaks' }], error: null },
	class_syllabi: { data: [], error: null },
	app_settings: { data: { value: { days: 14 } }, error: null }
};

const people: Result = {
	data: [{ person_id: 't1', display_name: 'Tenzin', is_teacher: true }],
	error: null
};

const joinRequests: Result = {
	data: [
		{
			id: 'r2',
			class_id: 'c3',
			class_name: 'Dancers',
			class_name_bo: null,
			class_name_de: 'Tänzer',
			status: 'pending',
			requested_at: '2026-09-29T10:00:00Z',
			reviewed_at: null
		},
		{
			id: 'r1',
			class_id: 'c2',
			class_name: 'Singers',
			class_name_bo: null,
			class_name_de: null,
			status: 'rejected',
			requested_at: '2026-09-28T10:00:00Z',
			reviewed_at: '2026-09-28T12:00:00Z'
		}
	],
	error: null
};

function run(tables: Record<string, Result>, joinResult: Result = joinRequests) {
	const calls: string[] = [];
	const supabase = {
		from: (table: string) => makeChain(tables[table] ?? { data: [], error: null }),
		rpc: async (name: string) => {
			calls.push(name);
			if (name === 'my_class_join_requests') return joinResult;
			if (name === 'class_people') return people;
			return { data: [], error: null };
		}
	};
	const result = load({
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 's1' } })
		}
	} as unknown as Parameters<typeof load>[0]);
	return { calls, result };
}

describe('student classes load', () => {
	it('lists the classes with their teachers', async () => {
		const { result } = run(base);
		expect(await result).toMatchObject({
			classes: [{ id: 'c1', name: 'Yaks', teachers: ['Tenzin'], todo: 0 }],
			loadError: false
		});
	});

	it('lists the pending and rejected join requests in the order the database gives (#67)', async () => {
		const { calls, result } = run(base);
		expect(await result).toMatchObject({
			joinRequests: [
				{ id: 'r2', className: 'Dancers', status: 'pending' },
				{ id: 'r1', className: 'Singers', status: 'rejected' }
			],
			joinLoadError: false
		});
		expect(calls).toContain('my_class_join_requests');
	});

	it('reads the join requests also for a student in no class', async () => {
		const { result } = run({ ...base, class_enrollments: { data: [], error: null } });
		expect(await result).toMatchObject({
			classes: [],
			joinRequests: [{ id: 'r2' }, { id: 'r1' }],
			loadError: false
		});
	});

	it('flags only the join card when my_class_join_requests() fails', async () => {
		const { result } = run(base, { data: null, error: { message: 'boom' } });
		expect(await result).toMatchObject({
			classes: [{ id: 'c1' }],
			joinRequests: [],
			joinLoadError: true,
			loadError: false
		});
	});

	it('still reads the join requests when the class list fails', async () => {
		const { result } = run({
			...base,
			class_enrollments: { data: null, error: { message: 'boom' } }
		});
		expect(await result).toMatchObject({
			classes: [],
			loadError: true,
			joinRequests: [{ id: 'r2' }, { id: 'r1' }],
			joinLoadError: false
		});
	});
});

/**
 * #67: the "Join another class" actions, with a mocked `locals.supabase.rpc`.
 */
describe('student classes join actions', () => {
	type RpcResult = { data: unknown; error: { code?: string; hint?: string | null } | null };

	function call(
		action: 'requestJoin' | 'dismissJoin',
		fields: Record<string, string>,
		result: RpcResult = { data: 'Dancers', error: null },
		user: { id: string } | null = { id: 's1' },
		lookup: unknown[] = [{ id: 'c1', name: 'Dancers', name_bo: null, name_de: 'Tänzer' }]
	) {
		const calls: { name: string; args: unknown }[] = [];
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		const event = {
			request: new Request('http://localhost/student/classes', { method: 'POST', body }),
			locals: {
				safeGetSession: async () => ({ session: user ? {} : null, user }),
				supabase: {
					rpc: async (name: string, args: unknown) => {
						calls.push({ name, args });
						// #76: the names in every language, for the confirmation.
						if (name === 'validate_class_code') return { data: lookup, error: null };
						return result;
					}
				}
			}
		};
		const handler = actions[action] as (e: unknown) => Promise<unknown>;
		return { calls, result: handler(event) };
	}

	it('sends the trimmed, upper-cased code and returns the class name', async () => {
		const { calls, result } = call('requestJoin', { code: '  ab3cd9 ' });
		expect(await result).toEqual({ joinSent: 'Dancers' });
		expect(calls).toEqual([
			{ name: 'request_class_join', args: { p_code: 'AB3CD9' } },
			{ name: 'validate_class_code', args: { p_code: 'AB3CD9' } }
		]);
	});

	it('falls back to the name request_class_join returned when the lookup finds nothing', async () => {
		const { result } = call(
			'requestJoin',
			{ code: 'AB3CD9' },
			{ data: 'Dancers', error: null },
			{ id: 's1' },
			[]
		);
		expect(await result).toEqual({ joinSent: 'Dancers' });
	});

	it('refuses an empty code without calling the database', async () => {
		const { calls, result } = call('requestJoin', { code: '   ' });
		expect(await result).toMatchObject({
			status: 400,
			data: { joinError: 'Enter a class code.', code: '' }
		});
		expect(calls).toEqual([]);
	});

	it('answers an overlong code like an unknown one, without calling the database', async () => {
		const { calls, result } = call('requestJoin', { code: 'X'.repeat(40) });
		expect(await result).toMatchObject({
			status: 400,
			data: { joinError: "That code doesn't open a class you can join. Check the code." }
		});
		expect(calls).toEqual([]);
	});

	it.each([
		[
			{ code: '22023', hint: 'join_code_invalid' },
			"That code doesn't open a class you can join. Check the code."
		],
		[
			{ code: '23505', hint: 'join_already_pending' },
			"You've already requested this class. Wait for a decision."
		],
		[
			{ code: '22023', hint: 'join_limit' },
			'You have 3 requests waiting. Wait for a decision before sending another.'
		],
		[{ code: '42501', hint: null }, "You can't send join requests with this account."],
		[{ code: 'XX000', hint: null }, 'Could not send the request. Please try again.']
	])('maps a refusal %o to its message', async (error, message) => {
		const { result } = call('requestJoin', { code: 'AB3CD9' }, { data: null, error });
		expect(await result).toMatchObject({
			status: 400,
			data: { joinError: message, code: 'AB3CD9' }
		});
	});

	it('dismisses a request by id', async () => {
		const { calls, result } = call('dismissJoin', { id: 'r1' }, { data: null, error: null });
		expect(await result).toEqual({ joinDismissed: true });
		expect(calls).toEqual([{ name: 'dismiss_class_join', args: { p_request_id: 'r1' } }]);
	});

	it.each(['requestJoin', 'dismissJoin'] as const)(
		'%s refuses a signed-out caller without calling the database',
		async (action) => {
			const { calls, result } = call(action, { code: 'AB3CD9', id: 'r1' }, undefined, null);
			expect(await result).toMatchObject({ status: 401, data: { joinError: 'Not signed in.' } });
			expect(calls).toEqual([]);
		}
	);

	it('says why a request that is not rejected cannot be dismissed', async () => {
		const { result } = call(
			'dismissJoin',
			{ id: 'r1' },
			{ data: null, error: { code: '22023', hint: 'join_not_rejected' } }
		);
		expect(await result).toMatchObject({
			status: 400,
			data: { joinError: 'Only a rejected request can be dismissed.' }
		});
	});

	it('reports a failed or id-less dismiss', async () => {
		const failed = call('dismissJoin', { id: 'r1' }, { data: null, error: { code: '42501' } });
		expect(await failed.result).toMatchObject({
			status: 400,
			data: { joinError: 'Could not dismiss the request. Please try again.' }
		});
		const missing = call('dismissJoin', {});
		expect(await missing.result).toMatchObject({ status: 400 });
		expect(missing.calls).toEqual([]);
	});
});
