import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { actions, load } from './+page.server';

/**
 * /calendar actions (Stories 6-1, 6-4): FormData event + a fake
 * `locals.supabase` chain, one queued result per table. `upserted` records
 * the rows addClassDays sent, `rpcCalls` every function call (answered with
 * `rpcResult`).
 */
type Result = { data?: unknown; error: unknown };

/** One filter or order call on a query, e.g. `['eq', 'student_id', 'u1']`. */
type Call = [string, ...unknown[]];

function fakeSupabase(
	/** One result per table, or a queue: each query on the table takes the next. */
	results: Record<string, Result | Result[]>,
	role = 'admin',
	rpcResult: { data?: unknown; error: unknown } = { error: null },
	/** When set, no query answers until it resolves (round-count tests). */
	gate?: Promise<void>
) {
	const upserted: unknown[] = [];
	const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
	const tablesRead: string[] = [];
	/** Each query's table (or `rpc:<fn>`) in the order it was sent. */
	const started: string[] = [];
	/** The filter calls made on each table's queries. */
	const queries: { table: string; calls: Call[] }[] = [];
	const answer = async <T>(value: T) => {
		if (gate) await gate;
		return value;
	};
	function chain(table: string, result: Result) {
		const calls: Call[] = [];
		queries.push({ table, calls });
		const record =
			(name: string) =>
			(...args: unknown[]) => {
				calls.push([name, ...args]);
				return c;
			};
		const c = {
			select: record('select'),
			eq: record('eq'),
			in: record('in'),
			is: record('is'),
			gte: record('gte'),
			lte: record('lte'),
			order: record('order'),
			maybeSingle: () => c,
			update: record('update'),
			delete: record('delete'),
			upsert: (rows: unknown[]) => {
				upserted.push(...rows);
				return c;
			},
			then: (resolve: (value: Result) => unknown, reject?: (e: unknown) => unknown) => {
				started.push(table);
				return answer(result).then(resolve, reject);
			}
		};
		return c;
	}
	function nextResult(table: string): Result {
		const entry = results[table];
		if (Array.isArray(entry)) return entry.shift() ?? { data: [], error: null };
		return entry ?? { data: [], error: null };
	}
	return {
		upserted,
		rpcCalls,
		tablesRead,
		started,
		queries,
		client: {
			from: (table: string) => {
				tablesRead.push(table);
				return chain(
					table,
					table === 'profiles' ? { data: { role }, error: null } : nextResult(table)
				);
			},
			rpc: async (fn: string, args: Record<string, unknown>) => {
				rpcCalls.push({ fn, args });
				started.push(`rpc:${fn}`);
				return answer(rpcResult);
			}
		}
	};
}

function event(
	fields: Record<string, string | string[]>,
	supabase: ReturnType<typeof fakeSupabase>['client']
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const value of Array.isArray(v) ? v : [v]) body.append(k, value);
	}
	return {
		request: new Request('http://localhost/calendar', { method: 'POST', body }),
		locals: {
			supabase,
			safeGetSession: async () => ({ user: { id: 'u1' } })
		}
	} as unknown as Parameters<typeof actions.addClassDays>[0];
}

describe('calendar load', () => {
	it('maps each class row to its schedule, the repeat interval included (issue #51)', async () => {
		const fake = fakeSupabase({
			classes: {
				data: [
					{
						id: 'c1',
						name: 'Grammar',
						default_start_time: '10:00:00',
						default_duration_minutes: 90,
						schedule_weekdays: [7, 3],
						schedule_starts_on: '2026-10-01',
						schedule_ends_on: null,
						schedule_interval_weeks: 2
					}
				],
				error: null
			}
		});
		const result = (await load({
			url: new URL('http://localhost/calendar'),
			parent: async () => ({ profile: { role: 'admin' } }),
			locals: {
				supabase: fake.client,
				safeGetSession: async () => ({ user: { id: 'u1' } })
			}
		} as unknown as Parameters<typeof load>[0])) as {
			classSchedules: { intervalWeeks: number; weekdays: number[] }[];
		};
		expect(result.classSchedules).toHaveLength(1);
		expect(result.classSchedules[0].intervalWeeks).toBe(2);
		expect(result.classSchedules[0].weekdays).toEqual([3, 7]);
	});
});

