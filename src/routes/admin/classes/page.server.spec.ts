import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { actions } from './+page.server';

/**
 * /admin/classes `create` (Story 6-4 matrix row "New class"): the schedule
 * is part of the create form. An invalid one inserts nothing; a valid one is
 * written in the class insert itself (the insert trigger then creates the
 * class's sessions per that schedule -- covered by the Story 6-4 block in
 * rls.spec.ts), with no follow-up rpc. FormData event + a fake
 * `locals.supabase` recording inserts and rpc calls.
 */
function fakeSupabase() {
	const inserted: unknown[] = [];
	const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
	const created = { id: 'c-new', name: 'Grammar', code: 'ABC123', created_at: '2026-09-26' };
	const chain = {
		insert: (row: unknown) => {
			inserted.push(row);
			return chain;
		},
		select: () => chain,
		single: async () => ({ data: created, error: null })
	};
	return {
		inserted,
		rpcCalls,
		created,
		client: {
			from: () => chain,
			rpc: async (fn: string, args: Record<string, unknown>) => {
				rpcCalls.push({ fn, args });
				return { error: null };
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
		request: new Request('http://localhost/admin/classes', { method: 'POST', body }),
		locals: {
			supabase,
			safeGetSession: async () => ({ user: { id: 'admin-1' } })
		}
	} as unknown as Parameters<typeof actions.create>[0];
}

describe('admin classes create: schedule at creation (Story 6-4)', () => {
	const today = todayInBerlin();

	it('invalid schedule (no weekday, until before from): fail 400 with inline errors, no class inserted', async () => {
		const fake = fakeSupabase();
		const result = await actions.create(
			event(
				{
					name: 'Grammar',
					startTime: '10:00',
					durationMinutes: '90',
					startsOn: '2026-10-10',
					endsOn: '2026-10-01'
				},
				fake.client
			)
		);
		expect(result).toMatchObject({
			status: 400,
			data: {
				name: 'Grammar',
				scheduleErrors: {
					weekdays: m.calendar_error_weekdays_required(),
					endsOn: m.calendar_error_until_before_from()
				}
			}
		});
		expect(fake.inserted).toEqual([]);
		expect(fake.rpcCalls).toEqual([]);
	});

	it('an empty name and an invalid schedule are reported together', async () => {
		const fake = fakeSupabase();
		const result = await actions.create(
			event({ name: '  ', startTime: '', durationMinutes: '', startsOn: today }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: {
				error: m.classes_error_name_required(),
				scheduleErrors: { weekdays: m.calendar_error_weekdays_required() }
			}
		});
		expect(fake.inserted).toEqual([]);
	});

	it('invalid duration or time: nothing inserted', async () => {
		for (const bad of [{ durationMinutes: '5' }, { startTime: '25:00' }]) {
			const fake = fakeSupabase();
			const result = await actions.create(
				event(
					{
						name: 'Grammar',
						weekday: '7',
						startTime: '10:00',
						durationMinutes: '90',
						startsOn: today,
						...bad
					},
					fake.client
				)
			);
			expect(result).toMatchObject({ status: 400 });
			expect(fake.inserted).toEqual([]);
			expect(fake.rpcCalls).toEqual([]);
		}
	});

	it('valid schedule (Sun, 10:00, 90 min, from today): the class insert carries the schedule, no rpc', async () => {
		const fake = fakeSupabase();
		const result = await actions.create(
			event(
				{
					name: 'Grammar',
					weekday: '7',
					startTime: '10:00',
					durationMinutes: '90',
					startsOn: today,
					endsOn: ''
				},
				fake.client
			)
		);
		expect(fake.inserted).toHaveLength(1);
		expect(fake.inserted[0]).toMatchObject({
			name: 'Grammar',
			created_by: 'admin-1',
			schedule_weekdays: [7],
			schedule_starts_on: today,
			schedule_ends_on: null,
			schedule_interval_weeks: 1,
			default_start_time: '10:00',
			default_duration_minutes: 90
		});
		expect(fake.rpcCalls).toEqual([]);
		expect(result).toEqual({ success: true, class: fake.created, name: 'Grammar' });
	});

	it('repeat every 2 weeks (issue #51): the class insert carries the interval', async () => {
		const fake = fakeSupabase();
		await actions.create(
			event({ name: 'Grammar', weekday: '7', startsOn: today, intervalWeeks: '2' }, fake.client)
		);
		expect(fake.inserted).toHaveLength(1);
		expect(fake.inserted[0]).toMatchObject({ schedule_interval_weeks: 2 });
	});

	it('an invalid interval (5): inline error on Repeats, nothing inserted', async () => {
		const fake = fakeSupabase();
		const result = await actions.create(
			event({ name: 'Grammar', weekday: '7', startsOn: today, intervalWeeks: '5' }, fake.client)
		);
		expect(result).toMatchObject({
			status: 400,
			data: { scheduleErrors: { intervalWeeks: m.calendar_error_interval_invalid() } }
		});
		expect(fake.inserted).toEqual([]);
	});
});
