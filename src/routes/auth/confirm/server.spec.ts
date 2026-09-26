import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function run(search: string, result: { error: unknown } = { error: null }) {
	const verifyOtp = vi.fn().mockResolvedValue(result);
	const exchangeCodeForSession = vi.fn().mockResolvedValue(result);
	const cookies = { set: vi.fn() };
	const promise = GET({
		url: new URL(`https://app.test/auth/confirm${search}`),
		cookies,
		locals: { supabase: { auth: { verifyOtp, exchangeCodeForSession } } }
	} as unknown as Parameters<typeof GET>[0]);
	return { promise, verifyOtp, exchangeCodeForSession, cookies };
}

async function location(p: unknown) {
	try {
		await (p as Promise<unknown>);
	} catch (e) {
		return (e as { location: string }).location;
	}
	return null;
}

describe('GET /auth/confirm', () => {
	it('verifies a recovery token_hash, sets the recovery cookie and redirects', async () => {
		const { promise, verifyOtp, cookies } = run('?token_hash=abc&type=recovery');
		expect(await location(promise)).toBe('/reset-password');
		expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
		expect(cookies.set).toHaveBeenCalledWith('sb-recovery', '1', expect.any(Object));
	});

	it('rejects non-recovery OTP types', async () => {
		const { promise, verifyOtp, cookies } = run('?token_hash=abc&type=magiclink');
		expect(await location(promise)).toBe('/forgot-password?error=expired');
		expect(verifyOtp).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('exchanges a PKCE code', async () => {
		const { promise, exchangeCodeForSession } = run('?code=xyz');
		expect(await location(promise)).toBe('/reset-password');
		expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
	});

	it('redirects to the expired page on a verification error', async () => {
		const { promise, cookies } = run('?code=xyz', { error: new Error('bad') });
		expect(await location(promise)).toBe('/forgot-password?error=expired');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('never redirects to an external next', async () => {
		const { promise } = run('?code=xyz&next=//evil.com');
		expect(await location(promise)).toBe('/reset-password');
	});

	it('verifies a signup token_hash and lands on /parent without the recovery cookie', async () => {
		const { promise, verifyOtp, cookies } = run('?token_hash=abc&type=signup');
		expect(await location(promise)).toBe('/parent');
		expect(verifyOtp).toHaveBeenCalledWith({ type: 'signup', token_hash: 'abc' });
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('exchanges a signup PKCE code and lands on /parent without the recovery cookie', async () => {
		const { promise, exchangeCodeForSession, cookies } = run('?code=xyz&flow=signup');
		expect(await location(promise)).toBe('/parent');
		expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('sends a failed signup confirmation to login with an error', async () => {
		const bad = { error: new Error('expired') };
		expect(await location(run('?token_hash=abc&type=email', bad).promise)).toBe(
			'/login?error=confirm'
		);
		expect(await location(run('?code=xyz&flow=signup', bad).promise)).toBe('/login?error=confirm');
	});
});
