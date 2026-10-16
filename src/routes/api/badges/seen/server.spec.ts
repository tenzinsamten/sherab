import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

/**
 * /api/badges/seen (badge detail CAP-9): a session is required and the body
 * must be a list of badge ids; the RPC (0050, rls.spec.ts) marks only the
 * caller's own rows.
 */
const ID_A = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f601';
const ID_B = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f602';

function event(body: unknown, options: { signedIn?: boolean; error?: unknown } = {}) {
	const rpc = vi.fn(async () => ({ error: options.error ?? null }));
	return {
		rpc,
		e: {
			request: new Request('http://localhost/api/badges/seen', {
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

describe('POST /api/badges/seen', () => {
	it('refuses a signed-out caller', async () => {
		const { e, rpc } = event({ ids: [ID_A] }, { signedIn: false });
		expect((await POST(e)).status).toBe(401);
		expect(rpc).not.toHaveBeenCalled();
	});

	it.each([
		['a body that is not JSON', 'not json'],
		['no ids', {}],
		['an empty list', { ids: [] }],
		['ids that are not a list', { ids: ID_A }],
		['an id that is not a UUID', { ids: [ID_A, 'badge-1'] }],
		['an id that is not text', { ids: [42] }],
		['more than 50 ids', { ids: Array.from({ length: 51 }, () => ID_A) }],
		['null', null]
	])('refuses %s and marks nothing', async (_label, body) => {
		const { e, rpc } = event(body);
		expect((await POST(e)).status).toBe(400);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('marks the badges seen for the caller', async () => {
		const { e, rpc } = event({ ids: [ID_A, ID_B] });
		const response = await POST(e);
		expect(response.status).toBe(200);
		expect(rpc).toHaveBeenCalledExactlyOnceWith('mark_badges_seen', { p_ids: [ID_A, ID_B] });
	});

	it('accepts 50 ids', async () => {
		const { e, rpc } = event({ ids: Array.from({ length: 50 }, () => ID_A) });
		expect((await POST(e)).status).toBe(200);
		expect(rpc).toHaveBeenCalledOnce();
	});

	it('answers 500 and logs when saving fails', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { e } = event({ ids: [ID_A] }, { error: { code: 'XX000', message: 'boom' } });
		expect((await POST(e)).status).toBe(500);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});
});
