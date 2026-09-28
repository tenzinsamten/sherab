import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { actions, load } from './+page.server';

/**
 * /parent/children/[id] (Stories 7-4, 7-5): a fake `locals.supabase` with one
 * result per table / RPC; `calls` records every chained query method.
 */
const CHILD = '11111111-2222-4333-8444-555555555555';
const SESSION = '66666666-7777-4888-8999-000000000000';

type Result = { data: unknown; error: unknown };

function fakeSupabase(opts: {
	linked?: unknown[];
	tables?: Record<string, Result>;
	rpc?: Record<string, Result>;
	insert?: Result;
}) {
	const calls: { table: string; method: string; args: unknown[] }[] = [];
	const inserted: unknown[] = [];
	function chain(table: string, result: Result) {
		const c: Record<string, unknown> = {};
		for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order']) {
			c[method] = (...args: unknown[]) => {
				calls.push({ table, method, args });
				return c;
			};
		}
		c.insert = (row: unknown) => {
			inserted.push(row);
			const r = opts.insert ?? { data: null, error: null };
			const ic = { select: () => ic, single: async () => r };
			return ic;
		};
		c.then = (resolve: (value: Result) => unknown) => resolve(result);
		return c;
	}
	const rpc = vi.fn(async (fn: string) =>
		fn === 'linked_children'
			? { data: opts.linked ?? [], error: null }
			: (opts.rpc?.[fn] ?? { data: null, error: null })
	);
	return {
		calls,
		inserted,
		rpc,
		client: {
			rpc,
			from: (table: string) => chain(table, opts.tables?.[table] ?? { data: [], error: null })
		}
	};
}

function runLoad(fake: ReturnType<typeof fakeSupabase>, id = CHILD, parentStatus = 'approved') {
	return load({
		params: { id },
		parent: async () => ({ parentStatus }),
		locals: { supabase: fake.client }
	} as unknown as Parameters<typeof load>[0]) as Promise<{
		child: { id: string; name: string };
		sessions: Record<string, unknown>[];
		deletion: { status: string; requestedAt: string } | null;
		deletionLoadError: boolean;
		loadError: boolean;
	}>;
}

function event(fields: Record<string, string>, fake: ReturnType<typeof fakeSupabase>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v);
	return {
		request: new Request(`http://localhost/parent/children/${CHILD}`, { method: 'POST', body }),
		params: { id: CHILD },
		locals: { supabase: fake.client, safeGetSession: async () => ({ user: { id: 'p1' } }) }
	} as unknown as Parameters<typeof actions.setLeave>[0];
}

function plusDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

const approvedChild = { id: CHILD, name: 'Dawa', status: 'approved' };

describe('parent child leave page: guard', () => {
	it.each([
		['a parent who is not approved', 'pending', CHILD, [approvedChild]],
		['a malformed id', 'approved', 'not-a-uuid', [approvedChild]],
		['a child who is not linked', 'approved', CHILD, []],
		['a pending child', 'approved', CHILD, [{ ...approvedChild, status: 'pending' }]]
	])('404 for %s', async (_label, status, id, linked) => {
		const fake = fakeSupabase({ linked });
		await expect(runLoad(fake, id, status)).rejects.toMatchObject({ status: 404 });
	});
});

