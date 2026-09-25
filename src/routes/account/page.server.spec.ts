import { describe, expect, it } from 'vitest';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import { actions, load } from './+page.server';

/**
 * /account (#23, #44). `load` reads the layout's profile via `parent()`;
 * student reads and the actions go through a mocked `locals.supabase` chain,
 * one queued result per table.
 */
type Result = { data?: unknown; error: unknown };

function makeChain(result: Result) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		in: () => chain,
		order: () => chain,
		maybeSingle: () => chain,
		single: () => chain,
		update: () => chain,
		then: (resolve: (value: Result) => unknown) => resolve(result)
	};
	return chain;
}

function fakeSupabase(results: Record<string, Result>) {
	return { from: (table: string) => makeChain(results[table] ?? { data: [], error: null }) };
}

const session = { user: { id: 'u1', email: 'x@example.com' } };

function runLoad(profile: Record<string, unknown> | null, results: Record<string, Result> = {}) {
	return load({
		parent: async () => ({ session, profile }),
		locals: { supabase: fakeSupabase(results) }
	} as unknown as Parameters<typeof load>[0]);
}

describe('account load', () => {
	it('gives a teacher their name and email only', async () => {
		const result = await runLoad({
			id: 'u1',
			role: 'teacher',
			display_name: 'Pema',
			email: 'pema@example.com'
		});
		expect(result).toEqual({ role: 'teacher', displayName: 'Pema', email: 'pema@example.com' });
	});

	it('gives a student their username, classes, streak and badges', async () => {
		const result = await runLoad(
			{
				id: 'u1',
				role: 'student',
				display_name: 'Tashi',
				email: `tashi-d@${STUDENT_EMAIL_DOMAIN}`
			},
			{
				class_enrollments: { data: [{ class_id: 'c1' }], error: null },
				classes: { data: [{ id: 'c1', name: 'Yaks' }], error: null },
				class_syllabi: { data: [{ class_id: 'c1' }], error: null },
				student_streaks: {
					data: { current_streak: 3, last_qualifying_week: '2026-09-21' },
					error: null
				},
				badges_earned: {
					data: [{ badge_type: 'homework', milestone: 5, earned_at: '2026-09-20T00:00:00Z' }],
					error: null
				}
			}
		);
		expect(result).toMatchObject({
			role: 'student',
			displayName: 'Tashi',
			username: 'tashi-d',
			classes: [{ id: 'c1', name: 'Yaks', hasSyllabus: true }],
			streak: { currentStreak: 3 },
			badges: [{ badgeType: 'homework', milestone: 5 }],
			loadError: false
		});
	});

	it('flags a failed student read', async () => {
		const result = await runLoad(
			{ id: 'u1', role: 'student', display_name: 'Tashi', email: null },
			{ class_enrollments: { data: null, error: { message: 'missing table' } } }
		);
		expect(result).toMatchObject({ classes: [], loadError: true });
	});

	it('refuses a session without a profile', async () => {
		await expect(runLoad(null)).rejects.toMatchObject({ status: 403 });
	});
});

describe('account actions', () => {
	function event(role: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		return {
			request: new Request('http://localhost/account', { method: 'POST', body }),
			locals: {
				supabase: fakeSupabase({ profiles: { data: { role }, error: null } }),
				safeGetSession: async () => ({ session, user: session.user })
			}
		} as unknown as Parameters<typeof actions.changePassword>[0];
	}

	it('does not let a student change their PIN here', async () => {
		const result = await actions.changePassword(
			event('student', { currentPassword: 'a', password: 'bbbbbb', confirm: 'bbbbbb' })
		);
		expect(result).toMatchObject({ status: 403 });
	});

	it('rejects an empty name before saving', async () => {
		const result = await actions.updateName(event('student', { displayName: '  ' }));
		expect(result).toMatchObject({ status: 400 });
	});
});
