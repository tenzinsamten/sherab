import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * Closes the Story 5-1 I/O matrix's "Any one query fails" row: `load()`
 * issues seven parallel queries and OR-chains their errors into `loadError`,
 * but nothing exercised that chain directly. Mirrors Story 4-3's
 * `leaderboard/page.server.spec.ts` precedent -- `load()` is a plain async
 * function taking `locals`, so no SvelteKit test harness is needed, just a
 * mocked `locals.supabase` chain.
 *
 * `.from(table)` is called more than once per table in a single `load()` run
 * (the three separately-filtered `profiles` queries, and once per page inside
 * `fetchAllHistoryRows`'s `.range()` loop) -- a per-table *queue*, consumed in
 * call order, lets a test give each of those calls its own distinct result
 * instead of collapsing them onto one shared value (Review Triage Log #3/16/17).
 */
type ChainResult = { data?: unknown; count?: number | null; error: unknown };

function makeChain(result: ChainResult) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		neq: () => chain,
		order: () => chain,
		range: () => chain,
		then: (resolve: (value: ChainResult) => unknown) => resolve(result)
	};
	return chain;
}

function fakeLocals(
	overrides: Partial<Record<string, ChainResult[]>> = {},
	sickQueue: { data: unknown; error: unknown } = { data: [], error: null }
) {
	const ok: ChainResult = { data: [], count: 0, error: null };
	const queues: Record<string, ChainResult[]> = {
		classes: [ok],
		profiles: [ok, ok, ok],
		homework_assignments: [ok],
		homework_status_history: [ok],
		...overrides
	};
	const cursors: Record<string, number> = {};
	return {
		safeGetSession: async () => ({ session: {}, user: { id: 'admin-1' } }),
		supabase: {
			rpc: async () => sickQueue,
			from: (table: string) => {
				const queue = queues[table] ?? [ok];
				const i = Math.min(cursors[table] ?? 0, queue.length - 1);
				cursors[table] = (cursors[table] ?? 0) + 1;
				return makeChain(queue[i]);
			}
		}
	} as unknown as Parameters<typeof load>[0]['locals'];
}

function historyRow(overrides: {
	id: string;
	instance_id: string;
	student_id: string;
	status: 'assigned' | 'done' | 'reviewed';
	recorded_at: string;
}) {
	return { recorded_by: null, ...overrides };
}

