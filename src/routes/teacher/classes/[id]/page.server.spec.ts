import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { loadClassRoster } from '$lib/server/enrollments';
import { actions, load } from './+page.server';

// load's other data comes from these helpers; empty results keep the test on
// the markable-sessions query.
vi.mock('$lib/server/enrollments', () => ({
	loadClassRoster: vi.fn(async () => ({ students: [], error: null })),
	loadEnrollableStudents: async () => ({ students: [], error: null }),
	enrollStudent: vi.fn(),
	unenrollStudent: vi.fn()
}));
vi.mock('$lib/server/class-syllabus', () => ({
	listSyllabi: async () => ({ syllabi: [], error: null })
}));
vi.mock('$lib/server/homework-view', () => ({
	loadAssignmentIndex: async () => ({ entries: [], error: null })
}));

/**
 * markAttendance (Story 6-2): FormData event + a fake `locals.supabase`.
 * `session` answers the class_sessions_effective lookup; `insertErrors`
 * answers each attendance_records insert in turn (null = saved), and
 * `inserted` records the rows sent.
 */
const CLASS_ID = 'c1';
const SESSION_ID = '11111111-2222-4333-8444-555555555555';

type Session = { id: string; class_id: string; day: string; cancelled: boolean } | null;

function fakeSupabase(session: Session, insertErrors: ({ code: string } | null)[] = []) {
	const inserted: Record<string, unknown>[] = [];
	const errors = [...insertErrors];
	return {
		inserted,
		client: {
			from: (table: string) => {
				if (table === 'class_sessions_effective') {
					const c = {
						select: () => c,
						eq: () => c,
						maybeSingle: async () => ({ data: session, error: null })
					};
					return c;
				}
				if (table === 'attendance_records') {
					return {
						insert: async (row: Record<string, unknown>) => {
							inserted.push(row);
							return { error: errors.shift() ?? null };
						}
					};
				}
				throw new Error(`unexpected table ${table}`);
			}
		}
	};
}

function event(
	fields: Record<string, string | string[]>,
	supabase: ReturnType<typeof fakeSupabase>['client'],
	user: { id: string } | null = { id: 't1' }
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const value of Array.isArray(v) ? v : [v]) body.append(k, value);
	}
	return {
		request: new Request('http://localhost/teacher/classes/c1', { method: 'POST', body }),
		params: { id: CLASS_ID },
		locals: { supabase, safeGetSession: async () => ({ user }) }
	} as unknown as Parameters<typeof actions.markAttendance>[0];
}

const openSession = { id: SESSION_ID, class_id: CLASS_ID, day: '2026-09-20', cancelled: false };

