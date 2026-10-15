import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBadgePage } from '$lib/server/badges';
import { load } from './+page.server';

vi.mock('$lib/server/badges', () => ({
	loadBadgePage: vi.fn(async () => ({ sections: [], loadError: false }))
}));

/** /student/badges (badge detail story 4): the student's own badge page. */
function runLoad(user: { id: string } | null, role: string | null) {
	const c = {
		select: () => c,
		eq: () => c,
		single: async () => ({ data: role ? { role } : null, error: null })
	};
	const supabase = { from: () => c };
	return load({
		locals: { supabase, safeGetSession: async () => ({ user }) }
	} as unknown as Parameters<typeof load>[0]);
}

describe('/student/badges load', () => {
	beforeEach(() => vi.mocked(loadBadgePage).mockClear());

	it('loads the badge page for the signed-in student', async () => {
		const result = await runLoad({ id: 's1' }, 'student');
		expect(result).toEqual({ sections: [], loadError: false });
		expect(loadBadgePage).toHaveBeenCalledWith(expect.anything(), 's1');
	});

	it('sends a signed-out visitor to /login', async () => {
		await expect(runLoad(null, null)).rejects.toMatchObject({ status: 303, location: '/login' });
	});

	it.each(['parent', 'teacher', 'admin'])('sends a %s home', async (role) => {
		await expect(runLoad({ id: 'u1' }, role)).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(loadBadgePage).not.toHaveBeenCalled();
	});
});