describe('calendar load: leave answers (Story 7-4)', () => {
	const sessionRow = {
		id: 's1',
		class_id: 'c1',
		class_name: 'Grammar',
		class_day_id: 'd1',
		start_time: '10:00:00',
		duration_minutes: 90,
		start_time_override: null,
		duration_minutes_override: null,
		session_cancelled: false,
		day_cancelled: false,
		extra: false
	};

	function runLoad(role: string, fake: ReturnType<typeof fakeSupabase>) {
		return load({
			url: new URL('http://localhost/calendar'),
			parent: async () => ({ profile: { role } }),
			locals: {
				supabase: fake.client,
				safeGetSession: async () => ({ user: { id: 'u1' } })
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<{
			leaveAnswers: Record<string, string>;
			loadError: boolean;
		}>;
	}

	it('a student gets their own current answer per session (newest row wins), sick included', async () => {
		const fake = fakeSupabase(
			{
				class_sessions_effective: {
					data: [sessionRow, { ...sessionRow, id: 's2' }],
					error: null
				},
				session_leave_history: {
					data: [
						{ class_session_id: 's1', answer: 'coming' },
						{ class_session_id: 's1', answer: 'on_leave' },
						{ class_session_id: 's2', answer: 'sick' }
					],
					error: null
				}
			},
			'student'
		);
		const result = await runLoad('student', fake);
		expect(result.leaveAnswers).toEqual({ s1: 'coming', s2: 'sick' });
		expect(result.loadError).toBe(false);
	});

	it('other roles do not read leave answers', async () => {
		const fake = fakeSupabase({
			class_sessions_effective: { data: [sessionRow], error: null }
		});
		const result = await runLoad('teacher', fake);
		expect(result.leaveAnswers).toEqual({});
		expect(fake.tablesRead).not.toContain('session_leave_history');
	});

	it('a failed leave read is a load error', async () => {
		const fake = fakeSupabase(
			{
				class_sessions_effective: { data: [sessionRow], error: null },
				session_leave_history: { data: null, error: { message: 'boom' } }
			},
			'student'
		);
		expect((await runLoad('student', fake)).loadError).toBe(true);
	});
});

describe('calendar load: parent view (#58)', () => {
	const session = (id: string, classId: string, extra: Record<string, unknown> = {}) => ({
		id,
		class_id: classId,
		class_name: classId === 'yaks' ? 'Yaks' : 'Snow Lions',
		class_day_id: 'd1',
		start_time: '10:00:00',
		duration_minutes: 60,
		start_time_override: null,
		duration_minutes_override: null,
		session_cancelled: false,
		day_cancelled: false,
		extra: false,
		...extra
	});
	const day = { id: 'd1', day: '2026-10-05', cancelled: false };
	const linked = [
		{ id: 'a', name: 'Anna', status: 'approved' },
		{ id: 'b', name: 'Bodhi', status: 'approved' },
		{ id: 'p', name: 'Pema', status: 'pending' }
	];

	type ParentResult = {
		days: { sessions: { id: string; status: string }[] }[];
		children: { id: string; name: string }[];
		selectedChild: string | null;
		childAnswers: Record<string, { childId: string; name: string; answer: string | null }[]>;
		canEdit: boolean;
		loadError: boolean;
	};

	function runParent(
		results: Record<string, Result>,
		children: unknown[] = linked,
		query = '',
		rpcError: unknown = null
	): Promise<ParentResult> {
		const fake = fakeSupabase({ class_days: { data: [day], error: null }, ...results }, 'parent', {
			data: rpcError ? null : children,
			error: rpcError
		});
		return load({
			url: new URL(`http://localhost/calendar?month=2026-10${query}`),
			parent: async () => ({ profile: { role: 'parent' } }),
			locals: {
				supabase: fake.client,
				safeGetSession: async () => ({ user: { id: 'parent1' } })
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<ParentResult>;
	}

	const sessionIds = (r: ParentResult) => r.days.flatMap((d) => d.sessions.map((s) => s.id));

	it('two children in the same class: each listed with their current answer', async () => {
		const result = await runParent({
			class_sessions_effective: { data: [session('s1', 'yaks')], error: null },
			class_enrollments: {
				data: [
					{ class_id: 'yaks', student_id: 'a' },
					{ class_id: 'yaks', student_id: 'b' }
				],
				error: null
			},
			session_leave_history: {
				data: [
					{ class_session_id: 's1', student_id: 'a', answer: 'on_leave' },
					{ class_session_id: 's1', student_id: 'a', answer: 'coming' }
				],
				error: null
			}
		});
		expect(result.childAnswers.s1).toEqual([
			{ childId: 'a', name: 'Anna', answer: 'on_leave' },
			{ childId: 'b', name: 'Bodhi', answer: null }
		]);
		expect(result.canEdit).toBe(false);
		expect(result.loadError).toBe(false);
	});

	const twoClasses = {
		class_sessions_effective: {
			data: [session('s1', 'yaks'), session('s2', 'lions'), session('s3', 'other')],
			error: null
		},
		class_enrollments: {
			data: [
				{ class_id: 'yaks', student_id: 'a' },
				{ class_id: 'lions', student_id: 'b' }
			],
			error: null
		},
		session_leave_history: {
			data: [{ class_session_id: 's2', student_id: 'b', answer: 'sick' }],
			error: null
		}
	};

	it('different classes: all children shows both; other classes are dropped; Sick stays Sick', async () => {
		const result = await runParent(twoClasses);
		expect(sessionIds(result).sort()).toEqual(['s1', 's2']);
		expect(result.selectedChild).toBeNull();
		expect(result.childAnswers.s1).toEqual([{ childId: 'a', name: 'Anna', answer: null }]);
		expect(result.childAnswers.s2).toEqual([{ childId: 'b', name: 'Bodhi', answer: 'sick' }]);
	});

	it('?child= narrows to that child', async () => {
		const result = await runParent(twoClasses, linked, '&child=a');
		expect(result.selectedChild).toBe('a');
		expect(sessionIds(result)).toEqual(['s1']);
		expect(result.childAnswers.s2).toBeUndefined();
	});

	it.each(['&child=someone-else', '&child=p'])(
		'an invalid %s is the all-children view',
		async (q) => {
			const result = await runParent(twoClasses, linked, q);
			expect(result.selectedChild).toBeNull();
			expect(sessionIds(result).sort()).toEqual(['s1', 's2']);
		}
	);

	it('a pending child is neither listed nor their classes shown', async () => {
		const result = await runParent(
			{
				class_sessions_effective: {
					data: [session('s1', 'yaks'), session('s2', 'lions')],
					error: null
				},
				class_enrollments: {
					data: [
						{ class_id: 'yaks', student_id: 'a' },
						{ class_id: 'lions', student_id: 'p' }
					],
					error: null
				}
			},
			[linked[0], linked[2]]
		);
		expect(result.children).toEqual([{ id: 'a', name: 'Anna' }]);
		expect(sessionIds(result)).toEqual(['s1']);
	});

	it('no approved children: no sessions, no children', async () => {
		const result = await runParent(
			{ class_sessions_effective: { data: [session('s1', 'yaks')], error: null } },
			[linked[2]]
		);
		expect(result.children).toEqual([]);
		expect(sessionIds(result)).toEqual([]);
		expect(result.loadError).toBe(false);
	});

	it('a cancelled session is shaped as cancelled (the page lists no answers for it)', async () => {
		const result = await runParent({
			class_sessions_effective: {
				data: [session('s1', 'yaks', { session_cancelled: true })],
				error: null
			},
			class_enrollments: { data: [{ class_id: 'yaks', student_id: 'a' }], error: null }
		});
		expect(result.days[0].sessions[0].status).toBe('cancelled');
		expect(result.childAnswers.s1).toBeUndefined();
	});

	it('a failed linked_children read is a load error with no children', async () => {
		const result = await runParent(twoClasses, linked, '', { message: 'boom' });
		expect(result.loadError).toBe(true);
		expect(result.children).toEqual([]);
	});

	it('a failed class_enrollments read is a load error', async () => {
		const result = await runParent({
			...twoClasses,
			class_enrollments: { data: null, error: { message: 'boom' } }
		});
		expect(result.loadError).toBe(true);
	});

	it('a failed leave history read is a load error', async () => {
		const result = await runParent({
			...twoClasses,
			session_leave_history: { data: null, error: { message: 'boom' } }
		});
		expect(result.loadError).toBe(true);
		expect(sessionIds(result).sort()).toEqual(['s1', 's2']);
	});
});

describe('calendar actions', () => {
	it.each([
		['setClassDayCancelled', { dayId: 'd1', cancelled: 'true' }, 'class_days'],
		[
			'updateSession',
			{ sessionId: 's1', startTime: '11:00', durationMinutes: '' },
			'class_sessions'
		],
		['setSessionCancelled', { sessionId: 's1', cancelled: 'true' }, 'class_sessions']
	] as const)(
		'%s: a zero-row (RLS-denied) update returns fail(400)',
		async (name, fields, table) => {
			const { client } = fakeSupabase({ [table]: { data: [], error: null } });
			const result = await actions[name](event(fields, client));
			expect(result).toMatchObject({ status: 400, data: { error: m.calendar_error_failed() } });
		}
	);

	it('addClassDays with an empty endDate adds exactly one date', async () => {
		const fake = fakeSupabase({ class_days: { data: [{ day: '2026-10-04' }], error: null } });
		const result = await actions.addClassDays(
			event({ startDate: '2026-10-04', endDate: '' }, fake.client)
		);
		expect(fake.upserted).toEqual([{ day: '2026-10-04' }]);
		expect(result).toMatchObject({ success: true, added: 1, existed: 0 });
	});

	it('addClassDays maps end-before-start and more than one year to their messages', async () => {
		const { client } = fakeSupabase({});
		expect(
			await actions.addClassDays(event({ startDate: '2026-10-25', endDate: '2026-10-04' }, client))
		).toMatchObject({ status: 400, data: { addDaysError: m.calendar_error_end_before_start() } });
		expect(
			await actions.addClassDays(event({ startDate: '2026-10-04', endDate: '2027-10-11' }, client))
		).toMatchObject({ status: 400, data: { addDaysError: m.calendar_error_range_too_long() } });
	});

	it('addClassDays counts dates that already existed', async () => {
		const fake = fakeSupabase({
			class_days: {
				data: [{ day: '2026-10-04' }, { day: '2026-10-18' }, { day: '2026-10-25' }],
				error: null
			}
		});
		const result = await actions.addClassDays(
			event({ startDate: '2026-10-04', endDate: '2026-10-25' }, fake.client)
		);
		expect(fake.upserted).toHaveLength(4);
		expect(result).toMatchObject({ success: true, added: 3, existed: 1 });
	});

	it('addClassDays refuses a non-admin before touching dates', async () => {
		const fake = fakeSupabase({}, 'teacher');
		const result = await actions.addClassDays(
			event({ startDate: '2026-10-04', endDate: '2026-10-25' }, fake.client)
		);
		expect(result).toMatchObject({ status: 403, data: { error: m.calendar_error_failed() } });
		expect(fake.upserted).toEqual([]);
	});
});

describe('class day move and delete (#105)', () => {
	const dbError = (code: string) => ({ data: null, error: { code, message: 'refused' } });

	/** The read of the day's current date, then the update's result. */
	const moveResults = (update: Result): Result[] => [
		{ data: { day: '2026-11-08' }, error: null },
		update
	];

	it('moveClassDay updates the day to the new date and reports dayMoved', async () => {
		const fake = fakeSupabase({
			class_days: moveResults({ data: [{ id: 'd1' }], error: null })
		});
		const result = await actions.moveClassDay(
			event({ dayId: 'd1', newDate: '2026-11-07' }, fake.client)
		);
		expect(result).toEqual({ success: true, action: 'dayMoved', date: '2026-11-07' });
		const calls = fake.queries.filter((q) => q.table === 'class_days')[1]?.calls ?? [];
		expect(calls).toContainEqual(['update', { day: '2026-11-07' }]);
		expect(calls).toContainEqual(['eq', 'id', 'd1']);
	});

	it('moveClassDay refuses an invalid date before any query', async () => {
		const fake = fakeSupabase({});
		const result = await actions.moveClassDay(event({ dayId: 'd1', newDate: 'soon' }, fake.client));
		expect(result).toMatchObject({ status: 400, data: { error: m.calendar_error_date_invalid() } });
		expect(fake.tablesRead).toEqual([]);
	});

	it.each([
		['CD001', () => m.calendar_error_move_not_future()],
		['23505', () => m.calendar_error_day_taken()],
		['42501', () => m.calendar_error_failed()]
	])('moveClassDay maps %s to its message', async (code, message) => {
		const fake = fakeSupabase({ class_days: moveResults(dbError(code)) });
		const result = await actions.moveClassDay(
			event({ dayId: 'd1', newDate: '2026-11-07' }, fake.client)
		);
		expect(result).toMatchObject({ status: 400, data: { error: message() } });
	});

	it('moveClassDay refuses the date the day is already on, without an update', async () => {
		const fake = fakeSupabase({ class_days: moveResults({ data: [{ id: 'd1' }], error: null }) });
		const result = await actions.moveClassDay(
			event({ dayId: 'd1', newDate: '2026-11-08' }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.calendar_error_move_same_date() }
		});
		expect(fake.queries.filter((q) => q.table === 'class_days')).toHaveLength(1);
	});

	it.each([
		['moveClassDay', { dayId: '', newDate: '2026-11-07' }],
		['deleteClassDay', { dayId: '' }]
	] as const)('%s: a missing dayId fails before any query', async (name, fields) => {
		const fake = fakeSupabase({});
		const result = await actions[name](event(fields, fake.client));
		expect(result).toMatchObject({ status: 400, data: { error: m.calendar_error_failed() } });
		expect(fake.tablesRead).toEqual([]);
	});

	it('deleteClassDay deletes the day and reports dayDeleted', async () => {
		const fake = fakeSupabase({ class_days: { data: [{ id: 'd1' }], error: null } });
		const result = await actions.deleteClassDay(event({ dayId: 'd1' }, fake.client));
		expect(result).toEqual({ success: true, action: 'dayDeleted' });
		const calls = fake.queries.find((q) => q.table === 'class_days')?.calls ?? [];
		expect(calls).toContainEqual(['delete']);
		expect(calls).toContainEqual(['eq', 'id', 'd1']);
	});

	it.each([
		['CD001', () => m.calendar_error_delete_not_future()],
		['CD002', () => m.calendar_error_day_has_answers()],
		['23503', () => m.calendar_error_failed()]
	])('deleteClassDay maps %s to its message', async (code, message) => {
		const fake = fakeSupabase({ class_days: dbError(code) });
		const result = await actions.deleteClassDay(event({ dayId: 'd1' }, fake.client));
		expect(result).toMatchObject({ status: 400, data: { error: message() } });
	});

	it.each([
		['moveClassDay', { dayId: 'd1', newDate: '2026-11-07' }],
		['deleteClassDay', { dayId: 'd1' }]
	] as const)(
		'%s: a zero-row (RLS-denied) write returns the generic error',
		async (name, fields) => {
			const fake = fakeSupabase(
				{
					class_days:
						name === 'moveClassDay'
							? moveResults({ data: [], error: null })
							: { data: [], error: null }
				},
				'teacher'
			);
			const result = await actions[name](event(fields, fake.client));
			expect(result).toMatchObject({ status: 400, data: { error: m.calendar_error_failed() } });
		}
	);
});

describe('class schedule actions (Story 6-4)', () => {
	const schedule = {
		classId: 'c1',
		weekday: ['7', '3'],
		startTime: '10:00',
		durationMinutes: '90',
		startsOn: '2026-10-01',
		endsOn: '2026-12-20',
		intervalWeeks: '2'
	};

	it('setClassSchedule sends the parsed schedule to set_class_schedule', async () => {
		const fake = fakeSupabase({});
		const result = await actions.setClassSchedule(event(schedule, fake.client));
		expect(result).toEqual({ success: true, action: 'scheduleSaved' });
		expect(fake.rpcCalls).toEqual([
			{
				fn: 'set_class_schedule',
				args: {
					p_class_id: 'c1',
					p_weekdays: [3, 7],
					p_start_time: '10:00',
					p_duration_minutes: 90,
					p_starts_on: '2026-10-01',
					p_ends_on: '2026-12-20',
					p_interval_weeks: 2
				}
			}
		]);
	});

	it('setClassSchedule: an empty until means no end, empty time means not set', async () => {
		const fake = fakeSupabase({});
		await actions.setClassSchedule(
			event({ ...schedule, endsOn: '', startTime: '', durationMinutes: '' }, fake.client)
		);
		expect(fake.rpcCalls[0].args).toMatchObject({
			p_ends_on: null,
			p_start_time: null,
			p_duration_minutes: null
		});
	});

	it('setClassSchedule: an invalid schedule saves nothing and reports each field', async () => {
		const fake = fakeSupabase({});
		const result = await actions.setClassSchedule(
			event({ ...schedule, weekday: [], endsOn: '2026-09-01', durationMinutes: '500' }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: {
				classId: 'c1',
				scheduleErrors: {
					weekdays: m.calendar_error_weekdays_required(),
					durationMinutes: m.calendar_error_duration_invalid(),
					endsOn: m.calendar_error_until_before_from()
				}
			}
		});
		expect(fake.rpcCalls).toEqual([]);
	});

	it('setClassSchedule: no interval field means weekly; an invalid one saves nothing', async () => {
		const weekly = fakeSupabase({});
		const noInterval: Record<string, string | string[]> = { ...schedule };
		delete noInterval.intervalWeeks;
		await actions.setClassSchedule(event(noInterval, weekly.client));
		expect(weekly.rpcCalls[0].args).toMatchObject({ p_interval_weeks: 1 });

		for (const intervalWeeks of ['5', '0', 'x']) {
			const fake = fakeSupabase({});
			const result = await actions.setClassSchedule(
				event({ ...schedule, intervalWeeks }, fake.client)
			);
			expect(result).toMatchObject({
				status: 400,
				data: { scheduleErrors: { intervalWeeks: m.calendar_error_interval_invalid() } }
			});
			expect(fake.rpcCalls).toEqual([]);
		}
	});

	it('setClassSchedule: a denied call (42501) gives the generic error', async () => {
		const fake = fakeSupabase({}, 'teacher', { error: { code: '42501', message: 'no' } });
		const result = await actions.setClassSchedule(event(schedule, fake.client));
		expect(result).toMatchObject({ status: 400, data: { error: m.calendar_error_failed() } });
	});

	it('addExtraSession sends the class, day and time to add_extra_session', async () => {
		const fake = fakeSupabase({});
		const result = await actions.addExtraSession(
			event({ classId: 'c1', dayId: 'd1', startTime: '14:00', durationMinutes: '60' }, fake.client)
		);
		expect(result).toEqual({ success: true, action: 'extraAdded' });
		expect(fake.rpcCalls).toEqual([
			{
				fn: 'add_extra_session',
				args: {
					p_class_id: 'c1',
					p_class_day_id: 'd1',
					p_start_time: '14:00',
					p_duration_minutes: 60
				}
			}
		]);
	});

	it('addExtraSession: the class already has a session that day (23505) errors in the dialog', async () => {
		const fake = fakeSupabase({}, 'admin', { error: { code: '23505', message: 'dup' } });
		const result = await actions.addExtraSession(
			event({ classId: 'c1', dayId: 'd1', startTime: '', durationMinutes: '' }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { extraError: m.calendar_error_extra_exists(), dayId: 'd1' }
		});
	});

	it('addExtraSession: denied (42501) gives the generic error', async () => {
		const fake = fakeSupabase({}, 'student', { error: { code: '42501', message: 'no' } });
		const result = await actions.addExtraSession(
			event({ classId: 'c1', dayId: 'd1', startTime: '', durationMinutes: '' }, fake.client)
		);
		expect(result).toMatchObject({
			status: 403,
			data: { extraError: m.calendar_error_failed() }
		});
	});

	it('addExtraSession validates class, time and duration before calling the database', async () => {
		const fake = fakeSupabase({});
		expect(
			await actions.addExtraSession(
				event({ classId: '', dayId: 'd1', startTime: '', durationMinutes: '' }, fake.client)
			)
		).toMatchObject({ status: 400, data: { extraError: m.calendar_error_class_required() } });
		expect(
			await actions.addExtraSession(
				event({ classId: 'c1', dayId: 'd1', startTime: '25:00', durationMinutes: '' }, fake.client)
			)
		).toMatchObject({ status: 400, data: { extraError: m.calendar_error_time_invalid() } });
		expect(
			await actions.addExtraSession(
				event({ classId: 'c1', dayId: 'd1', startTime: '', durationMinutes: '5' }, fake.client)
			)
		).toMatchObject({ status: 400, data: { extraError: m.calendar_error_duration_invalid() } });
		expect(fake.rpcCalls).toEqual([]);
	});
});

describe('calendar load: active role (B13 #68)', () => {
	function runActive(activeRole: string | null) {
		const fake = fakeSupabase({}, 'teacher', { data: [], error: null });
		const result = load({
			url: new URL('http://localhost/calendar?month=2026-10'),
			parent: async () => ({ profile: { role: 'teacher' }, activeRole }),
			locals: {
				supabase: fake.client,
				safeGetSession: async () => ({ user: { id: 'u1' } })
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<{ role: string; canEdit: boolean }>;
		return { result, fake };
	}

	it('a teacher-parent with Parent active gets the parent view', async () => {
		const { result, fake } = runActive('parent');
		expect(await result).toMatchObject({ role: 'parent', canEdit: false });
		expect(fake.rpcCalls.map((c) => c.fn)).toEqual(['linked_children']);
		expect(fake.tablesRead).not.toContain('classes');
	});

	it('with the staff role active it stays the teacher view', async () => {
		const { result, fake } = runActive('teacher');
		expect(await result).toMatchObject({ role: 'teacher', canEdit: true });
		expect(fake.rpcCalls).toEqual([]);
	});

	it('without an active role it falls back to the profile role', async () => {
		const { result } = runActive(null);
		expect(await result).toMatchObject({ role: 'teacher', canEdit: true });
	});
});

describe('calendar load: student and parent reads in one batch (#104h)', () => {
	const session = (id: string, classId: string) => ({
		id,
		class_id: classId,
		class_name: 'Yaks',
		class_day_id: 'd1',
		start_time: '10:00:00',
		duration_minutes: 60,
		start_time_override: null,
		duration_minutes_override: null,
		session_cancelled: false,
		day_cancelled: false,
		extra: false
	});
	const day = { id: 'd1', day: '2026-10-05', cancelled: false };
	const linked = [
		{ id: 'a', name: 'Anna', status: 'approved' },
		{ id: 'b', name: 'Bodhi', status: 'approved' }
	];

	type LoadResult = {
		days: { sessions: { id: string }[] }[];
		children: { id: string; name: string }[];
		selectedChild: string | null;
		leaveAnswers: Record<string, string>;
		childAnswers: Record<string, { childId: string; name: string; answer: string | null }[]>;
		loadError: boolean;
	};

	function run(
		role: string,
		userId: string,
		results: Record<string, Result>,
		options: { children?: unknown[]; query?: string; gate?: Promise<void> } = {}
	) {
		const fake = fakeSupabase(
			{ class_days: { data: [day], error: null }, ...results },
			role,
			{ data: options.children ?? linked, error: null },
			options.gate
		);
		const result = load({
			url: new URL(`http://localhost/calendar?month=2026-10${options.query ?? ''}`),
			parent: async () => ({ profile: { role: 'teacher' }, activeRole: role }),
			locals: {
				supabase: fake.client,
				safeGetSession: async () => ({ user: { id: userId } })
			}
		} as unknown as Parameters<typeof load>[0]) as Promise<LoadResult>;
		return { fake, result };
	}

	const sessionIds = (r: LoadResult) => r.days.flatMap((d) => d.sessions.map((s) => s.id));
	const callsOn = (fake: ReturnType<typeof fakeSupabase>, table: string) =>
		fake.queries.filter((q) => q.table === table).flatMap((q) => q.calls);
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('student: answers filtered by own id and the month; only shown sessions count', async () => {
		const { fake, result } = run('student', 'u1', {
			class_sessions_effective: { data: [session('s1', 'yaks')], error: null },
			session_leave_history: {
				data: [
					{ class_session_id: 's1', answer: 'sick' },
					{ class_session_id: 's1', answer: 'coming' },
					{ class_session_id: 'hidden', answer: 'on_leave' }
				],
				error: null
			}
		});
		const r = await result;
		expect(r.leaveAnswers).toEqual({ s1: 'sick' });
		expect(r.loadError).toBe(false);
		const calls = callsOn(fake, 'session_leave_history');
		expect(calls).toContainEqual(['eq', 'student_id', 'u1']);
		expect(calls).toContainEqual(['gte', 'class_sessions.class_days.day', '2026-10-01']);
		expect(calls).toContainEqual(['lte', 'class_sessions.class_days.day', '2026-10-31']);
		expect(calls).toContainEqual(['order', 'answered_at', { ascending: false }]);
		expect(calls).toContainEqual(['order', 'id', { ascending: false }]);
		expect(calls.some((c) => c[0] === 'in')).toBe(false);
	});

	it('student: a failed answers read is a load error; with no sessions it is not', async () => {
		const failed = { data: null, error: { message: 'boom' } };
		const withSessions = run('student', 'u1', {
			class_sessions_effective: { data: [session('s1', 'yaks')], error: null },
			session_leave_history: failed
		});
		expect((await withSessions.result).loadError).toBe(true);
		const noSessions = run('student', 'u1', { session_leave_history: failed });
		expect((await noSessions.result).loadError).toBe(false);
	});

	const parentResults = {
		class_sessions_effective: {
			data: [session('s1', 'yaks'), session('s2', 'lions')],
			error: null
		},
		class_enrollments: {
			data: [
				{ class_id: 'yaks', student_id: 'a' },
				{ class_id: 'yaks', student_id: 'b' },
				{ class_id: 'lions', student_id: 'b' }
			],
			error: null
		},
		session_leave_history: {
			data: [
				{ class_session_id: 's1', student_id: 'a', answer: 'on_leave' },
				{ class_session_id: 's1', student_id: 'a', answer: 'coming' },
				{ class_session_id: 's2', student_id: 'b', answer: 'sick' }
			],
			error: null
		}
	};

	it('parent, all children: same children, rows and answers; reads filtered up front', async () => {
		const { fake, result } = run('parent', 'parent1', parentResults);
		const r = await result;
		expect(r.children).toEqual([
			{ id: 'a', name: 'Anna' },
			{ id: 'b', name: 'Bodhi' }
		]);
		expect(sessionIds(r).sort()).toEqual(['s1', 's2']);
		expect(r.childAnswers).toEqual({
			s1: [
				{ childId: 'a', name: 'Anna', answer: 'on_leave' },
				{ childId: 'b', name: 'Bodhi', answer: null }
			],
			s2: [{ childId: 'b', name: 'Bodhi', answer: 'sick' }]
		});
		expect(r.loadError).toBe(false);
		// spec-second-parent story 2: both reads filter on the caller's own
		// active student_parents link, never on registered_by_parent_id.
		const enrollCalls = callsOn(fake, 'class_enrollments');
		expect(enrollCalls).toContainEqual(['eq', 'student.student_parents.parent_id', 'parent1']);
		expect(enrollCalls).toContainEqual(['is', 'student.student_parents.removed_at', null]);
		expect(enrollCalls.some((c) => c[0] === 'in')).toBe(false);
		const answerCalls = callsOn(fake, 'session_leave_history');
		expect(answerCalls).toContainEqual(['eq', 'student.student_parents.parent_id', 'parent1']);
		expect(answerCalls).toContainEqual(['is', 'student.student_parents.removed_at', null]);
		expect(answerCalls).toContainEqual(['gte', 'class_sessions.class_days.day', '2026-10-01']);
		expect(answerCalls).toContainEqual(['lte', 'class_sessions.class_days.day', '2026-10-31']);
		expect(answerCalls.some((c) => c[0] === 'in')).toBe(false);
		expect(JSON.stringify([...enrollCalls, ...answerCalls])).not.toContain(
			'registered_by_parent_id'
		);
	});

	it('parent: a slot-2 parent reads through their own link', async () => {
		// Whoever registered the child plays no part: the filter is the
		// caller's own active student_parents link.
		const { fake, result } = run('parent', 'parentB', parentResults);
		const r = await result;
		expect(sessionIds(r).sort()).toEqual(['s1', 's2']);
		expect(r.childAnswers.s2).toEqual([{ childId: 'b', name: 'Bodhi', answer: 'sick' }]);
		expect(callsOn(fake, 'class_enrollments')).toContainEqual([
			'eq',
			'student.student_parents.parent_id',
			'parentB'
		]);
	});

	it('parent, ?child=: only that child’s classes and answers', async () => {
		const { result } = run('parent', 'parent1', parentResults, { query: '&child=a' });
		const r = await result;
		expect(r.selectedChild).toBe('a');
		expect(sessionIds(r)).toEqual(['s1']);
		expect(r.childAnswers).toEqual({ s1: [{ childId: 'a', name: 'Anna', answer: 'on_leave' }] });
	});

	it('parent, pending child only: no sessions, no children', async () => {
		const { result } = run(
			'parent',
			'parent1',
			{
				...parentResults,
				class_enrollments: { data: [{ class_id: 'yaks', student_id: 'p' }], error: null },
				session_leave_history: {
					data: [{ class_session_id: 's1', student_id: 'p', answer: 'sick' }],
					error: null
				}
			},
			{ children: [{ id: 'p', name: 'Pema', status: 'pending' }] }
		);
		const r = await result;
		expect(r.children).toEqual([]);
		expect(sessionIds(r)).toEqual([]);
		expect(r.childAnswers).toEqual({});
		expect(r.loadError).toBe(false);
	});

	it('teacher-parent with Parent active: only own children’s sessions and answers', async () => {
		// RLS lets a teacher read the enrollments and answers of the classes
		// they teach, so these rows can come back; they must not show.
		const { result } = run(
			'parent',
			'teacher1',
			{
				class_sessions_effective: {
					data: [session('s1', 'yaks'), session('s9', 'taught')],
					error: null
				},
				class_enrollments: {
					data: [
						{ class_id: 'yaks', student_id: 'a' },
						{ class_id: 'yaks', student_id: 'x' },
						{ class_id: 'taught', student_id: 'x' }
					],
					error: null
				},
				session_leave_history: {
					data: [
						{ class_session_id: 's1', student_id: 'x', answer: 'sick' },
						{ class_session_id: 's9', student_id: 'x', answer: 'on_leave' },
						{ class_session_id: 's1', student_id: 'a', answer: 'coming' }
					],
					error: null
				}
			},
			{ children: [linked[0]] }
		);
		const r = await result;
		expect(sessionIds(r)).toEqual(['s1']);
		expect(r.childAnswers).toEqual({ s1: [{ childId: 'a', name: 'Anna', answer: 'coming' }] });
	});

	it('parent: a failed class_enrollments read with only a pending child is no load error', async () => {
		const { result } = run(
			'parent',
			'parent1',
			{ ...parentResults, class_enrollments: { data: null, error: { message: 'boom' } } },
			{ children: [{ id: 'p', name: 'Pema', status: 'pending' }] }
		);
		const r = await result;
		expect(r.children).toEqual([]);
		expect(r.loadError).toBe(false);
	});

	it('parent: a failed session_leave_history read with no session shown is no load error', async () => {
		const { result } = run('parent', 'parent1', {
			...parentResults,
			class_enrollments: { data: [{ class_id: 'elsewhere', student_id: 'a' }], error: null },
			session_leave_history: { data: null, error: { message: 'boom' } }
		});
		const r = await result;
		expect(sessionIds(r)).toEqual([]);
		expect(r.loadError).toBe(false);
	});

	it.each(['admin', 'teacher'])('%s: only the original three reads run', async (role) => {
		const { fake, result } = run(role, 'u1', parentResults);
		await result;
		expect([...fake.started].sort()).toEqual(
			['class_days', 'class_sessions_effective', 'classes'].sort()
		);
		expect(fake.rpcCalls).toEqual([]);
	});

	it.each([
		['student', 'u1', ['class_days', 'class_sessions_effective', 'session_leave_history']],
		[
			'parent',
			'parent1',
			[
				'class_days',
				'class_sessions_effective',
				'rpc:linked_children',
				'class_enrollments',
				'session_leave_history'
			]
		]
	])('%s: every query starts before any of them answers', async (role, userId, expected) => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { fake, result } = run(role, userId, parentResults, { gate });
		await flush();
		expect([...fake.started].sort()).toEqual([...expected].sort());
		release();
		await result;
		expect([...fake.started].sort()).toEqual([...expected].sort());
	});
});
