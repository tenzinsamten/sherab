import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { cookieMaxAge, cookieName, getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { localeFromPath, withoutLocale } from '$lib/server/roles';
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
 * Attaches a request-scoped, cookie-bound Supabase client to `event.locals`
 * (AD-1/AD-2: every query below this point carries the caller's JWT, so
 * Postgres RLS -- not this hook -- is the real authorization boundary).
 */
const handleSupabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createSupabaseServerClient(event.cookies);

	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {
			return { session: null, user: null };
		}

		// getUser() re-validates the JWT against Supabase Auth rather than
		// trusting the (possibly stale/forged) cookie session as-is.
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) {
			return { session: null, user: null };
		}

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

export const handle: Handle = sequence(handleLocalePrefix, handleParaglide, handleSupabase);
