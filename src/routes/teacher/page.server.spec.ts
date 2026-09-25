import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/**
 * Teacher dashboard load (#24). Same approach as admin/page.server.spec.ts:
 * `load()` is a plain async function taking `locals`, so a mocked
 * `locals.supabase` chain is enough, with one queued result per table.
 */
type ChainResult = { data?: unknown; count?: number | null; error: unknown };

function makeChain(result: ChainResult) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		in: () => chain,
		order: () => chain,
		range: () => chain,
		then: (resolve: (value: ChainResult) => unknown) => resolve(result)
	};
	return chain;
}

const ok: ChainResult = { data: [], count: 0, error: null };
const oneClass: ChainResult = {
	data: [{ classes: { id: 'c1', name: 'Yaks', code: 'RV7V4W' } }],
	error: null
};

function fakeLocals(results: Partial<Record<string, ChainResult>>) {
	return {
		safeGetSession: async () => ({ session: null, user: { id: 't1' } }),
		supabase: {
			from: (table: string) => makeChain(results[table] ?? ok)
		}
	} as unknown as Parameters<typeof load>[0]['locals'];
}

async function run(results: Partial<Record<string, ChainResult>>) {
	return load({ locals: fakeLocals(results) } as Parameters<typeof load>[0]);
}

describe('teacher dashboard +page.server.ts load', () => {
	it('returns zeroed tiles when the teacher has no classes', async () => {
		expect(await run({ class_teachers: ok })).toEqual({
			classes: [],
			studentsCount: 0,
			dueThisWeek: 0,
			overdue: 0,
			awaitingReview: 0,
			completionPercent: 0,
			loadError: false
		});
	});

	it('returns the classes and counts when every query succeeds', async () => {
		const result = await run({
			class_teachers: oneClass,
			// s2 is in two of the teacher's classes and counts once (#42).
			class_enrollments: {
				data: [
					{ student_id: 's1' },
					{ student_id: 's2' },
					{ student_id: 's2' },
					{ student_id: 's3' },
					{ student_id: 's4' }
				],
				error: null
			}
		});
		expect(result).toMatchObject({
			classes: [{ id: 'c1', name: 'Yaks', code: 'RV7V4W' }],
			studentsCount: 4,
			loadError: false
		});
	});

	it.each(['class_enrollments', 'homework_instances', 'homework_status_history'])(
		'sets loadError when the %s query fails',
		async (table) => {
			const result = await run({
				class_teachers: oneClass,
				[table]: { data: null, count: null, error: { message: 'boom' } }
			});
			expect(result).toMatchObject({ loadError: true });
		}
	);

	it('sets loadError when the classes query fails', async () => {
		const result = await run({ class_teachers: { data: null, error: { message: 'boom' } } });
		expect(result).toMatchObject({ classes: [], loadError: true });
	});
});
