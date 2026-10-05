import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

function event(search: string, result: { error: unknown } = { error: null }) {
	const verifyOtp = vi.fn().mockResolvedValue(result);
	const exchangeCodeForSession = vi.fn().mockResolvedValue(result);
	const cookies = { set: vi.fn() };
	const value = {
		url: new URL(`https://app.test/auth/confirm${search}`),
		cookies,
		locals: { supabase: { auth: { verifyOtp, exchangeCodeForSession } } }
	};
	return { value, verifyOtp, exchangeCodeForSession, cookies };
}

function open(search: string, result?: { error: unknown }) {
	const e = event(search, result);
	return { ...e, promise: load(e.value as unknown as Parameters<typeof load>[0]) };
}

function press(search: string, result?: { error: unknown }) {
	const e = event(search, result);
	return {
		...e,
		promise: actions.default(e.value as unknown as Parameters<typeof actions.default>[0])
	};
}

async function location(p: unknown) {
	try {
		await (p as Promise<unknown>);
	} catch (e) {
		return (e as { location: string }).location;
	}
	return null;
}

describe('opening /auth/confirm (load)', () => {
	it('does not spend a token_hash link: it only says which button to show', async () => {
		for (const [search, kind] of [
			['?token_hash=abc&type=email', 'signup'],
			['?token_hash=abc&type=signup', 'signup'],
			['?token_hash=abc&type=recovery', 'recovery']
		]) {
			const { promise, verifyOtp, exchangeCodeForSession, cookies } = open(search);
			expect(await promise).toEqual({ kind });
			expect(verifyOtp).not.toHaveBeenCalled();
			expect(exchangeCodeForSession).not.toHaveBeenCalled();
			expect(cookies.set).not.toHaveBeenCalled();
		}
	});

	it('rejects other OTP types', async () => {
		const { promise, verifyOtp, cookies } = open('?token_hash=abc&type=magiclink');
		expect(await location(promise)).toBe('/forgot-password?error=expired');
		expect(verifyOtp).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('rejects a link with neither a token nor a code', async () => {
		expect(await location(open('').promise)).toBe('/forgot-password?error=expired');
	});

	it('exchanges a recovery PKCE code and sets the recovery cookie', async () => {
		const { promise, exchangeCodeForSession, cookies } = open('?code=xyz');
		expect(await location(promise)).toBe('/reset-password');
		expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
		expect(cookies.set).toHaveBeenCalledWith('sb-recovery', '1', expect.any(Object));
	});

	it('redirects to the expired page when the code exchange fails', async () => {
		const { promise, cookies } = open('?code=xyz', { error: new Error('bad') });
		expect(await location(promise)).toBe('/forgot-password?error=expired');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('never redirects to an external next', async () => {
		expect(await location(open('?code=xyz&next=//evil.com').promise)).toBe('/reset-password');
	});

	it('exchanges a signup PKCE code and lands on /parent without the recovery cookie', async () => {
		const { promise, exchangeCodeForSession, cookies } = open('?code=xyz&flow=signup');
		expect(await location(promise)).toBe('/parent');
		expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('sends a failed signup code to login with an error', async () => {
		const bad = { error: new Error('expired') };
		expect(await location(open('?code=xyz&flow=signup', bad).promise)).toBe('/login?error=confirm');
	});
});

describe('pressing the button on /auth/confirm (action)', () => {
	it('verifies a recovery token_hash, sets the recovery cookie and redirects', async () => {
		const { promise, verifyOtp, cookies } = press('?token_hash=abc&type=recovery');
		expect(await location(promise)).toBe('/reset-password');
		expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
		expect(cookies.set).toHaveBeenCalledWith('sb-recovery', '1', expect.any(Object));
	});

	it('sends a failed recovery token to the expired page', async () => {
		const { promise, cookies } = press('?token_hash=abc&type=recovery', {
			error: new Error('used')
		});
		expect(await location(promise)).toBe('/forgot-password?error=expired');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('verifies a signup token_hash and lands on /parent without the recovery cookie', async () => {
		for (const type of ['signup', 'email']) {
			const { promise, verifyOtp, cookies } = press(`?token_hash=abc&type=${type}`);
			expect(await location(promise)).toBe('/parent');
			expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: 'abc' });
			expect(cookies.set).not.toHaveBeenCalled();
		}
	});

	it('sends a failed signup confirmation to login with an error', async () => {
		const bad = { error: new Error('expired') };
		expect(await location(press('?token_hash=abc&type=email', bad).promise)).toBe(
			'/login?error=confirm'
		);
	});

	it('rejects other OTP types and a missing token without verifying', async () => {
		for (const search of ['?token_hash=abc&type=magiclink', '?type=recovery', '']) {
			const { promise, verifyOtp } = press(search);
			expect(await location(promise)).toBe('/forgot-password?error=expired');
			expect(verifyOtp).not.toHaveBeenCalled();
		}
	});
});
