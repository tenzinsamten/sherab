import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayInBerlin } from '$lib/berlin-date';
import { actions, load } from './+page.server';

/**
 * Student dashboard load (#46), with a mocked `locals.supabase`: one queued
 * result per table and per RPC, `.in()` honoured like PostgREST would.
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

const TODAY = todayInBerlin();

const base: Record<string, Result> = {
	profiles: { data: { role: 'student', team_id: 't2' }, error: null },
	class_enrollments: { data: [{ class_id: 'c1' }], error: null },
	classes: { data: [{ id: 'c1', name: 'Yaks' }], error: null },
	class_syllabi: { data: [], error: null },
	homework_status_history: {
		data: [
			{
				id: 'h1',
				instance_id: 'i1',
				class_id: 'c1',
				student_id: 's1',
				status: 'assigned',
				recorded_by: null,
				recorded_at: '2026-09-20T00:00:00Z'
			}
		],
		error: null
	},
	app_settings: { data: { value: { days: 14 } }, error: null },
	homework_instances: {
		data: [{ id: 'i1', assignment_id: 'a1', class_id: 'c1', due_date: TODAY, archived_at: null }],
		error: null
	},
	homework_assignments: {
		data: [
			{
				id: 'a1',
				title: 'Song practice',
				skill_area: 'song',
				content: null,
				content_language: 'en',
				reference_links: [],
				recurrence_rule: null
			}
		],
		error: null
	},
	student_streaks: { data: null, error: null },
	badges_earned: { data: [], error: null }
};

const leaderboard: Result = {
	data: [
		{ team_id: 't1', team_name: 'Snow Lions', total_streak: 9 },
		{ team_id: 't2', team_name: 'Yaks', total_streak: 4 }
	],
	error: null
};

const counts: Result = { data: [{ open_count: 1, overdue_count: 0 }], error: null };

const joinRequests: Result = {
	data: [
		{
			id: 'r2',
			class_id: 'c3',
			class_name: 'Dancers',
			status: 'pending',
			requested_at: '2026-09-29T10:00:00Z',
			reviewed_at: null
		},
		{
			id: 'r1',
			class_id: 'c2',
			class_name: 'Singers',
			status: 'rejected',
			requested_at: '2026-09-28T10:00:00Z',
			reviewed_at: '2026-09-28T12:00:00Z'
		}
	],
	error: null
};

function run(
	tables: Record<string, Result>,
	rpc: Result = leaderboard,
	countsResult: Result = counts,
	joinResult: Result = joinRequests
) {
	const calls: { name: string; args: unknown }[] = [];
	const supabase = {
		from: (table: string) => makeChain(tables[table] ?? { data: [], error: null }),
		rpc: async (name: string, args?: unknown) => {
			calls.push({ name, args });
			if (name === 'homework_counts') return countsResult;
			if (name === 'my_class_join_requests') return joinResult;
			return rpc;
		}
	};
	lastRpcCalls = calls;
	return load({
		locals: {
			supabase,
			safeGetSession: async () => ({ session: {}, user: { id: 's1' } })
		}
	} as unknown as Parameters<typeof load>[0]);
}

let lastRpcCalls: { name: string; args: unknown }[] = [];

describe('student dashboard load', () => {
	it('summarises homework, team rank and classes', async () => {
		const result = await run(base);
		expect(result).toMatchObject({
			tiles: { todo: 1, overdue: 0, doneThisWeek: 0 },
			team: { name: 'Yaks', rank: 2, total: 2 },
			nextDue: [{ instanceId: 'i1', title: 'Song practice' }],
			classes: [{ id: 'c1', name: 'Yaks', todo: 1 }],
			loadError: false
		});
	});

	it('lists the pending and rejected join requests in the order the database gives (#67)', async () => {
		const result = await run(base);
		expect(result).toMatchObject({
			joinRequests: [
				{ id: 'r2', className: 'Dancers', status: 'pending' },
				{ id: 'r1', className: 'Singers', status: 'rejected' }
			],
			joinLoadError: false
		});
	});

	it('flags only the join card when my_class_join_requests() fails', async () => {
		const result = await run(base, leaderboard, counts, {
			data: null,
			error: { message: 'boom' }
		});
		expect(result).toMatchObject({ joinRequests: [], joinLoadError: true, loadError: false });
	});

	it('takes the To do and Overdue tiles from homework_counts() for the caller (Story 7-3)', async () => {
		const result = await run(base, leaderboard, {
			data: [{ open_count: 5, overdue_count: 2 }],
			error: null
		});
		expect(result).toMatchObject({ tiles: { todo: 5, overdue: 2 }, loadError: false });
		expect(lastRpcCalls).toContainEqual({
			name: 'homework_counts',
			args: { p_student_id: 's1' }
		});
	});

	describe('today is the Berlin date, not UTC', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('flags an item due yesterday in Berlin as overdue while UTC is still that day', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			// 23:30 UTC on the 27th is already 01:30 on the 28th in Berlin.
			vi.setSystemTime(new Date('2026-09-27T23:30:00Z'));
			const result = await run({
				...base,
				homework_instances: {
					data: [
						{
							id: 'i1',
							assignment_id: 'a1',
							class_id: 'c1',
							due_date: '2026-09-27',
							archived_at: null
						}
					],
					error: null
				}
			});
			expect(result).toMatchObject({
				nextDue: [{ instanceId: 'i1', dueDate: '2026-09-27', overdue: true }]
			});
		});
	});

	it('sets loadError when homework_counts() fails', async () => {
		const result = await run(base, leaderboard, { data: null, error: { message: 'boom' } });
		expect(result).toMatchObject({ tiles: { todo: 0, overdue: 0 }, loadError: true });
	});

	it('sets loadError when the leaderboard fails', async () => {
		const result = await run(base, { data: null, error: { message: 'boom' } });
		expect(result).toMatchObject({ team: null, loadError: true });
	});

	it.each(['class_enrollments', 'student_streaks', 'badges_earned'])(
		'sets loadError when the %s query fails',
		async (table) => {
			const result = await run({ ...base, [table]: { data: null, error: { message: 'boom' } } });
			expect(result).toMatchObject({ loadError: true });
		}
	);

	it('sends a non-student home', async () => {
		await expect(
			run({ ...base, profiles: { data: { role: 'teacher', team_id: null }, error: null } })
		).rejects.toMatchObject({ status: 303, location: '/' });
	});
});

/**
 * #67: the "Join another class" actions, with a mocked `locals.supabase.rpc`.
 */
describe('student dashboard join actions', () => {
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
			request: new Request('http://localhost/student', { method: 'POST', body }),
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