describe('markAttendance', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('requires a signed-in user', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID }, fake.client, null)
		);
		expect(result).toMatchObject({ status: 401 });
		expect(fake.inserted).toEqual([]);
	});

	it('requires a session', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(event({ studentIds: ['s1'] }, fake.client));
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_session_required() }
		});
		expect(fake.inserted).toEqual([]);
	});

	it('rejects a malformed session id', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event({ sessionId: '2026-09-20', studentIds: ['s1'] }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_session_not_markable() }
		});
		expect(fake.inserted).toEqual([]);
	});

	it('requires at least one student', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(event({ sessionId: SESSION_ID }, fake.client));
		expect(result).toMatchObject({ status: 400, data: { error: m.roster_error_no_students() } });
	});

	it.each([
		['unknown or unreadable', null],
		['of another class', { ...openSession, class_id: 'c2' }],
		['cancelled', { ...openSession, cancelled: true }],
		['in the future', { ...openSession, day: '2999-01-01' }]
	])('refuses a session that is %s without inserting', async (_label, session) => {
		const fake = fakeSupabase(session);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1'] }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_session_not_markable() }
		});
		expect(fake.inserted).toEqual([]);
	});

	it('uses the Berlin date for "today": a session dated tomorrow in UTC terms but today in Berlin is markable', async () => {
		vi.useFakeTimers();
		// 23:30 UTC on 2026-09-19 = 01:30 on 2026-09-20 in Berlin.
		vi.setSystemTime(new Date('2026-09-19T23:30:00Z'));
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1'] }, fake.client)
		);
		expect(result).toMatchObject({ success: true, sessionDate: '2026-09-20' });
	});

	it('an unmarked session (no loaded mark posted): one row per student against the session, and the session day is reported', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1', 's2'], present_s1: 'on' }, fake.client)
		);
		expect(fake.inserted).toEqual([
			{
				student_id: 's1',
				class_id: CLASS_ID,
				class_session_id: SESSION_ID,
				present: true,
				recorded_by: 't1'
			},
			{
				student_id: 's2',
				class_id: CLASS_ID,
				class_session_id: SESSION_ID,
				present: false,
				recorded_by: 't1'
			}
		]);
		expect(result).toEqual({
			success: true,
			action: 'attendance',
			sessionId: SESSION_ID,
			sessionDate: '2026-09-20',
			failedStudentIds: []
		});
	});

	// #102: a save writes only what the teacher changed. `loaded_<id>` is the
	// mark the form showed when it opened.
	it('partly marked: an unticked student without a loaded mark gets no row', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event(
				{
					sessionId: SESSION_ID,
					studentIds: ['s1', 's2', 's3'],
					loaded_s1: 'present',
					loaded_s2: 'absent',
					loaded_s3: '',
					present_s1: 'on',
					present_s2: 'on'
				},
				fake.client
			)
		);
		// Only s2 changed (absent -> present); s3 has no mark and stays unticked.
		expect(fake.inserted).toEqual([
			expect.objectContaining({ student_id: 's2', class_session_id: SESSION_ID, present: true })
		]);
		expect(result).toMatchObject({ success: true, failedStudentIds: [] });
	});

	it('partly marked: a ticked student without a loaded mark gets a present row', async () => {
		const fake = fakeSupabase(openSession);
		await actions.markAttendance(
			event(
				{
					sessionId: SESSION_ID,
					studentIds: ['s1', 's3'],
					loaded_s1: 'absent',
					loaded_s3: '',
					present_s3: 'on'
				},
				fake.client
			)
		);
		expect(fake.inserted).toEqual([expect.objectContaining({ student_id: 's3', present: true })]);
	});

	it('unchanged re-save: no row is written and the result is the usual success', async () => {
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event(
				{
					sessionId: SESSION_ID,
					studentIds: ['s1', 's2'],
					loaded_s1: 'present',
					loaded_s2: 'absent',
					present_s1: 'on'
				},
				fake.client
			)
		);
		expect(fake.inserted).toEqual([]);
		expect(result).toEqual({
			success: true,
			action: 'attendance',
			sessionId: SESSION_ID,
			sessionDate: '2026-09-20',
			failedStudentIds: []
		});
	});

	it('stale form: the tick is compared with the posted loaded mark, so only the changed student is written', async () => {
		// The form was opened while s1 was present; someone corrected s1 to
		// absent since. This teacher unticks only s2.
		const fake = fakeSupabase(openSession);
		const result = await actions.markAttendance(
			event(
				{
					sessionId: SESSION_ID,
					studentIds: ['s1', 's2'],
					loaded_s1: 'present',
					loaded_s2: 'present',
					present_s1: 'on'
				},
				fake.client
			)
		);
		expect(fake.inserted).toEqual([
			{
				student_id: 's2',
				class_id: CLASS_ID,
				class_session_id: SESSION_ID,
				present: false,
				recorded_by: 't1'
			}
		]);
		expect(result).toMatchObject({ success: true, failedStudentIds: [] });
	});

	it('a marked session whose every changed row is refused is an error, whatever the unchanged students', async () => {
		const fake = fakeSupabase(openSession, [{ code: '08006' }]);
		const result = await actions.markAttendance(
			event(
				{
					sessionId: SESSION_ID,
					studentIds: ['s1', 's2'],
					loaded_s1: 'present',
					loaded_s2: 'absent',
					present_s1: 'on',
					present_s2: 'on'
				},
				fake.client
			)
		);
		expect(fake.inserted).toHaveLength(1);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_attendance_save_failed() }
		});
	});

	it('reports the students whose insert failed when others were saved', async () => {
		const fake = fakeSupabase(openSession, [null, { code: '42501' }]);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1', 's2'] }, fake.client)
		);
		expect(result).toMatchObject({ success: true, failedStudentIds: ['s2'] });
	});

	it('maps a whole-class RLS refusal (e.g. the session was cancelled meanwhile) to the session error', async () => {
		const fake = fakeSupabase(openSession, [{ code: '42501' }, { code: '42501' }]);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1', 's2'] }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_session_not_markable() }
		});
	});

	it('maps a whole-class failure with mixed error codes to the generic save error', async () => {
		const fake = fakeSupabase(openSession, [{ code: '42501' }, { code: '08006' }]);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1', 's2'] }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_attendance_save_failed() }
		});
	});

	it('maps any other whole-class failure to the generic save error', async () => {
		const fake = fakeSupabase(openSession, [{ code: '08006' }]);
		const result = await actions.markAttendance(
			event({ sessionId: SESSION_ID, studentIds: ['s1'] }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: m.roster_error_attendance_save_failed() }
		});
	});
});

