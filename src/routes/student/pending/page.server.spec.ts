import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

type Result = { data: unknown; error: unknown };

function run(profile: Result, user: { id: string } | null = { id: 's1' }) {
	const calls: unknown[][] = [];
	const chain = {
		select: (...args: unknown[]) => (calls.push(['select', ...args]), chain),
		eq: (...args: unknown[]) => (calls.push(['eq', ...args]), chain),
		maybeSingle: () => Promise.resolve(profile)
	};
	const outcome = Promise.resolve()
		.then(() =>
			load({
				locals: {
					supabase: { from: (table: string) => (calls.push(['from', table]), chain) },
					safeGetSession: async () => ({ session: user ? {} : null, user })
				}
			} as unknown as Parameters<typeof load>[0])
		)
		.then(
			(data) => ({ data }),
			(e: { status: number; location: string }) => ({ redirect: e })
		);
	return { outcome, calls };
}

const student = (status: string): Result => ({
	data: { role: 'student', status, registration_name: 'Tenzin Dolma' },
	error: null
});

describe('student pending page load (#100)', () => {
	it('sends a signed-out visitor to /login', async () => {
		expect(await run(student('pending'), null).outcome).toMatchObject({
			redirect: { status: 303, location: '/login' }
		});
	});

	it('shows the pending state, reading only the own row', async () => {
		const { outcome, calls } = run(student('pending'));
		expect(await outcome).toEqual({
			data: { state: 'pending', name: 'Tenzin Dolma', loadError: false }
		});
		expect(calls).toContainEqual(['from', 'profiles']);
		expect(calls).toContainEqual(['eq', 'id', 's1']);
	});

	it('shows the not-accepted state for a rejected student', async () => {
		expect(await run(student('rejected')).outcome).toEqual({
			data: { state: 'rejected', name: 'Tenzin Dolma', loadError: false }
		});
	});

	it('sends an approved student to the dashboard', async () => {
		expect(await run(student('approved')).outcome).toMatchObject({
			redirect: { status: 303, location: '/student' }
		});
	});

	it('sends any other role to its own start page', async () => {
		expect(
			await run({ data: { role: 'teacher', status: 'approved' }, error: null }).outcome
		).toMatchObject({ redirect: { status: 303, location: '/' } });
	});

	it('flags a load error when the profile cannot be read', async () => {
		expect(await run({ data: null, error: { message: 'x' } }).outcome).toEqual({
			data: { state: 'pending', name: '', loadError: true }
		});
	});
});
