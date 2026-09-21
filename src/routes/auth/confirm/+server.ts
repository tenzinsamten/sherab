import { redirect } from '@sveltejs/kit';
import { RECOVERY_COOKIE, safeNextPath } from '$lib/server/password-reset';
import type { RequestHandler } from './$types';

/**
 * Landing route for Supabase recovery links. Handles both link shapes:
 * `token_hash` + `type=recovery` (custom email template) and a PKCE `code`
 * (Supabase's default recovery email). Only recovery is accepted; other OTP
 * types (magiclink, invite, ...) are rejected. On success a short-lived
 * cookie marks the session as recovery-established, which /reset-password
 * requires so a normal logged-in session can't change the password directly.
 */
export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const code = url.searchParams.get('code');
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
