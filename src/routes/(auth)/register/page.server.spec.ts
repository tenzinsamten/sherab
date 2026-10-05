import { beforeEach, describe, expect, it, vi } from 'vitest';

const emailHasLogin = vi.fn();
vi.mock('$lib/server/parent-registration', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/parent-registration')>()),
	emailHasLogin: (...args: unknown[]) => emailHasLogin(...args)
}));
vi.mock('$lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({}) }));

const { actions } = await import('./+page.server');

function registerEvent() {
	const body = new FormData();
	body.set('displayName', 'Dolma');
	body.set('email', 'Dolma@Example.com');
	body.set('password', 'secret123');
	body.set('confirm', 'secret123');
	const now = new Date().toISOString();
	const signUp = vi.fn().mockResolvedValue({
		data: { user: { identities: [{}], created_at: now, updated_at: now }, session: null },
		error: null
	});
	const signOut = vi.fn().mockResolvedValue({ error: null });
	const event = {
		request: new Request('https://app.test/register', { method: 'POST', body }),
		url: new URL('https://app.test/register'),
		locals: { supabase: { auth: { signUp, signOut } } }
	} as unknown as Parameters<typeof actions.register>[0];
	return { event, signUp };
}

describe('register action', () => {
	beforeEach(() => {
		emailHasLogin.mockReset();
	});

	it('signs up a parent with the signup confirmation redirect', async () => {
		emailHasLogin.mockResolvedValue(false);
		const { event, signUp } = registerEvent();
		const result = await actions.register(event);

		expect(signUp).toHaveBeenCalledTimes(1);
		const args = signUp.mock.calls[0][0];
		expect(args.email).toBe('dolma@example.com');
		expect(args.options.data.role).toBe('parent');
		expect(args.options.emailRedirectTo.endsWith('/auth/confirm?flow=signup')).toBe(true);
		expect(result).toEqual({ success: true, email: 'dolma@example.com' });
	});

	it('refuses an existing email with the generic message and never signs up', async () => {
		emailHasLogin.mockResolvedValue(true);
		const { event, signUp } = registerEvent();
		const result = await actions.register(event);

		expect(result).toMatchObject({
			status: 400,
			data: {
				error:
					'An account with this email already exists. Sign in instead. If you are a teacher and also a parent, sign in and use “Request parent access” under My Account.'
			}
		});
		expect(signUp).not.toHaveBeenCalled();
	});

	it('fails with 500 and never signs up when the lookup throws', async () => {
		emailHasLogin.mockImplementation(async () => {
			throw new Error('db down');
		});
		const { event, signUp } = registerEvent();
		const result = await actions.register(event);

		expect(result).toMatchObject({ status: 500 });
		expect(signUp).not.toHaveBeenCalled();
	});
});
