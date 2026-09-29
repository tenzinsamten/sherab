import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

/** `/` redirect (B13 #68): signed-in users land on their active role's home. */
function run(
	parentData: { profile: { role: string } | null; activeRole: string | null },
	search = ''
) {
	return Promise.resolve()
		.then(() =>
			load({
				parent: async () => parentData,
				url: new URL(`http://localhost/${search}`)
			} as unknown as Parameters<typeof load>[0])
		)
		.then(
			(data) => ({ data, status: 200, location: null as string | null }),
			(e: { status: number; location: string }) => ({
				data: null,
				status: e.status,
				location: e.location
			})
		);
}

describe('/ redirect', () => {
	it('sends a teacher-parent with Parent active to /parent, query kept', async () => {
		expect(await run({ profile: { role: 'teacher' }, activeRole: 'parent' }, '?x=1')).toMatchObject(
			{
				status: 303,
				location: '/parent?x=1'
			}
		);
	});

	it('falls back to the profile role without an active role', async () => {
		expect(await run({ profile: { role: 'teacher' }, activeRole: null })).toMatchObject({
			status: 303,
			location: '/teacher'
		});
	});

	it('shows the landing page when signed out', async () => {
		expect(await run({ profile: null, activeRole: null })).toMatchObject({
			status: 200,
			data: {}
		});
	});
});
