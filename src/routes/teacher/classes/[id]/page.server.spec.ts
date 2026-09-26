import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { actions, load } from './+page.server';

// load's other data comes from these helpers; empty results keep the test on
// the markable-sessions query.
vi.mock('$lib/server/enrollments', () => ({
	loadClassRoster: async () => ({ students: [], error: null }),
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

	it('inserts one row per student against the session and reports the session day', async () => {
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
