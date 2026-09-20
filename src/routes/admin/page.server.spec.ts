import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * Closes the Story 5-1 I/O matrix's "Any one query fails" row: `load()`
 * issues six parallel queries and OR-chains their errors into `loadError`,
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
		order: () => chain,
		range: () => chain,
		then: (resolve: (value: ChainResult) => unknown) => resolve(result)
	};
	return chain;
}

function fakeLocals(overrides: Partial<Record<string, ChainResult[]>> = {}) {
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
		supabase: {
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

	it('sets loadError true when any one of the six parallel queries fails (I/O matrix: "Any one query fails")', async () => {
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
