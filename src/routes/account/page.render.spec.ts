import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

const data = {
	role: 'teacher',
	displayName: 'Tenzin',
	email: 'tenzin@example.test',
	username: null,
	parentStatus: null,
	pushKey: undefined
};

function renderPage(form: unknown, extra: Record<string, unknown> = {}) {
	return render(Page, { props: { params: {}, form, data: { ...data, ...extra } } as never }).body;
}

/** Mobile-first story 5, I/O matrix "Account — wrong current password". */
describe('account (+page.svelte)', () => {
	it('shows a wrong current password under that field', () => {
		const body = renderPage({ error: m.account_password_error_current() });
		const field = body.match(/<input[^>]*id="currentPassword"[^>]*>/)?.[0] ?? '';
		expect(field).toContain('aria-invalid="true"');
		expect(field).toContain('aria-describedby="currentPassword-error"');
		expect(body).toMatch(
			new RegExp(`id="currentPassword-error"[^>]*>${m.account_password_error_current()}<`)
		);
	});

	it('shows a mismatch under the confirmation and nothing under the other fields', () => {
		const body = renderPage({ error: m.reset_error_mismatch() });
		expect(body).toContain('id="confirm-error"');
		expect(body).not.toContain('id="currentPassword-error"');
		expect(body).not.toContain('id="displayName-error"');
	});

	for (const [what, error, id] of [
		['too short', () => m.reset_error_length(), 'password'],
		['the same as now', () => m.account_password_error_same(), 'password'],
		['an empty name', () => m.account_name_error_required(), 'displayName']
	] as const) {
		it(`shows ${what} under its field`, () => {
			const body = renderPage({ error: error() });
			const field = body.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
			expect(field).toContain('aria-invalid="true"');
			expect(field).toContain(`aria-describedby="${id}-error"`);
			expect(body).toMatch(new RegExp(`id="${id}-error"[^>]*>${error()}<`));
		});
	}

	it('keeps the hidden username for password managers and a read-only email', () => {
		const body = renderPage(null);
		expect(body).toMatch(/<input[^>]*name="username"[^>]*autocomplete="username"/);
		expect(body).toMatch(/<input[^>]*id="email"[^>]*readonly/);
	});

	it('shows the notifications card when push is set up', () => {
		const body = renderPage(null, { pushKey: 'key' });
		expect(body).toContain(m.account_push_heading());
	});
});
