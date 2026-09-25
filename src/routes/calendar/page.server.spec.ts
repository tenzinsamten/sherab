import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { actions } from './+page.server';

/**
 * /calendar actions (Story 6-1): FormData event + a fake `locals.supabase`
 * chain, one queued result per table. `upserted` records the rows
 * addClassDays sent.
 */
type Result = { data?: unknown; error: unknown };

function fakeSupabase(results: Record<string, Result>, role = 'admin') {
	const upserted: unknown[] = [];
	function chain(result: Result) {
		const c = {
			select: () => c,
			eq: () => c,
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
		client: {
			from: (table: string) =>
				chain(
					table === 'profiles'
						? { data: { role }, error: null }
						: (results[table] ?? { data: [], error: null })
				),
			rpc: async () => ({ error: null })
		}
	};
}

function event(
	fields: Record<string, string>,
	supabase: ReturnType<typeof fakeSupabase>['client']
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://localhost/calendar', { method: 'POST', body }),
		locals: {
			supabase,
			safeGetSession: async () => ({ user: { id: 'u1' } })
		}
	} as unknown as Parameters<typeof actions.addClassDays>[0];
}

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
