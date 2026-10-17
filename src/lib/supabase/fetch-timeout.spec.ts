import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, SUPABASE_FETCH_TIMEOUT_MS } from './fetch-timeout';

/** A fetch that never answers on its own, only rejects when its signal aborts. */
function hangingFetch() {
	return vi.fn(
		(_input: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			})
	);
}

describe('fetchWithTimeout (CAP-2)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('defaults to 8 s', () => {
		expect(SUPABASE_FETCH_TIMEOUT_MS).toBe(8000);
	});

	it('passes the request through and returns its response', async () => {
		const response = new Response('ok');
		const stub = vi.fn(async () => response);
		vi.stubGlobal('fetch', stub);

		const result = await fetchWithTimeout(50)('https://db.example/rest/v1/x', {
			method: 'POST',
			headers: { apikey: 'k' }
		});

		expect(result).toBe(response);
		expect(stub).toHaveBeenCalledWith(
			'https://db.example/rest/v1/x',
			expect.objectContaining({ method: 'POST', headers: { apikey: 'k' } })
		);
	});

	it('aborts a call that does not answer in time', async () => {
		vi.stubGlobal('fetch', hangingFetch());
		const started = Date.now();

		await expect(fetchWithTimeout(30)('https://db.example/rest/v1/x')).rejects.toMatchObject({
			name: 'TimeoutError'
		});
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it('logs a timeout with the URL, without its query', async () => {
		vi.stubGlobal('fetch', hangingFetch());
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(fetchWithTimeout(10)('https://db.example/rest/v1/x?select=*')).rejects.toThrow();

		expect(warn).toHaveBeenCalledWith(
			'supabase fetch timed out after 10 ms: https://db.example/rest/v1/x'
		);
		warn.mockRestore();
	});

	it('honours the signal of a Request passed as input', async () => {
		vi.stubGlobal('fetch', hangingFetch());
		const controller = new AbortController();

		const call = fetchWithTimeout(10_000)(
			new Request('https://db.example/rest/v1/x', { signal: controller.signal })
		);
		controller.abort();

		await expect(call).rejects.toMatchObject({ name: 'AbortError' });
	});

	it("still honours the caller's own signal", async () => {
		vi.stubGlobal('fetch', hangingFetch());
		const controller = new AbortController();

		const call = fetchWithTimeout(10_000)('https://db.example/rest/v1/x', {
			signal: controller.signal
		});
		controller.abort();

		await expect(call).rejects.toMatchObject({ name: 'AbortError' });
	});
});
