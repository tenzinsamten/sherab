import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import Login from './login/+page.svelte';
import Register from './register/+page.svelte';
import ForgotPassword from './forgot-password/+page.svelte';
import ResetPassword from './reset-password/+page.svelte';
import ResendConfirmation from './resend-confirmation/+page.svelte';

/** #117: where a failed submit's error shows on the sign-in pages (the matrix of its spec). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function body(Page: any, form: Record<string, unknown>, data: Record<string, unknown> = {}) {
	const html = render(Page, { props: { params: {}, form, data } as never }).body;
	// The toast already announces the error: the inline message has no live role.
	expect(html).not.toContain('role="alert"');
	return html;
}
/** The text of the error message with `id`, or undefined. */
const message = (html: string, id: string) =>
	html.match(new RegExp(`<p id="${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1].trim();
/** The opening tag of the input with `id`. */
const input = (html: string, id: string) =>
	html.match(new RegExp(`<input[^>]*\\sid="${id}"[^>]*>`))?.[0] ?? '';
const marked = (html: string, id: string, by: string) => {
	expect(input(html, id)).toContain('aria-invalid="true"');
	expect(input(html, id)).toContain(`aria-describedby="${by}"`);
};
const unmarked = (html: string, id: string) =>
	expect(input(html, id)).not.toMatch(/\saria-invalid=/);

describe('sign-in form errors (#117)', () => {
	it('login: wrong credentials above the button, both fields marked', () => {
		const html = body(Login, { error: m.login_error_invalid(), email: 'a@b.test' });
		expect(message(html, 'form-error')).toBe(m.login_error_invalid());
		marked(html, 'email', 'form-error');
		marked(html, 'password', 'form-error');
	});

	it('login: unconfirmed above the button, no field marked', () => {
		for (const error of [m.login_error_unconfirmed(), m.login_error_unconfirmed_resent()]) {
			const html = body(Login, { error, email: 'a@b.test', unconfirmed: true });
			expect(message(html, 'form-error')).toBe(error);
			unmarked(html, 'email');
			unmarked(html, 'password');
		}
	});

	it('login: required under the empty field', () => {
		const empty = body(Login, { error: m.login_error_required(), email: '' });
		expect(message(empty, 'email-error')).toBe(m.login_error_required());
		marked(empty, 'email', 'email-error');
		const typed = body(Login, { error: m.login_error_required(), email: 'a@b.test' });
		expect(message(typed, 'password-error')).toBe(m.login_error_required());
		marked(typed, 'password', 'password-error');
		unmarked(typed, 'email');
	});

	it('register: each error under its field, required and generic above the button', () => {
		const values = { displayName: 'Pema', email: 'a@b.test' };
		for (const [error, at] of [
			[m.register_error_exists(), 'email'],
			[m.reset_error_length(), 'password'],
			[m.reset_error_mismatch(), 'confirm']
		] as const) {
			const html = body(Register, { error, ...values });
			expect(message(html, `${at}-error`)).toBe(error);
			marked(html, at, `${at}-error`);
		}
		for (const error of [m.register_error_required(), m.register_error_generic()]) {
			const html = body(Register, { error, ...values });
			expect(message(html, 'form-error')).toBe(error);
			for (const id of ['displayName', 'email', 'password', 'confirm']) unmarked(html, id);
		}
	});

	it('register: no message on the receipt or before a submit', () => {
		expect(body(Register, { success: true, email: 'a@b.test' })).not.toContain('role="alert"');
		expect(body(Register, null as never)).not.toContain('role="alert"');
	});

	it('forgot password: required and student under Email', () => {
		for (const error of [m.forgot_error_required(), m.forgot_error_student()]) {
			const html = body(ForgotPassword, { error, email: 'pema' }, { expired: false });
			expect(message(html, 'email-error')).toBe(error);
			marked(html, 'email', 'email-error');
		}
	});

	it('reset password: length under Password, mismatch under Confirm, failed above the button', () => {
		const length = body(ResetPassword, { error: m.reset_error_length() });
		expect(message(length, 'password-error')).toBe(m.reset_error_length());
		marked(length, 'password', 'password-error');
		const mismatch = body(ResetPassword, { error: m.reset_error_mismatch() });
		expect(message(mismatch, 'confirm-error')).toBe(m.reset_error_mismatch());
		marked(mismatch, 'confirm', 'confirm-error');
		const failed = body(ResetPassword, { error: m.reset_error_failed() });
		expect(message(failed, 'form-error')).toBe(m.reset_error_failed());
		unmarked(failed, 'password');
		unmarked(failed, 'confirm');
	});

	it('resend confirmation: required under Email', () => {
		const html = body(
			ResendConfirmation,
			{ error: m.resend_error_required(), email: '' },
			{
				email: ''
			}
		);
		expect(message(html, 'email-error')).toBe(m.resend_error_required());
		marked(html, 'email', 'email-error');
	});

	describe('under Tibetan', () => {
		const original = getLocale;
		afterEach(() => overwriteGetLocale(original));

		it('places the Tibetan text the server sends', () => {
			overwriteGetLocale(() => 'bo');
			const html = body(Register, { error: m.reset_error_mismatch(), email: 'a@b.test' });
			expect(m.reset_error_mismatch()).not.toBe('Passwords do not match.');
			expect(message(html, 'confirm-error')).toBe(m.reset_error_mismatch());
			marked(html, 'confirm', 'confirm-error');
		});
	});
});
