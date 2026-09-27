import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayInBerlin } from '$lib/berlin-date';
import { load } from './+page.server';

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
				description: null,
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

function run(
	tables: Record<string, Result>,
	rpc: Result = leaderboard,
	countsResult: Result = counts
) {
	const calls: { name: string; args: unknown }[] = [];
	const supabase = {
		from: (table: string) => makeChain(tables[table] ?? { data: [], error: null }),
		rpc: async (name: string, args?: unknown) => {
			calls.push({ name, args });
			return name === 'homework_counts' ? countsResult : rpc;
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
