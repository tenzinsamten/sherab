import { describe, expect, it } from 'vitest';
import { getCapabilities, isApprovedParent } from './capabilities';

type Result = { data: unknown; error: unknown };

function fakeSupabase(results: Record<string, Result>) {
	return {
		from: (table: string) => {
			const result = results[table] ?? { data: null, error: null };
			const chain = {
				select: () => chain,
				eq: () => chain,
				maybeSingle: () => Promise.resolve(result)
			};
			return chain;
		}
	} as unknown as Parameters<typeof getCapabilities>[0];
}

describe('getCapabilities', () => {
	it('returns the role and the parents row status', async () => {
		const caps = await getCapabilities(
			fakeSupabase({
				profiles: { data: { role: 'parent' }, error: null },
				parents: { data: { status: 'pending' }, error: null }
			}),
			'u1'
		);
		expect(caps).toEqual({ role: 'parent', parentStatus: 'pending' });
	});

	it('gives no parent status to a login without a parents row', async () => {
		const caps = await getCapabilities(
			fakeSupabase({ profiles: { data: { role: 'teacher' }, error: null } }),
			'u1'
		);
		expect(caps).toEqual({ role: 'teacher', parentStatus: null });
	});

	it('does not infer parent capability from profiles.role alone', async () => {
		const caps = await getCapabilities(
			fakeSupabase({ profiles: { data: { role: 'parent' }, error: null } }),
			'u1'
		);
		expect(isApprovedParent(caps)).toBe(false);
	});

	it('is null without a profile or when a read fails', async () => {
		expect(await getCapabilities(fakeSupabase({}), 'u1')).toBeNull();
		expect(
			await getCapabilities(
				fakeSupabase({
					profiles: { data: { role: 'parent' }, error: null },
					parents: { data: null, error: { message: 'boom' } }
				}),
				'u1'
			)
		).toBeNull();
	});

	it('treats only an approved row as a parent', () => {
		expect(isApprovedParent({ role: 'parent', parentStatus: 'approved' })).toBe(true);
		expect(isApprovedParent({ role: 'parent', parentStatus: 'rejected' })).toBe(false);
		expect(isApprovedParent(null)).toBe(false);
	});
});
