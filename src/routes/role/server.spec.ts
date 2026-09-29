import { describe, expect, it } from 'vitest';
import { POST } from './+server';

/**
 * POST /role (B13 #68): a fake `locals.supabase` answers the caller's
 * profile role and parents row (getCapabilities); `set` records the cookie.
 */
function run(opts: {
	role: string;
	parentStatus: string | null;
	requested: string | null;
	signedOut?: boolean;
	profileError?: boolean;
	body?: BodyInit;
}) {
	const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
	const supabase = {
		from: (table: string) => {
			const result =
				table === 'profiles'
					? opts.profileError
						? { data: null, error: { message: 'boom' } }
						: { data: { role: opts.role }, error: null }
					: { data: opts.parentStatus ? { status: opts.parentStatus } : null, error: null };
			const chain = {
				select: () => chain,
				eq: () => chain,
				maybeSingle: async () => result
			};
			return chain;
		}
	};
	const body = new FormData();
	if (opts.requested !== null) body.append('role', opts.requested);
	const outcome = Promise.resolve()
		.then(() =>
			POST({
				request: new Request('http://localhost/role', { method: 'POST', body: opts.body ?? body }),
				cookies: {
					set: (name: string, value: string, options: Record<string, unknown>) =>
						set.push({ name, value, options })
				},
				locals: {
					supabase,
					safeGetSession: async () => ({ user: opts.signedOut ? null : { id: 'u1' } })
				}
			} as unknown as Parameters<typeof POST>[0])
		)
		.then(
			() => ({ status: 200, location: null as string | null }),
			(e: { status: number; location?: string }) => ({
				status: e.status,
				location: e.location ?? null
			})
		);
	return { outcome, set };
}

describe('POST /role', () => {
	it('sets the cookie and lands a teacher-parent on /parent', async () => {
		const { outcome, set } = run({
			role: 'teacher',
			parentStatus: 'approved',
			requested: 'parent'
		});
		expect(await outcome).toEqual({ status: 303, location: '/parent' });
		expect(set).toEqual([
			{
				name: 'active_role',
				value: 'parent',
				options: expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' })
			}
		]);
	});

	it('switches back to the staff role', async () => {
		const { outcome, set } = run({ role: 'admin', parentStatus: 'approved', requested: 'admin' });
		expect(await outcome).toEqual({ status: 303, location: '/admin' });
		expect(set[0]?.value).toBe('admin');
	});

	it('refuses a role the login does not hold', async () => {
		const { outcome, set } = run({ role: 'teacher', parentStatus: 'approved', requested: 'admin' });
		expect((await outcome).status).toBe(403);
		expect(set).toEqual([]);
	});

	it('refuses parent for a pending parent', async () => {
		const { outcome, set } = run({ role: 'teacher', parentStatus: 'pending', requested: 'parent' });
		expect((await outcome).status).toBe(403);
		expect(set).toEqual([]);
	});

	it('refuses a missing or unknown role', async () => {
		expect(
			(await run({ role: 'teacher', parentStatus: null, requested: null }).outcome).status
		).toBe(403);
		expect(
			(await run({ role: 'teacher', parentStatus: null, requested: 'root' }).outcome).status
		).toBe(403);
	});

	it('sends a signed-out caller to /login', async () => {
		const { outcome, set } = run({
			role: 'teacher',
			parentStatus: 'approved',
			requested: 'parent',
			signedOut: true
		});
		expect(await outcome).toEqual({ status: 303, location: '/login' });
		expect(set).toEqual([]);
	});

	it('is a 503, not a 403, when the roles cannot be read', async () => {
		const { outcome, set } = run({
			role: 'teacher',
			parentStatus: 'approved',
			requested: 'parent',
			profileError: true
		});
		expect((await outcome).status).toBe(503);
		expect(set).toEqual([]);
	});

	it('is a 400 for a body that is not a form', async () => {
		const { outcome, set } = run({
			role: 'teacher',
			parentStatus: 'approved',
			requested: null,
			body: '{"role":"parent"}'
		});
		expect((await outcome).status).toBe(400);
		expect(set).toEqual([]);
	});
});
