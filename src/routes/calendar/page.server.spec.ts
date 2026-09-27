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

function fakeSupabase(
	results: Record<string, Result>,
	role = 'admin',
	rpcResult: { error: unknown } = { error: null }
) {
	const upserted: unknown[] = [];
	const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
	const tablesRead: string[] = [];
	function chain(result: Result) {
		const c = {
			select: () => c,
			eq: () => c,
			in: () => c,
			gte: () => c,
			lte: () => c,
			order: () => c,
			maybeSingle: () => c,
			update: () => c,
			upsert: (rows: unknown[]) => {
				upserted.push(...rows);
				return c;
			},
			then: (resolve: (value: Result) => unknown) => resolve(result)
		};
		return c;
	}
	return {
		upserted,
		rpcCalls,
		tablesRead,
		client: {
			from: (table: string) => {
				tablesRead.push(table);
				return chain(
					table === 'profiles'
						? { data: { role }, error: null }
						: (results[table] ?? { data: [], error: null })
				);
			},
			rpc: async (fn: string, args: Record<string, unknown>) => {
				rpcCalls.push({ fn, args });
				return rpcResult;
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
