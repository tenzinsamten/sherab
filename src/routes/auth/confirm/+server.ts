import { redirect } from '@sveltejs/kit';
import { RECOVERY_COOKIE, safeNextPath } from '$lib/server/password-reset';
import type { RequestHandler } from './$types';

/** Where a confirmed parent sign-up lands (Story 7-1). */
const SIGNUP_HOME = '/parent';
const SIGNUP_FAILED = '/login?error=confirm';

/**
 * Landing route for Supabase email links.
 *
 * Sign-up confirmation (Story 7-1): `token_hash` + `type=signup|email`
 * (custom email template), or a PKCE `code` with `flow=signup` (the
 * `emailRedirectTo` the /register action sets). Success lands on /parent,
 * which shows the account's status; failure goes to /login with an error.
 * No recovery cookie is set.
 *
 * Recovery: `token_hash` + `type=recovery` or a PKCE `code`. Other OTP types
 * (magiclink, invite, ...) are rejected. On success a short-lived cookie
 * marks the session as recovery-established, which /reset-password requires
 * so a normal logged-in session can't change the password directly.
 */
export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const code = url.searchParams.get('code');

	if (tokenHash && (type === 'signup' || type === 'email')) {
		const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
		throw redirect(303, error ? SIGNUP_FAILED : SIGNUP_HOME);
	}
	if (code && url.searchParams.get('flow') === 'signup') {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		throw redirect(303, error ? SIGNUP_FAILED : SIGNUP_HOME);
	}

	const next = safeNextPath(url.searchParams.get('next'));

	let error: unknown = new Error('missing or unsupported token');
	if (tokenHash && type === 'recovery') {
		({ error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash }));
	} else if (code) {
		({ error } = await supabase.auth.exchangeCodeForSession(code));
	}

	if (error) throw redirect(303, '/forgot-password?error=expired');

	cookies.set(RECOVERY_COOKIE, '1', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 15
	});
	throw redirect(303, next);
};
