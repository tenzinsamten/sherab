import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

/**
 * /api/tours/seen (#101): a session is required and the id must be a tour;
 * the RPC (0044, rls.spec.ts) writes the caller's own row.
 */
function event(body: unknown, options: { signedIn?: boolean; error?: unknown } = {}) {
	const rpc = vi.fn(async () => ({ error: options.error ?? null }));
	return {
		rpc,
		e: {
			request: new Request('http://localhost/api/tours/seen', {
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

describe('POST /api/tours/seen', () => {
	it('refuses a signed-out caller', async () => {
		const { e, rpc } = event({ tour: 'teacher-class' }, { signedIn: false });
		expect((await POST(e)).status).toBe(401);
		expect(rpc).not.toHaveBeenCalled();
	});

	it.each([
		['a body that is not JSON', 'not json'],
		['no tour', {}],
		['an id that is no tour', { tour: 'welcome' }],
		['an id that is not text', { tour: ['teacher-class'] }],
		['null', null]
	])('refuses %s and stores nothing', async (_label, body) => {
		const { e, rpc } = event(body);
		expect((await POST(e)).status).toBe(400);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('marks the tour seen for the caller', async () => {
		const { e, rpc } = event({ tour: 'teacher-class' });
		const response = await POST(e);
		expect(response.status).toBe(200);
		expect(rpc).toHaveBeenCalledExactlyOnceWith('mark_tour_seen', { p_tour: 'teacher-class' });
	});

	it('answers 500 and logs when saving fails', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { e } = event({ tour: 'teacher-class' }, { error: { code: 'XX000', message: 'boom' } });
		expect((await POST(e)).status).toBe(500);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});
});
