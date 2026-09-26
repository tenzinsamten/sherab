import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (e2e/*.e2e.ts) against their own SvelteKit dev server in
 * the default (local) mode, i.e. the local Supabase stack from .env
 * (`npx supabase start`). It runs on a separate port and an existing server
 * is never reused: one on 5173 may be `npm run dev:hosted`, which talks to
 * the hosted Supabase. Vitest only collects src/**\/*.spec.ts, so these
 * files never run under `npm test`.
 */
const PORT = 5199;
export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		locale: 'en-GB',
		timezoneId: 'Europe/Berlin',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `npx vite dev --mode development --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: false,
		timeout: 120_000
	}
});
