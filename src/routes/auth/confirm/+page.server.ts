import { redirect } from '@sveltejs/kit';
import { RECOVERY_COOKIE, safeNextPath } from '$lib/server/password-reset';
import type { Actions, PageServerLoad } from './$types';

/** Where a confirmed parent sign-up lands (Story 7-1). */
const SIGNUP_HOME = '/parent';
const SIGNUP_FAILED = '/login?error=confirm';
const RECOVERY_FAILED = '/forgot-password?error=expired';

type LinkKind = 'signup' | 'recovery';

/** Which kind of emailed `token_hash` link this is; null for any other OTP type. */
function linkKind(type: string | null): LinkKind | null {
	if (type === 'signup' || type === 'email') return 'signup';
	return type === 'recovery' ? 'recovery' : null;
}

/**
 * Landing page for Supabase email links.
 *
 * `token_hash` links (the custom email templates; they work on any device):
 * opening the link only shows a button, and pressing it verifies the token
 * (#89). A token is good for one request, and some mail apps fetch every link
 * in a message before the person taps it, which used the link up and left
 * them with "invalid or has expired".
 *
 * PKCE `code` links (Supabase's default templates) are exchanged on the GET:
 * the code is useless without the verifier cookie of the browser that asked
 * for the mail, so a pre-fetch cannot spend it.
 *
 * Sign-up confirmation (Story 7-1) lands on /parent, which shows the
 * account's status; failure goes to /login with an error. Recovery sets a
 * short-lived cookie that /reset-password requires, so a normal signed-in
 * session can't change the password directly. Other OTP types (magiclink,
 * invite, ...) are rejected.
 */
export const load: PageServerLoad = async ({ url, cookies, locals: { supabase } }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const code = url.searchParams.get('code');

	if (tokenHash) {
		const kind = linkKind(url.searchParams.get('type'));
		if (!kind) throw redirect(303, RECOVERY_FAILED);
		return { kind };
	}

	if (code && url.searchParams.get('flow') === 'signup') {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		throw redirect(303, error ? SIGNUP_FAILED : SIGNUP_HOME);
	}
	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (error) throw redirect(303, RECOVERY_FAILED);
		setRecoveryCookie(cookies, url);
		throw redirect(303, safeNextPath(url.searchParams.get('next')));
	}

	throw redirect(303, RECOVERY_FAILED);
};

export const actions: Actions = {
	/** The button on the page: the token and type are still in the address. */
	default: async ({ url, cookies, locals: { supabase } }) => {
		const tokenHash = url.searchParams.get('token_hash');
		const type = url.searchParams.get('type');
		const kind = linkKind(type);
		if (!tokenHash || !kind) throw redirect(303, RECOVERY_FAILED);

		if (kind === 'signup') {
			const { error } = await supabase.auth.verifyOtp({
				type: type === 'signup' ? 'signup' : 'email',
				token_hash: tokenHash
			});
			throw redirect(303, error ? SIGNUP_FAILED : SIGNUP_HOME);
		}

		const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
		if (error) throw redirect(303, RECOVERY_FAILED);
		setRecoveryCookie(cookies, url);
		throw redirect(303, safeNextPath(url.searchParams.get('next')));
	}
};

function setRecoveryCookie(cookies: Parameters<PageServerLoad>[0]['cookies'], url: URL) {
	cookies.set(RECOVERY_COOKIE, '1', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 15
	});
}