describe('admin dashboard +page.server.ts load', () => {
	it('sets loadError false and zeroed defaults when every query succeeds with no rows', async () => {
		const result = await load({ locals: fakeLocals() } as Parameters<typeof load>[0]);

		expect(result).toEqual({
			classesCount: 0,
			teachersCount: 0,
			studentsCount: 0,
			pendingRequestsCount: 0,
			homeworkAssignmentsCount: 0,
			homeworkCompletionPercent: 0,
			loadError: false
		});
	});

	it('sets loadError true when any one of the seven parallel queries fails (I/O matrix: "Any one query fails")', async () => {
		const result = await load({
			locals: fakeLocals({
				homework_status_history: [{ data: null, error: { message: 'boom' } }]
			})
		} as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ loadError: true });
	});

	it('distinguishes the three separately-filtered profiles queries (teachers/approved-students/pending) rather than collapsing them onto one count', async () => {
		const result = await load({
			locals: fakeLocals({
				profiles: [
					{ data: [], count: 3, error: null }, // role='teacher'
					{ data: [], count: 5, error: null }, // role='student', status='approved'
					{ data: [], count: 2, error: null } // role='student', status='pending'
				]
			})
		} as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ teachersCount: 3, studentsCount: 5, pendingRequestsCount: 2 });
	});

	it('adds pending parent accounts to the pending requests count (Story 7-1)', async () => {
		const result = await load({
			locals: fakeLocals({
				profiles: [
					{ data: [], count: 0, error: null },
					{ data: [], count: 0, error: null },
					{ data: [], count: 2, error: null } // pending students
				],
				parents: [{ data: [], count: 3, error: null }] // pending parents
			})
		} as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ pendingRequestsCount: 5, loadError: false });
	});

	it('adds pending deletion requests the admin did not submit (Story 7-6)', async () => {
		const locals = fakeLocals({
			deletion_requests: [{ data: [], count: 4, error: null }]
		}) as unknown as { supabase: { from: (t: string) => Record<string, unknown> } };
		const neqCalls: unknown[][] = [];
		const from = locals.supabase.from;
		locals.supabase.from = (table: string) => {
			const chain = from(table);
			if (table === 'deletion_requests') {
				const neq = chain.neq as (...args: unknown[]) => unknown;
				chain.neq = (...args: unknown[]) => {
					neqCalls.push(args);
					return neq(...args);
				};
			}
			return chain;
		};
		const result = await load({ locals } as unknown as Parameters<typeof load>[0]);
		expect(result).toMatchObject({ pendingRequestsCount: 4, loadError: false });
		expect(neqCalls).toEqual([['requested_by', 'admin-1']]);

		const failed = await load({
			locals: fakeLocals({
				deletion_requests: [{ data: null, count: null, error: { message: 'x' } }]
			})
		} as Parameters<typeof load>[0]);
		expect(failed).toMatchObject({ loadError: true });
	});

	it('adds pending Sick leave the admin may decide, never their own child (Story 7-5)', async () => {
		const sick = (id: string, decision: string | null, ownChild: boolean) => ({
			class_session_id: `s-${id}`,
			student_id: `k-${id}`,
			student_name: id,
			class_id: 'c1',
			class_name: 'Alphabet',
			day: '2026-09-27',
			start_time: null,
			answered_at: '2026-09-27T08:00:00Z',
			decision,
			decided_at: decision ? '2026-09-27T09:00:00Z' : null,
			decided_by_system: false,
			own_child: ownChild
		});
		const result = await load({
			locals: fakeLocals(
				{
					profiles: [
						{ data: [], count: 0, error: null },
						{ data: [], count: 0, error: null },
						{ data: [], count: 1, error: null } // pending students
					]
				},
				{
					data: [
						sick('a', null, false),
						sick('b', null, true),
						sick('c', 'approved', false),
						sick('d', null, false)
					],
					error: null
				}
			)
		} as Parameters<typeof load>[0]);
		expect(result).toMatchObject({ pendingRequestsCount: 3, loadError: false });

		const failed = await load({
			locals: fakeLocals({}, { data: null, error: { message: 'boom' } })
		} as Parameters<typeof load>[0]);
		expect(failed).toMatchObject({ loadError: true });
	});

	it('continues past the first 1000-row page when fetching homework_status_history (Review Triage Log #16: pagination continuation)', async () => {
		// A full first page (pageSize=1000) of duplicate 'assigned' rows for one
		// pair -- dedup collapses these to a single assignedAt, so this page
		// alone yields totalAssigned=1, totalDoneOrReviewed=0 (0%).
		const fullPage = Array.from({ length: 1000 }, (_, i) =>
			historyRow({
				id: `p1-${i}`,
				instance_id: 'i0',
				student_id: 's0',
				status: 'assigned',
				recorded_at: '2026-01-01T00:00:00Z'
			})
		);
		// A short second page (length < pageSize) that must only be reached if
		// the `.range()` loop actually continues past the first page. It marks
		// a different pair 'done', which would push completion to 100% only if
		// this row is read.
		const shortPage = [
			historyRow({
				id: 'p2-0',
				instance_id: 'i1',
				student_id: 's1',
				status: 'done',
				recorded_at: '2026-01-02T00:00:00Z'
			})
		];

		const result = await load({
			locals: fakeLocals({
				homework_status_history: [
					{ data: fullPage, count: null, error: null },
					{ data: shortPage, count: null, error: null }
				]
			})
		} as Parameters<typeof load>[0]);

		expect(result).toMatchObject({ homeworkCompletionPercent: 100, loadError: false });
	});
});
