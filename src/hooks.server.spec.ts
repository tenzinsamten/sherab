import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/supabase/server', () => ({ createSupabaseServerClient: () => ({}) }));
vi.mock('$lib/paraglide/server', () => ({ paraglideMiddleware: () => new Response() }));

const { handleUnapprovedStudent } = await import('./hooks.server');

function token(claims: Record<string, unknown>): string {
	const part = (value: unknown) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${part({ alg: 'HS256' })}.${part(claims)}.signature`;
}

type Profile = { data: { status: string } | null; error: unknown };

function run(
	path: string,
	options: { email?: string | null; profile?: Profile; method?: string } = {}
) {
	const { email = 'tenzin@students.internal.invalid', method = 'GET' } = options;
	const profile = options.profile ?? { data: { status: 'pending' }, error: null };
	const maybeSingle = vi.fn(() => Promise.resolve(profile));
	const eq = vi.fn(() => ({ maybeSingle }));
	const select = vi.fn(() => ({ eq }));
	const from = vi.fn(() => ({ select }));
	const session = email === null ? null : { access_token: token({ sub: 'u1', email }) };
	const resolve = vi.fn(async () => new Response('ok'));
	const event = {
		url: new URL(`https://app.test${path}`),
		request: new Request(`https://app.test${path}`, { method }),
		locals: { supabase: { auth: { getSession: async () => ({ data: { session } }) }, from } }
	};
	const outcome = Promise.resolve()
		.then(() => handleUnapprovedStudent({ event, resolve } as never))
		.then(
			() => 'resolved' as const,
			(e: { status: number; location: string }) => e
		);
	return { outcome, resolve, from, select, eq };
}

const toPending = { status: 303, location: '/student/pending' };

describe('handleUnapprovedStudent (#100)', () => {
	it('lets a signed-out request through without a query', async () => {
		const { outcome, from } = run('/student', { email: null });
		expect(await outcome).toBe('resolved');
		expect(from).not.toHaveBeenCalled();
	});

	it.each(['teacher@example.com', 'parent@students.internal.invalid.example.com'])(
		'lets %s through without a query',
		async (email) => {
			const { outcome, from } = run('/teacher', { email });
			expect(await outcome).toBe('resolved');
			expect(from).not.toHaveBeenCalled();
		}
	);

	it('reads only the own profile status for a student', async () => {
		const { outcome, from, select, eq } = run('/student', {
			profile: { data: { status: 'approved' }, error: null }
		});
		expect(await outcome).toBe('resolved');
		expect(from).toHaveBeenCalledTimes(1);
		expect(from).toHaveBeenCalledWith('profiles');
		expect(select).toHaveBeenCalledWith('status');
		expect(eq).toHaveBeenCalledWith('id', 'u1');
	});

	it.each(['pending', 'rejected'])(
		'sends a %s student to the status page from any route',
		async (status) => {
			const profile = { data: { status }, error: null };
			for (const path of ['/', '/student', '/leaderboard', '/account', '/login', '/api/push']) {
				const { outcome, resolve } = run(path, { profile });
				expect(await outcome).toMatchObject(toPending);
				expect(resolve).not.toHaveBeenCalled();
			}
		}
	);

	it.each(['pending', 'rejected'])('stops a form post of a %s student', async (status) => {
		const { outcome, resolve } = run('/student?/markDone', {
			method: 'POST',
			profile: { data: { status }, error: null }
		});
		expect(await outcome).toMatchObject(toPending);
		expect(resolve).not.toHaveBeenCalled();
	});

	it.each(['/student/pending', '/logout'])('lets an unapproved student reach %s', async (path) => {
		const { outcome, resolve } = run(path, { method: path === '/logout' ? 'POST' : 'GET' });
		expect(await outcome).toBe('resolved');
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('lets a form post of an approved student through', async () => {
		const { outcome, resolve } = run('/student?/markDone', {
			method: 'POST',
			profile: { data: { status: 'approved' }, error: null }
		});
		expect(await outcome).toBe('resolved');
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it.each([
		['the profile cannot be read', { data: null, error: { message: 'x' } }],
		['there is no profile row', { data: null, error: null }]
	])('lets the request through when %s', async (_label, profile) => {
		for (const method of ['GET', 'POST']) {
			const { outcome, resolve } = run('/student', { method, profile });
			expect(await outcome).toBe('resolved');
			expect(resolve).toHaveBeenCalledTimes(1);
		}
	});

	it('lets a session with an unreadable token through without a query', async () => {
		const maybeFrom = vi.fn();
		const resolve = vi.fn(async () => new Response('ok'));
		await handleUnapprovedStudent({
			event: {
				url: new URL('https://app.test/student'),
				locals: {
					supabase: {
						auth: { getSession: async () => ({ data: { session: { access_token: 'junk' } } }) },
						from: maybeFrom
					}
				}
			},
			resolve
		} as never);
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(maybeFrom).not.toHaveBeenCalled();
	});
});