describe('parent child leave page: sessions', () => {
	const future = new Date(Date.now() + 86_400_000).toISOString();
	const past = new Date(Date.now() - 60_000).toISOString();
	const tables: Record<string, Result> = {
		class_enrollments: { data: [{ class_id: 'k1' }], error: null },
		class_sessions_effective: {
			data: [
				{
					id: 's1',
					day: '2099-10-04',
					class_name: 'Alphabet',
					start_time: '10:00:00',
					duration_minutes: 90,
					starts_at: future
				},
				{
					id: 's2',
					day: '2000-09-24',
					class_name: 'Songs',
					start_time: null,
					duration_minutes: null,
					starts_at: past
				}
			],
			error: null
		},
		session_leave_history: {
			data: [
				{ class_session_id: 's1', answer: 'on_leave', classification: 'short_notice' },
				{ class_session_id: 's1', answer: 'coming', classification: null }
			],
			error: null
		}
	};

	it("lists the child's non-cancelled sessions from yesterday for 12 weeks with the current answer", async () => {
		const fake = fakeSupabase({ linked: [approvedChild], tables });
		const result = await runLoad(fake);
		expect(result).toEqual({
			child: { id: CHILD, name: 'Dawa' },
			deletion: null,
			deletionLoadError: false,
			loadError: false,
			sessions: [
				{
					id: 's1',
					day: '2099-10-04',
					className: 'Alphabet',
					startTime: '10:00',
					durationMinutes: 90,
					open: true,
					answer: 'on_leave',
					classification: 'short_notice',
					decision: null,
					sickOpen: false
				},
				{
					id: 's2',
					day: '2000-09-24',
					className: 'Songs',
					startTime: null,
					durationMinutes: null,
					open: false,
					answer: null,
					classification: null,
					decision: null,
					sickOpen: false
				}
			]
		});

		const today = todayInBerlin();
		const yesterday = plusDays(today, -1);
		const end = new Date(`${today}T00:00:00Z`);
		end.setUTCDate(end.getUTCDate() + 84);
		const sessionCalls = fake.calls
			.filter((c) => c.table === 'class_sessions_effective')
			.map(({ method, args }) => [method, ...args]);
		expect(sessionCalls).toEqual(
			expect.arrayContaining([
				['in', 'class_id', ['k1']],
				['eq', 'cancelled', false],
				['gte', 'day', yesterday],
				['lte', 'day', end.toISOString().slice(0, 10)]
			])
		);
		const leaveCalls = fake.calls
			.filter((c) => c.table === 'session_leave_history')
			.map(({ method, args }) => [method, ...args]);
		expect(leaveCalls).toEqual(
			expect.arrayContaining([
				['eq', 'student_id', CHILD],
				['in', 'class_session_id', ['s1', 's2']]
			])
		);
	});

	it('offers Sick for yesterday and today only, shows the decision and locks a decided session', async () => {
		const today = todayInBerlin();
		const row = (id: string, day: string) => ({
			id,
			day,
			class_name: 'Alphabet',
			start_time: null,
			duration_minutes: null,
			starts_at: day === today ? future : past
		});
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: {
				class_enrollments: { data: [{ class_id: 'k1' }], error: null },
				class_sessions_effective: {
					data: [
						row('y', plusDays(today, -1)),
						row('yd', plusDays(today, -1)),
						row('t', today),
						row('n', plusDays(today, 1))
					],
					error: null
				},
				session_leave_history: {
					data: [
						{ class_session_id: 'y', answer: 'sick', classification: null },
						{ class_session_id: 'yd', answer: 'sick', classification: null }
					],
					error: null
				},
				sick_leave_decisions: {
					data: [{ class_session_id: 'yd', decision: 'rejected' }],
					error: null
				}
			}
		});
		const { sessions } = await runLoad(fake);
		expect(sessions.map((s) => [s.id, s.answer, s.decision, s.sickOpen])).toEqual([
			['y', 'sick', null, true],
			['yd', 'sick', 'rejected', false],
			['t', null, null, true],
			['n', null, null, false]
		]);
		const decisionCalls = fake.calls
			.filter((c) => c.table === 'sick_leave_decisions')
			.map(({ method, args }) => [method, ...args]);
		expect(decisionCalls).toEqual(
			expect.arrayContaining([
				['eq', 'student_id', CHILD],
				['in', 'class_session_id', ['y', 'yd', 't', 'n']]
			])
		);
	});

	it('flags a load error when the decisions cannot be read', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: { ...tables, sick_leave_decisions: { data: null, error: { message: 'boom' } } }
		});
		expect((await runLoad(fake)).loadError).toBe(true);
	});

	it('flags a load error when the answers cannot be read', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: { ...tables, session_leave_history: { data: null, error: { message: 'boom' } } }
		});
		expect((await runLoad(fake)).loadError).toBe(true);
	});

	it('a child without classes has no sessions', async () => {
		const fake = fakeSupabase({ linked: [approvedChild] });
		expect(await runLoad(fake)).toMatchObject({ sessions: [], loadError: false });
	});
});

