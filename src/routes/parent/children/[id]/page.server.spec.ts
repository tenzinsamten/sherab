import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { addDays } from '$lib/server/student-homework';
import { actions, load } from './+page.server';

/**
 * /parent/children/[id] (Stories 7-4, 7-5, 7-6 and the detail sections): a fake `locals.supabase` with one
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
	function chain(table: string, initial: Result) {
		const c: Record<string, unknown> = {};
		let result = initial;
		// eq / in filter array rows that carry the column (so a wrong id shows
		// up in a test); rows without it pass through unchanged.
		const filter = (keep: (row: Record<string, unknown>) => boolean) => {
			if (Array.isArray(result.data)) {
				result = {
					...result,
					data: (result.data as Record<string, unknown>[]).filter((row) => keep(row))
				};
			}
		};
		// order() keys apply like the database: first key first, rows without
		// the column keep their place.
		const orderKeys: { column: string; ascending: boolean }[] = [];
		const sorted = (): Result => {
			if (!Array.isArray(result.data) || orderKeys.length === 0) return result;
			const rows = [...(result.data as Record<string, unknown>[])];
			rows.sort((a, b) => {
				for (const { column, ascending } of orderKeys) {
					if (!(column in a) || !(column in b)) continue;
					const x = String(a[column] ?? '');
					const y = String(b[column] ?? '');
					if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
				}
				return 0;
			});
			return { ...result, data: rows };
		};
		for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) {
			c[method] = (...args: unknown[]) => {
				calls.push({ table, method, args });
				if (method === 'order') {
					const options = args[1] as { ascending?: boolean } | undefined;
					orderKeys.push({ column: args[0] as string, ascending: options?.ascending ?? true });
				}
				const [column, value] = args as [string, unknown];
				if (method === 'eq') filter((row) => !(column in row) || row[column] === value);
				if (method === 'in') {
					filter((row) => !(column in row) || (value as unknown[]).includes(row[column]));
				}
				return c;
			};
		}
		c.maybeSingle = async () => {
			calls.push({ table, method: 'maybeSingle', args: [] });
			result = sorted();
			return {
				data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
				error: result.error
			};
		};
		c.insert = (row: unknown) => {
			inserted.push(row);
			const r = opts.insert ?? { data: null, error: null };
			const ic = { select: () => ic, single: async () => r };
			return ic;
		};
		c.then = (resolve: (value: Result) => unknown) => resolve(sorted());
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

type HomeworkRow = {
	instanceId: string;
	title: string;
	dueDate: string;
	status: string;
	overdue: boolean;
	referenceLinks: { url: string; label: string | null }[];
	className: string | null;
};

type LoadResult = {
	child: { id: string; name: string };
	tab: string;
	sessions: Record<string, unknown>[];
	deletion: { status: string; requestedAt: string } | null;
	deletionLoadError: boolean;
	loadError: boolean;
	streak: { currentStreak: number } | null;
	badges: { badgeType: string; milestone: number }[];
	team: { name: string; rank: number; total: number } | null;
	teamId: string | null;
	leaderboard: { teamId: string; teamName: string; totalStreak: number }[];
	homework: {
		open: HomeworkRow[];
		done: HomeworkRow[];
		donePage: number;
		donePageCount: number;
	};
	attendance: { sessionDate: string; className: string; present: boolean }[];
	skills: {
		classId: string;
		className: string | null;
		current: Record<string, { level: string }>;
		history: { id: string; notes: string | null; level: string }[];
	}[];
	teachers: { classId: string; className: string; teachers: { id: string; name: string }[] }[];
	errors: Record<string, boolean>;
};

function runLoad(
	fake: ReturnType<typeof fakeSupabase>,
	id = CHILD,
	parentStatus = 'approved',
	search = ''
) {
	return load({
		params: { id },
		url: new URL(`http://localhost/parent/children/${id}${search}`),
		parent: async () => ({ parentStatus }),
		locals: { supabase: fake.client }
	} as unknown as Parameters<typeof load>[0]) as Promise<LoadResult>;
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
		expect(result).toMatchObject({
			child: { id: CHILD, name: 'Dawa' },
			deletion: null,
			deletionLoadError: false,
			loadError: false,
			// Ordered by day, as the database returns them.
			sessions: [
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
				},
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
				}
			]
		});

		const today = todayInBerlin();
		const yesterday = addDays(today, -1);
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
				['in', 'class_session_id', ['s2', 's1']]
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
						row('y', addDays(today, -1)),
						row('yd', addDays(today, -1)),
						row('t', today),
						row('n', addDays(today, 1))
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

describe('parent child page: leave period (B11, #57)', () => {
	const CLASS = '99999999-8888-4777-8666-555555555555';
	const from = addDays(todayInBerlin(), 10);
	const to = addDays(todayInBerlin(), 24);
	const enrolled = {
		class_enrollments: { data: [{ class_id: CLASS, student_id: CHILD }], error: null }
	};
	const rows = [
		{
			session_id: 's1',
			day: from,
			class_id: CLASS,
			class_name: 'Alphabet',
			outcome: 'short_notice'
		},
		{ session_id: 's2', day: to, class_id: CLASS, class_name: 'Alphabet', outcome: 'planned' },
		{ session_id: 's3', day: to, class_id: CLASS, class_name: 'Alphabet', outcome: 'started' }
	];
	const mapped = rows.map((r) => ({
		sessionId: r.session_id,
		day: r.day,
		classId: r.class_id,
		className: r.class_name,
		outcome: r.outcome
	}));

	it('previewLeaveRange asks preview_leave_range for this child (all classes) and maps the rows', async () => {
		const fake = fakeSupabase({ rpc: { preview_leave_range: { data: rows, error: null } } });
		const result = await actions.previewLeaveRange(
			event({ from, to, classId: 'all', answer: 'on_leave' }, fake)
		);
		expect(fake.rpc).toHaveBeenCalledWith('preview_leave_range', {
			p_student: CHILD,
			p_from: from,
			p_to: to,
			p_class: null,
			p_answer: 'on_leave'
		});
		expect(result).toEqual({
			action: 'previewLeaveRange',
			range: { from, to, classId: null, answer: 'on_leave' },
			rows: mapped,
			listEnd: addDays(todayInBerlin(), 84)
		});
	});

	it("previewLeaveRange with one of the child's classes passes it on", async () => {
		const fake = fakeSupabase({
			tables: enrolled,
			rpc: { preview_leave_range: { data: [], error: null } }
		});
		const result = await actions.previewLeaveRange(
			event({ from, to, classId: CLASS, answer: 'coming' }, fake)
		);
		expect(fake.rpc).toHaveBeenCalledWith(
			'preview_leave_range',
			expect.objectContaining({ p_class: CLASS, p_answer: 'coming' })
		);
		expect(result).toMatchObject({ action: 'previewLeaveRange', rows: [] });
		expect(
			fake.calls
				.filter((c) => c.table === 'class_enrollments' && c.method === 'eq')
				.map((c) => c.args)
		).toEqual([
			['student_id', CHILD],
			['class_id', CLASS]
		]);
	});

	it.each([
		['a class the child is not in', { classId: '12345678-1234-4234-8234-123456789012' }, 'class'],
		['a malformed class id', { classId: 'nope' }, 'class'],
		['a missing answer', { answer: '' }, 'answer'],
		['Sick as the answer', { answer: 'sick' }, 'answer'],
		['a malformed date', { from: '2026-13-01' }, 'dates'],
		['a missing end', { to: '' }, 'dates'],
		['a start in the past', { from: addDays(todayInBerlin(), -1) }, 'dates'],
		['an end before the start', { to: addDays(from, -1) }, 'dates'],
		['more than 26 weeks (to - from = 182)', { to: addDays(from, 182) }, 'dates']
	] as const)('refuses %s without calling the database', async (_label, override, field) => {
		const fake = fakeSupabase({ tables: enrolled });
		for (const action of [actions.previewLeaveRange, actions.setLeaveRange]) {
			const result = await action(
				event({ from, to, classId: 'all', answer: 'on_leave', ...override }, fake)
			);
			expect(result).toMatchObject({ status: 400, data: { rangeField: field } });
		}
		expect(fake.rpc).not.toHaveBeenCalled();
	});

	it('the error messages match the field', async () => {
		const fake = fakeSupabase({ tables: enrolled });
		const dates = await actions.previewLeaveRange(
			event({ from, to: addDays(from, 182), classId: 'all', answer: 'on_leave' }, fake)
		);
		expect(dates).toMatchObject({
			data: {
				rangeError: m.leave_range_error_invalid(),
				range: { from, to: addDays(from, 182), classId: null, answer: 'on_leave' }
			}
		});
		const answer = await actions.previewLeaveRange(
			event({ from, to, classId: 'all', answer: 'maybe' }, fake)
		);
		expect(answer).toMatchObject({ data: { rangeError: m.leave_range_error_answer() } });
		const cls = await actions.previewLeaveRange(
			event({ from, to, classId: 'nope', answer: 'on_leave' }, fake)
		);
		expect(cls).toMatchObject({ data: { rangeError: m.leave_range_error_class() } });
	});

	it('26 weeks including both dates (to - from = 181) is allowed', async () => {
		const fake = fakeSupabase({ rpc: { preview_leave_range: { data: [], error: null } } });
		const result = await actions.previewLeaveRange(
			event({ from, to: addDays(from, 181), classId: 'all', answer: 'on_leave' }, fake)
		);
		expect(result).toMatchObject({ action: 'previewLeaveRange' });
	});

	it('setLeaveRange calls set_leave_range and counts the changed sessions', async () => {
		const fake = fakeSupabase({ rpc: { set_leave_range: { data: rows, error: null } } });
		const result = await actions.setLeaveRange(
			event({ from, to, classId: 'all', answer: 'on_leave' }, fake)
		);
		expect(fake.rpc).toHaveBeenCalledWith('set_leave_range', {
			p_student: CHILD,
			p_from: from,
			p_to: to,
			p_class: null,
			p_answer: 'on_leave'
		});
		expect(result).toEqual({
			action: 'setLeaveRange',
			success: true,
			range: { from, to, classId: null, answer: 'on_leave' },
			rows: mapped,
			changed: 2,
			skipped: 1
		});
	});

	it('setLeaveRange counts Coming as a change on undo', async () => {
		const fake = fakeSupabase({
			rpc: {
				set_leave_range: {
					data: [
						{ ...rows[0], outcome: 'coming' },
						{ ...rows[1], outcome: 'already_coming' }
					],
					error: null
				}
			}
		});
		const result = await actions.setLeaveRange(
			event({ from, to, classId: 'all', answer: 'coming' }, fake)
		);
		expect(result).toMatchObject({ success: true, changed: 1, skipped: 1 });
	});

	it.each([
		[{ code: '42501' }, 403, m.leave_error_not_allowed(), null],
		[{ code: '22023', hint: 'leave_range_invalid' }, 400, m.leave_range_error_invalid(), 'dates'],
		[{ code: '08006' }, 400, m.leave_range_error_failed(), null]
	])('maps %o to its message', async (err, status, message, field) => {
		for (const [action, fn] of [
			[actions.previewLeaveRange, 'preview_leave_range'],
			[actions.setLeaveRange, 'set_leave_range']
		] as const) {
			const fake = fakeSupabase({ rpc: { [fn]: { data: null, error: err } } });
			const result = await action(event({ from, to, classId: 'all', answer: 'on_leave' }, fake));
			expect(result).toMatchObject({
				status,
				data: { rangeError: message, rangeField: field, range: { from, to } }
			});
		}
	});

	it('the load offers the child classes for the period', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: {
				...enrolled,
				classes: { data: [{ id: CLASS, name: 'Alphabet' }], error: null }
			}
		});
		const result = (await runLoad(fake)) as LoadResult & {
			rangeClasses: unknown;
			rangeLoadError: boolean;
		};
		expect(result.rangeClasses).toEqual([{ id: CLASS, name: 'Alphabet' }]);
		expect(result.rangeLoadError).toBe(false);
	});

	it('a failed class read flags the period card instead of hiding it', async () => {
		const fake = fakeSupabase({
			linked: [approvedChild],
			tables: { ...enrolled, classes: { data: null, error: { message: 'boom' } } }
		});
		const result = (await runLoad(fake)) as LoadResult & {
			rangeClasses: unknown;
			rangeLoadError: boolean;
		};
		expect(result).toMatchObject({ rangeClasses: [], rangeLoadError: true });
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

describe('parent child page: detail sections', () => {
	const SIBLING = '99999999-8888-4777-8666-555555555555';
	const today = todayInBerlin();
	const at = (n: number) => `2026-09-${String(n).padStart(2, '0')}T08:00:00Z`;

	type HistoryRow = { instance: string; student: string; status: string; at: string };

	function history(rows: HistoryRow[]) {
		return rows.map((r, i) => ({
			id: String(i + 1).padStart(4, '0'),
			instance_id: r.instance,
			student_id: r.student,
			status: r.status,
			recorded_by: null,
			recorded_at: r.at
		}));
	}

	function instance(id: string, due: string) {
		return { id, assignment_id: `a-${id}`, class_id: 'k1', due_date: due, archived_at: null };
	}

	function assignment(instanceId: string, links: unknown = []) {
		return {
			id: `a-${instanceId}`,
			title: `Homework ${instanceId}`,
			skill_area: 'language',
			content: null,
			content_language: 'en',
			reference_links: links,
			recurrence_rule: null
		};
	}

	const LINK = { url: 'https://example.org/song', label: 'Song' };

	/**
	 * Open: i1 (overdue), i2; Done: i3; Reviewed: i4; the sibling's i5 and its
	 * own i1 Done. Class k2 (not enrolled): i6 still open (hidden), i7 Done.
	 */
	function fullTables(): Record<string, Result> {
		return {
			class_enrollments: { data: [{ class_id: 'k1', student_id: CHILD }], error: null },
			classes: { data: [{ id: 'k1', name: 'Alphabet' }], error: null },
			homework_status_history: {
				data: history([
					{ instance: 'i1', student: CHILD, status: 'assigned', at: at(1) },
					{ instance: 'i2', student: CHILD, status: 'assigned', at: at(1) },
					{ instance: 'i3', student: CHILD, status: 'assigned', at: at(1) },
					{ instance: 'i3', student: CHILD, status: 'done', at: at(10) },
					{ instance: 'i4', student: CHILD, status: 'assigned', at: at(1) },
					{ instance: 'i4', student: CHILD, status: 'done', at: at(5) },
					{ instance: 'i4', student: CHILD, status: 'reviewed', at: at(6) },
					{ instance: 'i1', student: SIBLING, status: 'assigned', at: at(1) },
					{ instance: 'i1', student: SIBLING, status: 'done', at: at(2) },
					{ instance: 'i5', student: SIBLING, status: 'assigned', at: at(1) },
					{ instance: 'i6', student: CHILD, status: 'assigned', at: at(1) },
					{ instance: 'i7', student: CHILD, status: 'assigned', at: at(1) },
					{ instance: 'i7', student: CHILD, status: 'done', at: at(8) }
				]),
				error: null
			},
			homework_instances: {
				data: [
					instance('i1', addDays(today, -1)),
					instance('i2', addDays(today, 3)),
					instance('i3', addDays(today, -7)),
					instance('i4', addDays(today, -14)),
					instance('i5', addDays(today, 1)),
					{ ...instance('i6', addDays(today, 1)), class_id: 'k2' },
					{ ...instance('i7', addDays(today, -3)), class_id: 'k2' }
				],
				error: null
			},
			homework_assignments: {
				data: [
					assignment('i1'),
					assignment('i2', [LINK]),
					assignment('i3'),
					assignment('i4'),
					assignment('i5'),
					assignment('i6'),
					assignment('i7')
				],
				error: null
			},
			student_streaks: {
				data: [
					{ student_id: SIBLING, current_streak: 9, last_qualifying_week: '2026-09-14' },
					{ student_id: CHILD, current_streak: 3, last_qualifying_week: '2026-09-21' }
				],
				error: null
			},
			badges_earned: {
				data: [
					{ student_id: CHILD, badge_type: 'homework', milestone: 5, earned_at: at(3) },
					{ student_id: SIBLING, badge_type: 'attendance', milestone: 10, earned_at: at(3) }
				],
				error: null
			},
			profiles: {
				data: [
					{ id: SIBLING, team_id: 't1' },
					{ id: CHILD, team_id: 't2' }
				],
				error: null
			},
			// Oldest first: the load's order() must put the newest first.
			skill_status_history: {
				data: [
					{
						id: 'sk1',
						student_id: CHILD,
						class_id: 'k1',
						skill_area: 'language',
						level: 'learning',
						notes: null,
						recorded_at: at(2)
					},
					{
						id: 'sk2',
						student_id: CHILD,
						class_id: 'k2',
						skill_area: 'dance',
						level: 'learning',
						notes: null,
						recorded_at: at(4)
					},
					{
						id: 'sk9',
						student_id: SIBLING,
						class_id: 'k1',
						skill_area: 'song',
						level: 'learning',
						notes: 'Sibling note',
						recorded_at: at(15)
					},
					{
						id: 'sk3',
						student_id: CHILD,
						class_id: 'k1',
						skill_area: 'language',
						level: 'confident',
						notes: 'Reads fluently',
						recorded_at: at(20)
					}
				],
				error: null
			}
		};
	}

	const fullRpc: Record<string, Result> = {
		team_leaderboard: {
			data: [
				{ team_id: 't1', team_name: 'Snow Lions', total_streak: 9 },
				{ team_id: 't2', team_name: 'Yaks', total_streak: 4 }
			],
			error: null
		},
		child_attendance: {
			data: [
				{ session_date: '2026-09-20', class_id: 'k1', class_name: 'Alphabet', present: true },
				{ session_date: '2026-09-13', class_id: 'k1', class_name: 'Alphabet', present: false }
			],
			error: null
		},
		class_people: {
			data: [{ person_id: 'tch', display_name: 'Pema', is_teacher: true }],
			error: null
		}
	};

	const linked = [approvedChild, { id: SIBLING, name: 'Tashi', status: 'approved' }];

	it('full child: every section filled, Open with 1 overdue, notes shown', async () => {
		const fake = fakeSupabase({ linked, tables: fullTables(), rpc: fullRpc });
		const result = await runLoad(fake);

		expect(result.errors).toEqual({
			summary: false,
			team: false,
			open: false,
			done: false,
			attendance: false,
			skills: false,
			teachers: false
		});
		expect(result.homework.open.map((h) => [h.instanceId, h.overdue, h.className])).toEqual([
			['i1', true, 'Alphabet'],
			['i2', false, 'Alphabet']
		]);
		expect(result.homework.done.map((h) => [h.instanceId, h.status, h.className])).toEqual([
			['i3', 'done', 'Alphabet'],
			['i7', 'done', null],
			['i4', 'reviewed', 'Alphabet']
		]);
		expect(result.streak).toMatchObject({ currentStreak: 3 });
		expect(result.badges).toEqual([{ badgeType: 'homework', milestone: 5, earnedAt: at(3) }]);
		expect(result.team).toEqual({ name: 'Yaks', rank: 2, total: 2 });
		expect(result.teamId).toBe('t2');
		expect(result.leaderboard.map((t) => t.teamName)).toEqual(['Snow Lions', 'Yaks']);
		expect(result.attendance).toEqual([
			{ sessionDate: '2026-09-20', classId: 'k1', className: 'Alphabet', present: true },
			{ sessionDate: '2026-09-13', classId: 'k1', className: 'Alphabet', present: false }
		]);
		expect(result.attendance[0]).not.toHaveProperty('notes');
		expect(result.skills.map((k) => [k.classId, k.className])).toEqual([
			['k1', 'Alphabet'],
			['k2', null]
		]);
		expect(result.skills[0].current.language.level).toBe('confident');
		expect(result.skills[0].history.map((h) => [h.id, h.notes])).toEqual([
			['sk3', 'Reads fluently'],
			['sk1', null]
		]);
		expect(result.teachers).toEqual([
			{ classId: 'k1', className: 'Alphabet', teachers: [{ id: 'tch', name: 'Pema' }] }
		]);

		expect(fake.rpc).toHaveBeenCalledWith('child_attendance', { p_student_id: CHILD });
		expect(fake.rpc).toHaveBeenCalledWith('class_people', { p_class_id: 'k1' });
	});

	it('still enrolled: open homework from a class the child left is hidden', async () => {
		const fake = fakeSupabase({ linked, tables: fullTables(), rpc: fullRpc });
		const { homework } = await runLoad(fake);
		expect(homework.open.map((h) => h.instanceId)).not.toContain('i6');
	});

	it('links: reference links come through for external anchors', async () => {
		const fake = fakeSupabase({ linked, tables: fullTables(), rpc: fullRpc });
		const { homework } = await runLoad(fake);
		expect(homework.open.find((h) => h.instanceId === 'i2')?.referenceLinks).toEqual([LINK]);
	});

	it("sibling isolation: only this child's homework, skills and summary", async () => {
		const fake = fakeSupabase({ linked, tables: fullTables(), rpc: fullRpc });
		const result = await runLoad(fake);
		const ids = [...result.homework.open, ...result.homework.done].map((h) => h.instanceId);
		expect(ids).not.toContain('i5');
		// The sibling's Done on i1 does not finish it for this child.
		expect(result.homework.open.map((h) => h.instanceId)).toContain('i1');
		expect(result.skills.flatMap((s) => s.history.map((h) => h.id))).not.toContain('sk9');
		expect(result.streak).toMatchObject({ currentStreak: 3 });

		for (const table of ['skill_status_history', 'student_streaks', 'badges_earned']) {
			expect(
				fake.calls.filter((c) => c.table === table && c.method === 'eq').map(({ args }) => args)
			).toContainEqual(['student_id', CHILD]);
		}
		expect(
			fake.calls.filter((c) => c.table === 'profiles' && c.method === 'eq').map(({ args }) => args)
		).toContainEqual(['id', CHILD]);
	});

	it('empty child: every section empty, no errors', async () => {
		const fake = fakeSupabase({ linked: [approvedChild] });
		const result = await runLoad(fake);
		expect(result).toMatchObject({
			tab: 'overview',
			streak: null,
			badges: [],
			team: null,
			teamId: null,
			leaderboard: [],
			homework: { open: [], done: [], donePage: 1, donePageCount: 1 },
			attendance: [],
			skills: [],
			teachers: []
		});
		expect(Object.values(result.errors).every((e) => e === false)).toBe(true);
	});

	describe('paging', () => {
		// 12 Done items, finished on days 1..12 (newest first: d12 .. d1).
		function pagingTables(): Record<string, Result> {
			const rows: HistoryRow[] = [];
			const instances = [];
			const assignments = [];
			for (let n = 1; n <= 12; n++) {
				rows.push({ instance: `d${n}`, student: CHILD, status: 'assigned', at: at(1) });
				rows.push({ instance: `d${n}`, student: CHILD, status: 'done', at: at(n) });
				instances.push(instance(`d${n}`, addDays(today, -30)));
				assignments.push(assignment(`d${n}`));
			}
			return {
				class_enrollments: { data: [{ class_id: 'k1', student_id: CHILD }], error: null },
				classes: { data: [{ id: 'k1', name: 'Alphabet' }], error: null },
				homework_status_history: { data: history(rows), error: null },
				homework_instances: { data: instances, error: null },
				homework_assignments: { data: assignments, error: null }
			};
		}

		it('?tab=homework&done=2 lists items 11-12', async () => {
			const fake = fakeSupabase({ linked: [approvedChild], tables: pagingTables() });
			const { homework, tab } = await runLoad(fake, CHILD, 'approved', '?tab=homework&done=2');
			expect(tab).toBe('homework');
			expect(homework).toMatchObject({ donePage: 2, donePageCount: 2 });
			expect(homework.done.map((h) => h.instanceId)).toEqual(['d2', 'd1']);
		});

		it.each(['abc', '0', '-1', '1.5', ''])('an invalid page (%s) is page 1', async (done) => {
			const fake = fakeSupabase({ linked: [approvedChild], tables: pagingTables() });
			const { homework } = await runLoad(fake, CHILD, 'approved', `?tab=homework&done=${done}`);
			expect(homework.donePage).toBe(1);
			expect(homework.done).toHaveLength(10);
			expect(homework.done[0].instanceId).toBe('d12');
		});
	});

	it('section failure: a skill read error flags only the skills section', async () => {
		const fake = fakeSupabase({
			linked,
			tables: { ...fullTables(), skill_status_history: { data: null, error: { message: 'boom' } } },
			rpc: fullRpc
		});
		const result = await runLoad(fake);
		expect(result.errors).toEqual({
			summary: false,
			team: false,
			open: false,
			done: false,
			attendance: false,
			skills: true,
			teachers: false
		});
		expect(result.skills).toEqual([]);
		expect(result.attendance).toHaveLength(2);
		expect(result.homework.open).toHaveLength(2);
		expect(result.loadError).toBe(false);
	});

	it('section failure: attendance and leaderboard errors stay in their sections', async () => {
		const fake = fakeSupabase({
			linked,
			tables: fullTables(),
			rpc: {
				...fullRpc,
				child_attendance: { data: null, error: { code: '42501' } },
				team_leaderboard: { data: null, error: { message: 'boom' } }
			}
		});
		const result = await runLoad(fake);
		expect(result.errors).toMatchObject({ attendance: true, team: true, skills: false });
		expect(result).toMatchObject({ attendance: [], leaderboard: [], team: null });
	});

	const boom = { data: null, error: { message: 'boom' } };
	it.each([
		['student_streaks', 'table', ['summary']],
		['badges_earned', 'table', ['summary']],
		['profiles', 'table', ['team']],
		['class_people', 'rpc', ['teachers']],
		['homework_status_history', 'table', ['open', 'done']],
		['classes', 'table', ['open', 'done', 'skills', 'teachers']]
	] as const)('section failure: %s (%s) flags %o only', async (name, kind, flagged) => {
		const fake = fakeSupabase({
			linked,
			tables: kind === 'table' ? { ...fullTables(), [name]: boom } : fullTables(),
			rpc: kind === 'rpc' ? { ...fullRpc, [name]: boom } : fullRpc
		});
		const { errors } = await runLoad(fake);
		for (const [section, value] of Object.entries(errors)) {
			expect([section, value]).toEqual([section, (flagged as readonly string[]).includes(section)]);
		}
	});

	it.each([
		['?tab=record', 'record'],
		['?tab=sessions', 'sessions'],
		['?tab=homework', 'homework'],
		['?tab=bogus', 'overview'],
		['', 'overview']
	])('tabs: %s -> %s', async (search, tab) => {
		const fake = fakeSupabase({ linked: [approvedChild] });
		expect((await runLoad(fake, CHILD, 'approved', search)).tab).toBe(tab);
	});
});