describe('load: markable sessions', () => {
	it("lists the class's non-cancelled sessions up to today (Berlin), newest first, in the picker shape", async () => {
		const calls: { table: string; method: string; args: unknown[] }[] = [];
		const rows = [
			{ id: 'sB', day: '2026-09-20', start_time: '10:00:00' },
			{ id: 'sA', day: '2026-09-13', start_time: null },
			{ id: null, day: null, start_time: null }
		];
		function chain(table: string, result: { data: unknown; error: unknown }) {
			const c: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'lte', 'order', 'limit', 'in']) {
				c[method] = (...args: unknown[]) => {
					calls.push({ table, method, args });
					return c;
				};
			}
			// The upcoming-leave read (#106): no session from today on here.
			c.gte = (...args: unknown[]) => {
				calls.push({ table, method: 'gte', args });
				result = { data: [], error: null };
				return c;
			};
			c.maybeSingle = async () => result;
			c.then = (resolve: (value: unknown) => unknown) => resolve(result);
			return c;
		}
		const supabase = {
			from: (table: string) =>
				table === 'classes'
					? chain(table, { data: { id: CLASS_ID, name: 'C', code: 'X' }, error: null })
					: chain(table, { data: rows, error: null })
		};

		const data = (await load({
			params: { id: CLASS_ID },
			locals: { supabase, safeGetSession: async () => ({ session: {} }) }
		} as unknown as Parameters<typeof load>[0])) as { markableSessions: unknown };

		const sessionCalls = calls
			.filter((c) => c.table === 'class_sessions_effective')
			.map(({ method, args }) => [method, ...args]);
		expect(sessionCalls).toEqual(
			expect.arrayContaining([
				['eq', 'class_id', CLASS_ID],
				['eq', 'cancelled', false],
				['lte', 'day', todayInBerlin()],
				['order', 'day', { ascending: false }]
			])
		);
		expect(data.markableSessions).toEqual([
			{ id: 'sB', day: '2026-09-20', startTime: '10:00:00' },
			{ id: 'sA', day: '2026-09-13', startTime: null }
		]);
	});
});

