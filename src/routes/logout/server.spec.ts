import { describe, expect, it } from 'vitest';
import { POST } from './+server';

describe('POST /logout', () => {
	it('signs out, clears the active role cookie (B13) and goes to /login', async () => {
		const deleted: { name: string; options: Record<string, unknown> }[] = [];
		let signedOut = false;
		const outcome = await Promise.resolve()
			.then(() =>
				POST({
					cookies: {
						delete: (name: string, options: Record<string, unknown>) =>
							deleted.push({ name, options })
					},
					locals: {
						supabase: {
							auth: {
								signOut: async () => {
									signedOut = true;
								}
							}
						}
					}
				} as unknown as Parameters<typeof POST>[0])
			)
			.then(
				() => null,
				(e: { status: number; location: string }) => e
			);
		expect(outcome).toMatchObject({ status: 303, location: '/login' });
		expect(signedOut).toBe(true);
		expect(deleted).toEqual([{ name: 'active_role', options: { path: '/' } }]);
	});
});
