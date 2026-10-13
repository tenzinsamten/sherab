import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

function run(cookie: string | undefined) {
	const setHeaders = vi.fn();
	const result = load({
		cookies: { get: () => cookie },
		setHeaders
	} as unknown as Parameters<typeof load>[0]);
	return { result, setHeaders };
}

describe('join pending load', () => {
	it('#100: returns the receipt with username and PIN, and is never cached', async () => {
		const receipt = {
			name: 'Tenzin Dolma',
			className: 'Class A',
			classCode: 'ABC123',
			username: 'tenzindolma',
			pin: '123456'
		};
		const { result, setHeaders } = run(JSON.stringify(receipt));
		expect(await result).toEqual({ receipt });
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});

	it.each([undefined, 'not json'])(
		'has no receipt for cookie %s, still uncached',
		async (cookie) => {
			const { result, setHeaders } = run(cookie);
			expect(await result).toEqual({ receipt: null });
			expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
		}
	);
});