describe('parent child leave page: actions', () => {
	it('preview asks preview_leave for this child and session', async () => {
		const fake = fakeSupabase({ rpc: { preview_leave: { data: 'planned', error: null } } });
		const result = await actions.preview(event({ sessionId: SESSION }, fake));
		expect(fake.rpc).toHaveBeenCalledWith('preview_leave', {
			p_class_session_id: SESSION,
			p_student_id: CHILD
		});
		expect(result).toEqual({ action: 'preview', sessionId: SESSION, preview: 'planned' });
	});

	it('preview refused (42501) -> 403 with the not-allowed message', async () => {
		const fake = fakeSupabase({
			rpc: { preview_leave: { data: null, error: { code: '42501' } } }
		});
		const result = await actions.preview(event({ sessionId: SESSION }, fake));
		expect(result).toMatchObject({
			status: 403,
			data: { error: m.leave_error_not_allowed(), sessionId: SESSION }
		});
	});

	it('setLeave accepts only Coming, On leave or Sick', async () => {
		const fake = fakeSupabase({});
		for (const answer of ['maybe', 'approved', '']) {
			const result = await actions.setLeave(event({ sessionId: SESSION, answer }, fake));
			expect(result).toMatchObject({ status: 400, data: { error: m.leave_error_invalid() } });
		}
		expect(fake.inserted).toEqual([]);
	});

	it('setLeave inserts Sick (the database enforces the window and any decision)', async () => {
		const fake = fakeSupabase({
			insert: { data: { answer: 'sick', classification: null }, error: null }
		});
		const result = await actions.setLeave(event({ sessionId: SESSION, answer: 'sick' }, fake));
		expect(fake.inserted).toEqual([
			{ class_session_id: SESSION, student_id: CHILD, answer: 'sick' }
		]);
		expect(result).toMatchObject({ action: 'setLeave', success: true, answer: 'sick' });
	});

	it('setLeave inserts the answer only (no classification) and reports what the database stored', async () => {
		const fake = fakeSupabase({
			insert: { data: { answer: 'on_leave', classification: 'short_notice' }, error: null }
		});
		const result = await actions.setLeave(event({ sessionId: SESSION, answer: 'on_leave' }, fake));
		expect(fake.inserted).toEqual([
			{ class_session_id: SESSION, student_id: CHILD, answer: 'on_leave' }
		]);
		expect(result).toEqual({
			action: 'setLeave',
			success: true,
			sessionId: SESSION,
			answer: 'on_leave',
			classification: 'short_notice'
		});
	});

	it.each([
		[{ code: '22023', hint: 'leave_started' }, 400, m.leave_error_started()],
		[{ code: '22023', hint: 'leave_cancelled' }, 400, m.leave_error_cancelled()],
		[{ code: '22023', hint: 'leave_not_enrolled' }, 400, m.leave_error_not_allowed()],
		[{ code: '22023', hint: 'leave_sick_closed' }, 400, m.leave_error_sick_closed()],
		[{ code: '22023', hint: 'leave_decided' }, 400, m.leave_error_decided()],
		[{ code: '42501' }, 403, m.leave_error_not_allowed()],
		[{ code: '08006' }, 400, m.leave_error_failed()]
	])('setLeave maps %o to its message', async (err, status, message) => {
		const fake = fakeSupabase({ insert: { data: null, error: err } });
		const result = await actions.setLeave(event({ sessionId: SESSION, answer: 'coming' }, fake));
		expect(result).toMatchObject({ status, data: { error: message, sessionId: SESSION } });
	});
});

describe('parent child page: deletion request (Story 7-6)', () => {
	it('shows the latest request: pending, or rejected (a new one is allowed)', async () => {
		for (const status of ['pending', 'rejected'] as const) {
			const fake = fakeSupabase({
				linked: [approvedChild],
				tables: {
					deletion_requests: {
						data: [
							{ status, requested_at: '2026-09-27T08:00:00Z' },
							{ status: 'rejected', requested_at: '2026-09-01T08:00:00Z' }
						],
						error: null
					}
				}
			});
			const result = await runLoad(fake);
			expect(result.deletion).toEqual({ status, requestedAt: '2026-09-27T08:00:00Z' });
			expect(
				fake.calls
					.filter((c) => c.table === 'deletion_requests')
					.map(({ method, args }) => [method, ...args])
			).toEqual(
				expect.arrayContaining([
					['eq', 'student_id', CHILD],
					['order', 'requested_at', { ascending: false }]
				])
			);
		}
	});

	it('no request -> null; a read error flags only the deletion card', async () => {
		const none = await runLoad(fakeSupabase({ linked: [approvedChild] }));
		expect(none).toMatchObject({ deletion: null, deletionLoadError: false, loadError: false });

		const failed = await runLoad(
			fakeSupabase({
				linked: [approvedChild],
				tables: { deletion_requests: { data: null, error: { message: 'boom' } } }
			})
		);
		expect(failed).toMatchObject({ deletion: null, deletionLoadError: true, loadError: false });
	});

	it('requestDeletion inserts only the child id (the database stamps the rest)', async () => {
		const fake = fakeSupabase({ insert: { data: { id: 'r1' }, error: null } });
		const result = await actions.requestDeletion(event({}, fake));
		expect(fake.inserted).toEqual([{ student_id: CHILD }]);
		expect(result).toEqual({ action: 'requestDeletion', success: true });
	});

	it.each([
		[{ code: '23505' }, 400, m.deletion_error_duplicate()],
		[{ code: '42501' }, 403, m.deletion_error_not_allowed()],
		[{ code: '08006' }, 400, m.deletion_error_failed()]
	])('requestDeletion maps %o to its message', async (err, status, message) => {
		const fake = fakeSupabase({ insert: { data: null, error: err } });
		const result = await actions.requestDeletion(event({}, fake));
		expect(result).toMatchObject({ status, data: { deletionError: message } });
	});
});
