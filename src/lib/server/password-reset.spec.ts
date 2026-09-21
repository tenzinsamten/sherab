import { describe, expect, it, vi } from 'vitest';
import { requestPasswordReset, safeNextPath } from './password-reset';

function setup() {
	const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
	return {
		resetPasswordForEmail,
		deps: { origin: 'https://app.test', supabase: { auth: { resetPasswordForEmail } } }
	};
}

describe('requestPasswordReset', () => {
	it('uses the Supabase recovery email for a real email', async () => {
		const { deps, resetPasswordForEmail } = setup();
		await requestPasswordReset(' admin@example.com ', deps);
		expect(resetPasswordForEmail).toHaveBeenCalledWith('admin@example.com', {
			redirectTo: 'https://app.test/auth/confirm'
		});
	});

	it('ignores a bare student username', async () => {
		const { deps, resetPasswordForEmail } = setup();
		await requestPasswordReset('tenzin', deps);
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('ignores synthetic student emails', async () => {
		const { deps, resetPasswordForEmail } = setup();
		await requestPasswordReset('tenzin@students.internal.invalid', deps);
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('logs an error returned by Supabase without throwing', async () => {
		const { deps, resetPasswordForEmail } = setup();
		resetPasswordForEmail.mockResolvedValue({ error: { message: 'rate limited' } });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(requestPasswordReset('a@b.com', deps)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalledWith('requestPasswordReset failed', 'rate limited');
	});

	it('never throws when Supabase fails', async () => {
		const { deps, resetPasswordForEmail } = setup();
		resetPasswordForEmail.mockRejectedValue(new Error('boom'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(requestPasswordReset('a@b.com', deps)).resolves.toBeUndefined();
	});
});

describe('safeNextPath', () => {
	it('keeps internal paths and rejects external ones', () => {
		expect(safeNextPath('/reset-password')).toBe('/reset-password');
		expect(safeNextPath('//evil.com')).toBe('/reset-password');
		expect(safeNextPath('https://evil.com')).toBe('/reset-password');
		expect(safeNextPath(null)).toBe('/reset-password');
	});
});
