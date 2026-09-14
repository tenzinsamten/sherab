import { createServerClient } from '@supabase/ssr';
import type { Cookies } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from './database.types';

/**
 * Typed Supabase client bound to the request's cookies, for use in
 * `hooks.server.ts` / `+page.server.ts` / `+server.ts`. Every query made
 * through this client carries the signed-in user's JWT, so Postgres RLS
 * (AD-2) evaluates as that user -- this is what makes the cross-class-denial
 * and role checks real instead of frontend-only.
 */
export function createSupabaseServerClient(cookies: Cookies) {
	return createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					cookies.set(name, value, { ...options, path: options?.path ?? '/' });
				}
			}
		}
	});
}
