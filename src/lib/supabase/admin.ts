import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from './database.types';

/**
 * Privileged Supabase client using the service-role key. Bypasses RLS
 * entirely, so it must only ever be imported from server-only modules
 * (+page.server.ts / +server.ts actions) and used for the one operation
 * that genuinely requires it: creating a verified teacher auth account via
 * the Supabase Auth Admin API (supabase.auth.admin.createUser), which has no
 * anon/authenticated-key equivalent.
 *
 * `$env/static/private` cannot be imported into client-bundled code -- Vite
 * fails the build if it is -- which is the safety net behind this rule.
 *
 * Every other write in this story (creating a class, assigning a teacher to
 * a class) goes through the request-scoped client from `./server.ts` instead,
 * so RLS still double-checks the caller is really an admin.
 */
export function createSupabaseAdminClient() {
	return createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});
}
