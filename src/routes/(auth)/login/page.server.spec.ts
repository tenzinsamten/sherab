import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

function loginEvent(signInError: unknown, resendError: unknown = null) {
	const body = new FormData();
	body.set('email', 'parent@example.com');
	body.set('password', 'secret123');
	const signInWithPassword = vi.fn().mockResolvedValue({ error: signInError });
	const resend = vi.fn().mockResolvedValue({ error: resendError });
	const event = {
		request: new Request('https://app.test/login', { method: 'POST', body }),
		url: new URL('https://app.test/login'),
		locals: { supabase: { auth: { signInWithPassword, resend } } }
	} as unknown as Parameters<typeof actions.default>[0];
	return { event, signInWithPassword, resend };
}

describe('login load', () => {
	it('flags a failed confirmation link from ?error=confirm', async () => {
		const result = await load({
			url: new URL('https://app.test/login?error=confirm'),
			locals: { safeGetSession: async () => ({ session: null, user: null }) }
		} as unknown as Parameters<typeof load>[0]);
		expect(result).toEqual({ confirmLinkFailed: true });
	});

	it('does not flag it without the param', async () => {
		const result = await load({
			url: new URL('https://app.test/login'),
			locals: { safeGetSession: async () => ({ session: null, user: null }) }
		} as unknown as Parameters<typeof load>[0]);
		expect(result).toEqual({ confirmLinkFailed: false });
	});
});

describe('login action', () => {
	it('resends the confirmation link for an unconfirmed email and says so', async () => {
		const { event, resend } = loginEvent({ code: 'email_not_confirmed', message: 'x' });
		const result = await actions.default(event);
		expect(resend).toHaveBeenCalledWith({
			type: 'signup',
			email: 'parent@example.com',
			options: { emailRedirectTo: 'https://app.test/auth/confirm?flow=signup' }
		});
		expect(result).toMatchObject({
			status: 400,
			data: { error: expect.stringContaining('new confirmation link') }
		});
	});

	it('does not resend on a wrong password', async () => {
		const { event, resend } = loginEvent({ code: 'invalid_credentials', message: 'x' });
		const result = await actions.default(event);
		expect(resend).not.toHaveBeenCalled();
		expect(result).toMatchObject({ status: 400 });
	});
});
