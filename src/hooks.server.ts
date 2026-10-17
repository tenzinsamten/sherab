import { redirect, type Handle } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sequence } from '@sveltejs/kit/hooks';
import { cookieMaxAge, cookieName, getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { localeFromPath, withoutLocale } from '$lib/server/roles';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import { createSupabaseServerClient } from '$lib/supabase/server';

/**
 * #79: the language lives in the cookie and addresses carry no locale
 * prefix. A link that names one (`/bo/teacher`) sets the cookie and lands on
 * the unprefixed address.
 */
const handleLocalePrefix: Handle = ({ event, resolve }) => {
	const { method } = event.request;
	const locale = localeFromPath(event.url.pathname);
	if (!locale || (method !== 'GET' && method !== 'HEAD')) return resolve(event);

	event.cookies.set(cookieName, locale, {
		path: '/',
		maxAge: cookieMaxAge,
		sameSite: 'lax',
		// Paraglide reads and writes this cookie in the browser.
		httpOnly: false
	});
	throw redirect(307, withoutLocale(event.url.pathname) + event.url.search);
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

/**
 * CAP-1: the session from the cookie, with its access token verified
 * locally by `getClaims()` against the project's ES256 signing key, so there
 * is no per-request call to Supabase Auth on a warm isolate; auth-js
 * refetches the JWKS at most every 10 min, and getSession() still refreshes
 * an expiring token. The result is memoised: one verification per request,
 * however many loads ask. Create one per request, never share it across
 * requests.
 *
 * A missing, expired, forged or unverifiable token gives no session. After a
 * sign-out or ban, until the old token expires (at most 1 h) it still reaches
 * page loads and RLS-scoped queries as that user; only its refresh is refused.
 */
export function createSafeGetSession(
	supabase: Pick<SupabaseClient, 'auth'>
): App.Locals['safeGetSession'] {
	let result: ReturnType<App.Locals['safeGetSession']> | undefined;

	const verify: App.Locals['safeGetSession'] = async () => {
		const signedOut = { session: null, user: null };
		try {
			const {
				data: { session }
			} = await supabase.auth.getSession();
			if (!session) return signedOut;

			const { data, error } = await supabase.auth.getClaims(session.access_token);
			if (error || !data) return signedOut;
			const { sub, email, app_metadata, user_metadata } = data.claims;
			if (typeof sub !== 'string' || !sub) return signedOut;
			const user: App.SessionUser = {
				id: sub,
				email,
				app_metadata: app_metadata ?? {},
				user_metadata: user_metadata ?? {}
			};
			return { session, user };
		} catch {
			return signedOut;
		}
	};

	return () => (result ??= verify());
}

/**
 * Attaches a request-scoped, cookie-bound Supabase client to `event.locals`
 * (AD-1/AD-2: every query below this point carries the caller's JWT, so
 * Postgres RLS -- not this hook -- is the real authorization boundary).
 */
const handleSupabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createSupabaseServerClient(event.cookies);

	event.locals.safeGetSession = createSafeGetSession(event.locals.supabase);

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

/** The only page of a student who is not approved (#100). */
const STUDENT_PENDING_PATH = '/student/pending';
const UNAPPROVED_STUDENT_PATHS = new Set([STUDENT_PENDING_PATH, '/logout']);

/**
 * The user id and address the access token was issued for. Read from the
 * token, not from the session's user object: the token is what the database
 * checks, so an edited cookie cannot name another address and keep working.
 */
function tokenClaims(accessToken: string): { sub: string; email: string } | null {
	try {
		const payload = accessToken.split('.')[1] ?? '';
		const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		const { sub, email } = JSON.parse(json) as { sub?: unknown; email?: unknown };
		return typeof sub === 'string' && typeof email === 'string' ? { sub, email } : null;
	} catch {
		return null;
	}
}

/**
 * #100: a student can sign in before approval. Until then (pending or
 * rejected) every request but the status page and sign-out is sent to the
 * status page, GET and POST alike -- a layout load would not see form posts.
 *
 * Only a student address is checked, so a staff or parent request costs
 * nothing extra; a student request costs one read of the own profile row.
 * This is a UX gate: RLS stays the barrier (AD-2).
 */
export const handleUnapprovedStudent: Handle = async ({ event, resolve }) => {
	const {
		data: { session }
	} = await event.locals.supabase.auth.getSession();
	if (!session) return resolve(event);

	const claims = tokenClaims(session.access_token);
	if (!claims || !claims.email.endsWith(`@${STUDENT_EMAIL_DOMAIN}`)) return resolve(event);

	// RLS's profiles_select_own scopes this to the caller's own row. Only a
	// row that was read and is not approved is gated: on a failed read or no
	// row (a deleted account) the request goes on, and the page's own guards
	// and RLS decide.
	const { data: profile } = await event.locals.supabase
		.from('profiles')
		.select('status')
		.eq('id', claims.sub)
		.maybeSingle();
	if (!profile || profile.status === 'approved') return resolve(event);

	const path = withoutLocale(event.url.pathname);
	if (UNAPPROVED_STUDENT_PATHS.has(path)) return resolve(event);
	throw redirect(303, STUDENT_PENDING_PATH);
};

export const handle: Handle = sequence(
	handleLocalePrefix,
	handleParaglide,
	handleSupabase,
	handleUnapprovedStudent
);
