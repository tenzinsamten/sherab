import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'de' }));

import { DELETE, POST } from './+server';

/**
 * /api/push/subscription (#92). Who may subscribe is the RPC's decision
 * (rls.spec.ts); here: a session is required, the body must be a real push
 * subscription, and the browser's language goes along.
 */
const subscription = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
	expirationTime: null,
	keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
};

function event(body: unknown, options: { signedIn?: boolean; error?: unknown } = {}) {
	const rpc = vi.fn(async () => ({ error: options.error ?? null }));
	return {
		rpc,
		e: {
			request: new Request('http://localhost/api/push/subscription', {
				method: 'POST',
				body: typeof body === 'string' ? body : JSON.stringify(body)
			}),
			locals: {
				supabase: { rpc },
				safeGetSession: async () => ({
					session: null,
					user: options.signedIn === false ? null : { id: 'u1' }
				})
			}
		} as unknown as Parameters<typeof POST>[0]
	};
}

describe('POST /api/push/subscription', () => {
	it('refuses a signed-out caller', async () => {
		const { e, rpc } = event(subscription, { signedIn: false });
		expect((await POST(e)).status).toBe(401);
		expect(rpc).not.toHaveBeenCalled();
	});

	it.each([
		['a body that is not JSON', 'not json'],
		['an endpoint that is no push service', { ...subscription, endpoint: 'https://example.org/x' }],
		['missing keys', { endpoint: subscription.endpoint }]
	])('refuses %s', async (_label, body) => {
		const { e, rpc } = event(body);
		expect((await POST(e)).status).toBe(400);
		expect(rpc).not.toHaveBeenCalled();
	});

	it("saves the subscription with this browser's language", async () => {
		const { e, rpc } = event(subscription);
		const response = await POST(e);
		expect(response.status).toBe(200);
		expect(rpc).toHaveBeenCalledWith('save_push_subscription', {
			p_endpoint: subscription.endpoint,
			p_p256dh: subscription.keys.p256dh,
			p_auth: subscription.keys.auth,
			p_locale: 'de'
		});
	});

	it('answers 403 to an account that may not subscribe', async () => {
		const { e } = event(subscription, { error: { code: '42501', message: 'not allowed' } });
		expect((await POST(e)).status).toBe(403);
	});

	it('answers 500 when saving fails', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { e } = event(subscription, { error: { code: 'XX000', message: 'boom' } });
		expect((await POST(e)).status).toBe(500);
		logged.mockRestore();
	});
});

describe('DELETE /api/push/subscription', () => {
	it('refuses a signed-out caller', async () => {
		const { e, rpc } = event({ endpoint: subscription.endpoint }, { signedIn: false });
		expect((await DELETE(e)).status).toBe(401);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('refuses an endpoint that is no push service', async () => {
		const { e, rpc } = event({ endpoint: 'https://example.org/x' });
		expect((await DELETE(e)).status).toBe(400);
		expect(rpc).not.toHaveBeenCalled();
	});

	it("removes the caller's subscription for that endpoint", async () => {
		const { e, rpc } = event({ endpoint: subscription.endpoint });
		expect((await DELETE(e)).status).toBe(200);
		expect(rpc).toHaveBeenCalledWith('delete_push_subscription', {
			p_endpoint: subscription.endpoint
		});
	});
});
