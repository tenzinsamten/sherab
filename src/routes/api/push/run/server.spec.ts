import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/push/run (#92): only the shared secret opens it. What it then
 * sends is `runHomeworkPush` (push.spec.ts), replaced here by a spy.
 */
const { env, run } = vi.hoisted(() => ({
	env: { PUSH_CRON_SECRET: 's3cret' as string | undefined },
	run: vi.fn(async () => ({ overdue: { sent: 1 } }))
}));

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/push', async (original) => ({
	...(await original<typeof import('$lib/server/push')>()),
	runHomeworkPush: run
}));

import { POST } from './+server';

function call(options: { authorization?: string; body?: unknown; waitUntil?: unknown } = {}) {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (options.authorization) headers.set('authorization', options.authorization);
	return POST({
		request: new Request('http://localhost/api/push/run', {
			method: 'POST',
			headers,
			body: JSON.stringify(options.body ?? {})
		}),
		platform: options.waitUntil ? { ctx: { waitUntil: options.waitUntil } } : undefined
	} as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/push/run', () => {
	beforeEach(() => {
		env.PUSH_CRON_SECRET = 's3cret';
		run.mockClear();
	});

	it.each([
		['no header', undefined],
		['a wrong secret', 'Bearer wrong'],
		['the secret without the scheme', 's3cret']
	])('refuses %s', async (_label, authorization) => {
		const response = await call({ authorization });
		expect(response.status).toBe(401);
		expect(run).not.toHaveBeenCalled();
	});

	it('refuses everything while no secret is set', async () => {
		env.PUSH_CRON_SECRET = undefined;
		expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
		expect((await call({ authorization: 'Bearer undefined' })).status).toBe(401);
		expect(run).not.toHaveBeenCalled();
	});

	it('runs with the request body and answers with the counts', async () => {
		const body = { kind: 'added', instanceId: 'abc', depth: 1 };
		const response = await call({ authorization: 'Bearer s3cret', body });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ overdue: { sent: 1 } });
		expect(run).toHaveBeenCalledWith(body);
	});

	it('on Cloudflare answers at once and keeps sending after the reply', async () => {
		const waitUntil = vi.fn();
		const response = await call({ authorization: 'Bearer s3cret', waitUntil });
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true });
		expect(waitUntil).toHaveBeenCalledTimes(1);
		await expect(waitUntil.mock.calls[0][0]).resolves.toBeDefined();
	});
});
