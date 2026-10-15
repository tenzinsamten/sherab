import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBadgePage } from '$lib/server/badges';
import { load } from './+page.server';

vi.mock('$lib/server/badges', () => ({
	loadBadgePage: vi.fn(async () => ({ sections: [], loadError: false }))
}));

/** /parent/children/[id]/badges (badge detail story 4): a linked parent's view. */
const CHILD = '11111111-2222-4333-8444-555555555555';
const approvedChild = { id: CHILD, name: 'Dawa', status: 'approved' };

function runLoad(linked: unknown[], id = CHILD, parentStatus = 'approved') {
	const supabase = { rpc: vi.fn(async () => ({ data: linked, error: null })) };
	return load({
		params: { id },
		parent: async () => ({ parentStatus }),
		locals: { supabase }
	} as unknown as Parameters<typeof load>[0]);
}

describe('/parent/children/[id]/badges load', () => {
	beforeEach(() => vi.mocked(loadBadgePage).mockClear());

	it("loads the linked child's badge page", async () => {
		const result = await runLoad([approvedChild]);
		expect(result).toEqual({
			child: { id: CHILD, name: 'Dawa' },
			sections: [],
			loadError: false
		});
		expect(loadBadgePage).toHaveBeenCalledWith(expect.anything(), CHILD);
	});

	it.each([
		['a parent who is not approved', 'pending', CHILD, [approvedChild]],
		['a malformed id', 'approved', 'not-a-uuid', [approvedChild]],
		["another parent's child", 'approved', CHILD, []],
		['a pending child', 'approved', CHILD, [{ ...approvedChild, status: 'pending' }]]
	])('404 for %s', async (_label, status, id, linked) => {
		await expect(runLoad(linked, id, status)).rejects.toMatchObject({ status: 404 });
		expect(loadBadgePage).not.toHaveBeenCalled();
	});
});