describe('load: leave answers (Story 7-4)', () => {
	/**
	 * Runs load with a two-student roster; session_leave_history pages through
	 * `leaveRows` via .range(). `upcoming` answers the read of sessions from
	 * today on (#106), or fails with `upcomingError`.
	 */
	async function runLoad(
		leaveRows: Record<string, string>[],
		upcoming: Record<string, string | null>[] = [],
		upcomingError: { code: string } | null = null
	) {
		vi.mocked(loadClassRoster).mockResolvedValueOnce({
			students: [
				{ id: 's1', displayName: 'Dawa' },
				{ id: 's2', displayName: 'Pema' }
			],
			error: null
		} as unknown as Awaited<ReturnType<typeof loadClassRoster>>);
		const calls: { table: string; method: string; args: unknown[] }[] = [];
		const results: Record<string, unknown> = {
			classes: { id: CLASS_ID, name: 'C', code: 'X' },
			class_sessions_effective: [
				{ id: 'sB', day: '2026-09-20', start_time: '10:00:00' },
				{ id: 'sA', day: '2026-09-13', start_time: null }
			],
			session_leave_history: leaveRows
		};
		function chain(table: string) {
			let data = (results[table] ?? []) as unknown;
			let error: { code: string } | null = null;
			const c: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'lte', 'order', 'limit', 'in']) {
				c[method] = (...args: unknown[]) => {
					calls.push({ table, method, args });
					return c;
				};
			}
			c.gte = (...args: unknown[]) => {
				calls.push({ table, method: 'gte', args });
				data = upcoming;
				error = upcomingError;
				return c;
			};
			c.range = (from: number, to: number) => {
				calls.push({ table, method: 'range', args: [from, to] });
				data = (data as unknown[]).slice(from, to + 1);
				return c;
			};
			c.maybeSingle = async () => ({ data, error: null });
			c.then = (resolve: (value: unknown) => unknown) =>
				resolve(error ? { data: null, error } : { data, error: null });
			return c;
		}

		const data = (await load({
			params: { id: CLASS_ID },
			locals: { supabase: { from: chain }, safeGetSession: async () => ({ session: {} }) }
		} as unknown as Parameters<typeof load>[0])) as {
			leaveAnswers: Record<string, string>;
			upcomingLeave: unknown[];
			loadError: boolean;
		};
		const leaveCalls = calls
			.filter((c) => c.table === 'session_leave_history')
			.map(({ method, args }) => [method, ...args]);
		const sessionCalls = calls
			.filter((c) => c.table === 'class_sessions_effective')
			.map(({ method, args }) => [method, ...args]);
		return { data, leaveCalls, sessionCalls };
	}

	it("keys each student's current answer by session and student, newest row first", async () => {
		const { data, leaveCalls } = await runLoad([
			{ class_session_id: 'sB', student_id: 's1', answer: 'on_leave' },
			{ class_session_id: 'sB', student_id: 's1', answer: 'coming' },
			{ class_session_id: 'sA', student_id: 's2', answer: 'sick' }
		]);

		expect(data.leaveAnswers).toEqual({ 'sB:s1': 'on_leave', 'sA:s2': 'sick' });
		expect(data.loadError).toBe(false);
		expect(leaveCalls).toEqual(
			expect.arrayContaining([
				['in', 'class_session_id', ['sB', 'sA']],
				['in', 'student_id', ['s1', 's2']],
				['order', 'answered_at', { ascending: false }],
				['range', 0, 999]
			])
		);
		// A short first page: no second request.
		expect(leaveCalls.filter(([method]) => method === 'range')).toEqual([['range', 0, 999]]);
	});

	it('pages past PostgREST max_rows (1000): a full page fetches the next one', async () => {
		// 1000 older rows for sB:s1 fill page one; the only sA:s2 row is on page two.
		const rows = [
			{ class_session_id: 'sB', student_id: 's1', answer: 'coming' },
			...Array.from({ length: 999 }, () => ({
				class_session_id: 'sB',
				student_id: 's1',
				answer: 'on_leave'
			})),
			{ class_session_id: 'sA', student_id: 's2', answer: 'sick' },
			{ class_session_id: 'sB', student_id: 's1', answer: 'on_leave' }
		];
		const { data, leaveCalls } = await runLoad(rows);

		expect(leaveCalls.filter(([method]) => method === 'range')).toEqual([
			['range', 0, 999],
			['range', 1000, 1999]
		]);
		// Same dedupe across pages: the newest row (page one) wins.
		expect(data.leaveAnswers).toEqual({ 'sB:s1': 'coming', 'sA:s2': 'sick' });
	});

	describe('upcoming leave (#106)', () => {
		const upcoming = [
			{ id: 'sC', day: '2099-01-03', start_time: '10:00:00' },
			{ id: 'sD', day: '2099-01-10', start_time: null }
		];

		it('reads the sessions from today, up to 12 weeks ahead, and their answers with the markable ones', async () => {
			const { leaveCalls, sessionCalls } = await runLoad([], upcoming);
			const today = todayInBerlin();
			const end = new Date(`${today}T00:00:00Z`);
			end.setUTCDate(end.getUTCDate() + 84);
			expect(sessionCalls).toEqual(
				expect.arrayContaining([
					['gte', 'day', today],
					['lte', 'day', end.toISOString().slice(0, 10)]
				])
			);
			expect(leaveCalls).toEqual(
				expect.arrayContaining([['in', 'class_session_id', ['sB', 'sA', 'sC', 'sD']]])
			);
		});

		it("today's session is in both lists: its id is read once and its leave listed", async () => {
			const { data, leaveCalls } = await runLoad(
				[{ class_session_id: 'sB', student_id: 's1', answer: 'on_leave' }],
				[{ id: 'sB', day: '2026-09-20', start_time: '10:00:00' }]
			);
			expect(leaveCalls).toEqual(
				expect.arrayContaining([['in', 'class_session_id', ['sB', 'sA']]])
			);
			expect(data.upcomingLeave).toEqual([
				{
					sessionId: 'sB',
					day: '2026-09-20',
					startTime: '10:00:00',
					entries: [{ studentId: 's1', answer: 'on_leave' }]
				}
			]);
		});

		it('lists each upcoming session with its students On leave or Sick, in roster order', async () => {
			const { data } = await runLoad(
				[
					{ class_session_id: 'sC', student_id: 's2', answer: 'sick' },
					{ class_session_id: 'sC', student_id: 's1', answer: 'on_leave' },
					{ class_session_id: 'sD', student_id: 's1', answer: 'on_leave' }
				],
				upcoming
			);
			expect(data.upcomingLeave).toEqual([
				{
					sessionId: 'sC',
					day: '2099-01-03',
					startTime: '10:00:00',
					entries: [
						{ studentId: 's1', answer: 'on_leave' },
						{ studentId: 's2', answer: 'sick' }
					]
				},
				{
					sessionId: 'sD',
					day: '2099-01-10',
					startTime: null,
					entries: [{ studentId: 's1', answer: 'on_leave' }]
				}
			]);
			expect(data.loadError).toBe(false);
		});

		it('leaves out Coming (also when it replaced an On leave), students off the roster and past sessions', async () => {
			const { data } = await runLoad(
				[
					{ class_session_id: 'sC', student_id: 's1', answer: 'coming' },
					{ class_session_id: 'sC', student_id: 's1', answer: 'on_leave' },
					{ class_session_id: 'sD', student_id: 'gone', answer: 'on_leave' },
					{ class_session_id: 'sB', student_id: 's2', answer: 'on_leave' }
				],
				upcoming
			);
			expect(data.upcomingLeave).toEqual([]);
		});

		it('a failed read of the upcoming sessions sets the load error', async () => {
			const { data } = await runLoad([], [], { code: '08006' });
			expect(data.upcomingLeave).toEqual([]);
			expect(data.loadError).toBe(true);
		});
	});
});

