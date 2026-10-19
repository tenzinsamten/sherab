import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

/** Loads the preview's server module with `dev` set as in that build. */
async function loadWith(dev: boolean) {
	vi.resetModules();
	vi.doMock('$app/environment', () => ({ dev, browser: false, building: false }));
	const { load } = await import('./+page.server');
	return () => (load as () => unknown)();
}

afterEach(() => {
	vi.doUnmock('$app/environment');
});

describe('/dev/ui load', () => {
	it('answers 404 in a production build', async () => {
		const load = await loadWith(false);
		let thrown: unknown;
		try {
			load();
		} catch (error) {
			thrown = error;
		}
		expect(isHttpError(thrown, 404)).toBe(true);
	});

	it('renders under vite dev', async () => {
		const load = await loadWith(true);
		expect(load()).toEqual({});
	});
});
