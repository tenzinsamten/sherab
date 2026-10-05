import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

function resendEvent(email: string, resendError: unknown = null) {
	const body = new FormData();
	body.set('email', email);
	const resend = vi.fn().mockResolvedValue({ error: resendError });
	const event = {
		request: new Request('https://app.test/resend-confirmation', { method: 'POST', body }),
		url: new URL('https://app.test/resend-confirmation'),
		locals: { supabase: { auth: { resend } } }
	} as unknown as Parameters<typeof actions.default>[0];
	return { event, resend };
}

describe('resend-confirmation load', () => {
	it('prefills the email from the address', async () => {
		const result = await load({
			url: new URL('https://app.test/resend-confirmation?email=a%40b.de'),
			locals: { safeGetSession: async () => ({ session: null, user: null }) }
		} as unknown as Parameters<typeof load>[0]);
		expect(result).toEqual({ email: 'a@b.de' });
	});
});

describe('resend-confirmation action', () => {
	it('asks Supabase for a new sign-up link to the trimmed, lower-cased email', async () => {
		const { event, resend } = resendEvent('  Parent@Example.com ');
		const result = await actions.default(event);
		expect(resend).toHaveBeenCalledWith({
			type: 'signup',
			email: 'parent@example.com',
			options: { emailRedirectTo: 'https://app.test/auth/confirm?flow=signup' }
		});
		expect(result).toEqual({ success: true, email: 'parent@example.com' });
	});

	it('gives the same answer when Supabase refuses (rate limit, unknown address)', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { event } = resendEvent('parent@example.com', { message: 'rate limit' });
		expect(await actions.default(event)).toEqual({ success: true, email: 'parent@example.com' });
		log.mockRestore();
	});

	it('refuses something that is not an email, and a student login, without calling Supabase', async () => {
		for (const value of ['', 'tenzin.dolma', 'x@students.internal.invalid']) {
			const { event, resend } = resendEvent(value);
			const result = (await actions.default(event)) as { status: number };
			expect(result.status).toBe(400);
			expect(resend).not.toHaveBeenCalled();
		}
	});
});