describe('load: current attendance marks (#102)', () => {
	type Mark = {
		id: string;
		class_session_id: string;
		student_id: string;
		present: boolean;
		notes: null;
		session_date: string;
		recorded_at: string;
	};
	const mark = (sessionId: string, studentId: string, present: boolean): Mark => ({
		id: `${sessionId}-${studentId}`,
		class_session_id: sessionId,
		student_id: studentId,
		present,
		notes: null,
		session_date: sessionId === 'sB' ? '2026-09-20' : '2026-09-13',
		recorded_at: '2026-09-21T08:00:00Z'
	});

	/**
	 * Runs load with a three-student roster and two markable sessions.
	 * attendance_current (the latest mark per session and student) pages
	 * through `marks` via .range(), or fails with `marksError`.
	 */
	async function runLoad(
		marks: Mark[],
		marksError: { code: string } | null = null,
		/** The first row offset whose page fails (0 = the first page). */
		failFrom = 0
	) {
		vi.mocked(loadClassRoster).mockResolvedValueOnce({
			students: [
				{ id: 's1', displayName: 'Dawa' },
				{ id: 's2', displayName: 'Pema' },
				{ id: 's3', displayName: 'Tashi' }
			],
			error: null
		} as unknown as Awaited<ReturnType<typeof loadClassRoster>>);
		const calls: { table: string; method: string; args: unknown[] }[] = [];
		const results: Record<string, unknown> = {
			classes: { id: CLASS_ID, name: 'C', code: 'X' },
			class_sessions_effective: [
				{ id: 'sB', day: '2026-09-20', start_time: '10:00:00' },
				{ id: 'sA', day: '2026-09-13', start_time: null }
			],
			attendance_current: marks
		};
		function chain(table: string) {
			let data = (results[table] ?? []) as unknown;
			let error: { code: string } | null = null;
			const c: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'lte', 'order', 'limit', 'in']) {
				c[method] = (...args: unknown[]) => {
					calls.push({ table, method, args });
					return c;
				};
			}
			c.gte = (...args: unknown[]) => {
				calls.push({ table, method: 'gte', args });
				data = [];
				return c;
			};
			c.range = (from: number, to: number) => {
				calls.push({ table, method: 'range', args: [from, to] });
				data = (data as unknown[]).slice(from, to + 1);
				if (table === 'attendance_current' && from >= failFrom) error = marksError;
				return c;
			};
			c.maybeSingle = async () => ({ data, error: null });
			c.then = (resolve: (value: unknown) => unknown) =>
				resolve(error ? { data: null, error } : { data, error: null });
			return c;
		}

		const data = (await load({
			params: { id: CLASS_ID },
			locals: { supabase: { from: chain }, safeGetSession: async () => ({ session: {} }) }
		} as unknown as Parameters<typeof load>[0])) as {
			currentMarks: Record<string, boolean>;
			markedSessionIds: string[];
			attendance: { id: string; studentId: string; present: boolean; sessionDate: string }[];
			attendanceError: boolean;
			loadError: boolean;
		};
		return {
			data,
			tables: calls.map((c) => c.table),
			markCalls: calls
				.filter((c) => c.table === 'attendance_current')
				.map(({ method, args }) => [method, ...args])
		};
	}

	it('an unmarked class has no current marks and no marked session', async () => {
		const { data } = await runLoad([]);
		expect(data.currentMarks).toEqual({});
		expect(data.markedSessionIds).toEqual([]);
		expect(data.attendance).toEqual([]);
		expect(data.attendanceError).toBe(false);
		expect(data.loadError).toBe(false);
	});

	it('reads in a total order (session day newest first, then session, then student), so pages do not overlap', async () => {
		const { markCalls } = await runLoad([mark('sB', 's1', true)]);
		expect(markCalls.filter(([method]) => method === 'order')).toEqual([
			['order', 'session_date', { ascending: false }],
			['order', 'class_session_id', { ascending: true }],
			['order', 'student_id', { ascending: true }]
		]);
	});

	it('a mark that comes again on the next page is taken once', async () => {
		const marks = [
			...Array.from({ length: 999 }, (_, i) => mark(`old${i}`, 's1', true)),
			mark('sA', 's2', true),
			mark('sA', 's2', true)
		];
		const { data } = await runLoad(marks);
		expect(data.attendance.filter((r) => r.id === 'sA-s2')).toHaveLength(1);
		expect(new Set(data.attendance.map((r) => r.id)).size).toBe(data.attendance.length);
	});

	it('page one (1000 rows) read, page two failed: nothing of the partial read is kept', async () => {
		const marks = [
			...Array.from({ length: 1000 }, (_, i) => mark(`old${i}`, 's1', true)),
			mark('sA', 's2', true)
		];
		const { data, markCalls } = await runLoad(marks, { code: '08006' }, 1000);
		expect(markCalls.filter(([method]) => method === 'range')).toEqual([
			['range', 0, 999],
			['range', 1000, 1999]
		]);
		expect(data.currentMarks).toEqual({});
		expect(data.markedSessionIds).toEqual([]);
		expect(data.attendance).toEqual([]);
		expect(data.attendanceError).toBe(true);
		expect(data.loadError).toBe(true);
	});

	it("reads the class's current marks from attendance_current, never the raw rows", async () => {
		const { tables, markCalls } = await runLoad([mark('sB', 's1', true)]);
		expect(tables).not.toContain('attendance_records');
		expect(markCalls).toEqual(
			expect.arrayContaining([
				['eq', 'class_id', CLASS_ID],
				['range', 0, 999]
			])
		);
		expect(markCalls.filter(([method]) => method === 'range')).toEqual([['range', 0, 999]]);
	});

	it('a marked session: present is true, absent is false, keyed by session and student', async () => {
		const { data } = await runLoad([
			mark('sB', 's1', true),
			mark('sB', 's2', false),
			mark('sA', 's1', false)
		]);
		expect(data.currentMarks).toEqual({ 'sB:s1': true, 'sB:s2': false, 'sA:s1': false });
		expect(data.markedSessionIds.sort()).toEqual(['sA', 'sB']);
		expect(data.loadError).toBe(false);
	});

	it('the history has one line per session and student: the current mark', async () => {
		const { data } = await runLoad([mark('sB', 's1', false), mark('sA', 's1', true)]);
		expect(data.attendance).toEqual([
			expect.objectContaining({ studentId: 's1', sessionDate: '2026-09-20', present: false }),
			expect.objectContaining({ studentId: 's1', sessionDate: '2026-09-13', present: true })
		]);
	});

	it('partly marked: a student without a mark has no entry, and the session still counts as marked', async () => {
		const { data } = await runLoad([mark('sB', 's1', true), mark('sB', 's2', false)]);
		expect(data.currentMarks['sB:s3']).toBeUndefined();
		expect(data.markedSessionIds).toEqual(['sB']);
	});

	it('a session marked only for a student who has left the class is still marked', async () => {
		const { data } = await runLoad([mark('sA', 'gone', true)]);
		expect(data.markedSessionIds).toEqual(['sA']);
		expect(data.currentMarks).toEqual({});
		expect(data.attendance).toEqual([]);
	});

	it('pages past PostgREST max_rows (1000)', async () => {
		const marks = [
			...Array.from({ length: 1000 }, (_, i) => mark(`old${i}`, 's1', true)),
			mark('sA', 's2', true)
		];
		const { data, markCalls } = await runLoad(marks);
		expect(markCalls.filter(([method]) => method === 'range')).toEqual([
			['range', 0, 999],
			['range', 1000, 1999]
		]);
		expect(data.currentMarks['sA:s2']).toBe(true);
		expect(Object.keys(data.currentMarks)).toHaveLength(1001);
	});

	it('a failed read sets the load error and leaves the form blank', async () => {
		const { data } = await runLoad([mark('sB', 's1', true)], { code: '08006' });
		expect(data.loadError).toBe(true);
		expect(data.attendanceError).toBe(true);
		expect(data.currentMarks).toEqual({});
		expect(data.markedSessionIds).toEqual([]);
		expect(data.attendance).toEqual([]);
	});
});
