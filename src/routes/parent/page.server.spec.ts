import { describe, expect, it } from 'vitest';
import { load as layoutLoad } from './+layout.server';
import { load as pageLoad } from './+page.server';

function fakeSupabase(role: string, parentStatus: string | null) {
	return {
		from: (table: string) => {
			const result =
				table === 'profiles'
					? { data: { role }, error: null }
					: { data: parentStatus ? { status: parentStatus } : null, error: null };
			const chain = {
				select: () => chain,
				eq: () => chain,
				maybeSingle: () => Promise.resolve(result)
			};
			return chain;
		}
	};
}

const session = { user: { id: 'p1', email: 'p@example.com' } };

function runLayout(role: string, parentStatus: string | null, withSession = true) {
	return layoutLoad({
		parent: async () => ({ session: withSession ? session : null }),
		locals: { supabase: fakeSupabase(role, parentStatus) }
	} as unknown as Parameters<typeof layoutLoad>[0]);
}

function runPage(parentStatus: string, emailConfirmedAt: string | null) {
	return pageLoad({
		parent: async () => ({
			session,
			parentStatus,
			profile: { email: 'p@example.com', email_confirmed_at: emailConfirmedAt }
		})
	} as unknown as Parameters<typeof pageLoad>[0]);
}

describe('parent layout guard', () => {
	it('refuses a login without a parents row, even with profiles.role parent', async () => {
		await expect(runLayout('parent', null)).rejects.toMatchObject({ status: 403 });
		await expect(runLayout('teacher', null)).rejects.toMatchObject({ status: 403 });
	});

	it('sends a signed-out visitor to login', async () => {
		await expect(runLayout('parent', 'pending', false)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});

	it('passes the parent status through', async () => {
		expect(await runLayout('parent', 'pending')).toEqual({ parentStatus: 'pending' });
	});
});

describe('parent page state', () => {
	it.each([
		['pending', null, 'unconfirmed'],
		['approved', null, 'unconfirmed'],
		['pending', '2026-01-01T00:00:00Z', 'pending'],
		['approved', '2026-01-01T00:00:00Z', 'approved'],
		['rejected', '2026-01-01T00:00:00Z', 'rejected']
	])('status %s, confirmed %s -> %s', async (status, confirmedAt, state) => {
		expect(await runPage(status, confirmedAt)).toEqual({ state, email: 'p@example.com' });
	});
});
