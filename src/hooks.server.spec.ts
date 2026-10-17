import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

vi.mock('$lib/supabase/server', () => ({ createSupabaseServerClient: () => ({}) }));
vi.mock('$lib/paraglide/server', () => ({ paraglideMiddleware: () => new Response() }));

const { createSafeGetSession, handleUnapprovedStudent } = await import('./hooks.server');

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

describe('safeGetSession (CAP-1)', () => {
	const claims = {
		sub: 'u1',
		email: 'admin@example.com',
		app_metadata: { provider: 'email' },
		user_metadata: { name: 'A' },
		role: 'authenticated'
	};

	function client(options: { session?: unknown; claimsResult?: unknown } = {}) {
		const session = 'session' in options ? options.session : { access_token: 'jwt-token' };
		const getSession = vi.fn(async () => ({ data: { session }, error: null }));
		const getClaims = vi.fn(
			async () =>
				options.claimsResult ?? { data: { claims, header: {}, signature: [] }, error: null }
		);
		const getUser = vi.fn(async () => ({ data: { user: null }, error: { message: 'no' } }));
		const supabase = { auth: { getSession, getClaims, getUser } };
		return {
			safeGetSession: createSafeGetSession(supabase as never),
			getSession,
			getClaims,
			getUser
		};
	}

	it('builds the user from the verified claims, without asking Supabase Auth', async () => {
		const { safeGetSession, getClaims, getUser } = client();
		const result = await safeGetSession();
		expect(result.session).toEqual({ access_token: 'jwt-token' });
		expect(result.user).toEqual({
			id: 'u1',
			email: 'admin@example.com',
			app_metadata: { provider: 'email' },
			user_metadata: { name: 'A' }
		});
		expect(getClaims).toHaveBeenCalledWith('jwt-token');
		expect(getUser).not.toHaveBeenCalled();
	});

	it('gives no session and skips verification without an auth cookie', async () => {
		const { safeGetSession, getClaims, getUser } = client({ session: null });
		expect(await safeGetSession()).toEqual({ session: null, user: null });
		expect(getClaims).not.toHaveBeenCalled();
		expect(getUser).not.toHaveBeenCalled();
	});

	it.each([
		['expired', { data: null, error: { name: 'AuthInvalidJwtError', message: 'JWT has expired' } }],
		[
			'tampered',
			{ data: null, error: { name: 'AuthInvalidJwtError', message: 'Invalid JWT signature' } }
		],
		[
			'unknown kid',
			{ data: null, error: { name: 'AuthInvalidJwtError', message: 'No matching signing key' } }
		],
		['claim-less', { data: null, error: null }]
	])('gives no session for a %s token', async (_label, claimsResult) => {
		const { safeGetSession } = client({ claimsResult });
		expect(await safeGetSession()).toEqual({ session: null, user: null });
	});

	it('gives no session when reading the session throws', async () => {
		const { safeGetSession, getSession, getClaims } = client();
		getSession.mockRejectedValueOnce(new Error('boom'));
		expect(await safeGetSession()).toEqual({ session: null, user: null });
		expect(getClaims).not.toHaveBeenCalled();
	});

	it('gives no session when verification throws', async () => {
		const { safeGetSession, getClaims } = client();
		getClaims.mockRejectedValueOnce(new Error('boom'));
		expect(await safeGetSession()).toEqual({ session: null, user: null });
	});

	it('verifies once when called twice in one request', async () => {
		const { safeGetSession, getSession, getClaims } = client();
		const [first, second] = await Promise.all([safeGetSession(), safeGetSession()]);
		const third = await safeGetSession();
		expect(second).toBe(first);
		expect(third).toBe(first);
		expect(getSession).toHaveBeenCalledTimes(1);
		expect(getClaims).toHaveBeenCalledTimes(1);
	});

	it('does not share a result across requests', async () => {
		const a = client();
		const b = client({ session: null });
		expect((await a.safeGetSession()).user?.id).toBe('u1');
		expect(await b.safeGetSession()).toEqual({ session: null, user: null });
		expect(a.getClaims).toHaveBeenCalledTimes(1);
	});
});

/**
 * createSafeGetSession with a real client against local Supabase, like
 * student-pin.spec.ts. Skipped when local Supabase isn't reachable. Local
 * tokens are HS256, so nothing here is about network calls.
 */
async function isSupabaseReachable(): Promise<boolean> {
	try {
		const res = await fetch(`${PUBLIC_SUPABASE_URL}/auth/v1/health`, {
			signal: AbortSignal.timeout(1500)
		});
		return res.ok;
	} catch {
		return false;
	}
}

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)('safeGetSession against local Supabase (CAP-1)', () => {
	const service = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const email = `cap1-${crypto.randomUUID().slice(0, 8)}@example.test`;
	const password = crypto.randomUUID();
	let userId: string | undefined;

	function anonClient() {
		return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
	}

	beforeAll(async () => {
		const { data, error } = await service.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			app_metadata: { role: 'teacher' }
		});
		if (error || !data.user) throw new Error(`create user: ${error?.message}`);
		userId = data.user.id;
	});

	afterAll(async () => {
		if (userId) await service.auth.admin.deleteUser(userId);
	});

	it('returns the signed-in user from the verified token', async () => {
		const supabase = anonClient();
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		expect(error).toBeNull();

		const { session, user } = await createSafeGetSession(supabase)();
		expect(session).not.toBeNull();
		expect(user?.id).toBe(userId);
		expect(user?.email).toBe(email);
		expect(user?.app_metadata).toMatchObject({ role: 'teacher' });
	});

	it('gives no session for a tampered access token', async () => {
		const signedIn = anonClient();
		const { data, error } = await signedIn.auth.signInWithPassword({ email, password });
		expect(error).toBeNull();
		const [header, payload, signature] = data.session!.access_token.split('.');
		const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
		const tampered = { ...data.session!, access_token: `${header}.${payload}.${flipped}` };

		const supabase = anonClient();
		vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
			data: { session: tampered },
			error: null
		});
		expect(await createSafeGetSession(supabase)()).toEqual({ session: null, user: null });
	});
});
