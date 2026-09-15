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

/**
 * Updates an auth user's email/password via a direct call to the Admin REST
 * API, bypassing supabase-js's `admin.updateUserById()` wrapper.
 *
 * Needed specifically for Story 1-2's approval flow: on a duplicate-email
 * collision, the SDK collapses the response into a generic
 * `AuthRetryableFetchError` ("Error updating user", status 500, no `code`)
 * -- it discards the real Postgres error the raw HTTP body actually carries
 * (`{"code":"23505","message":"duplicate key value violates unique
 * constraint \"users_email_partial_key\"", ...}`). Without that code, the
 * collision-retry logic in requests/+page.server.ts's `approve` action has
 * no reliable way to tell "this email is already taken, try the next
 * candidate" apart from any other unexpected failure -- verified directly
 * against the local Auth API, not assumed.
 */
export async function updateAuthUserEmailAndPassword(
	userId: string,
	updates: { email: string; password: string }
): Promise<{ error: { code?: string; message: string } | null }> {
	const res = await fetch(`${PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
		method: 'PUT',
		headers: {
			apikey: SUPABASE_SERVICE_ROLE_KEY,
			authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			email: updates.email,
			password: updates.password,
			email_confirm: true
		})
	});

	if (res.ok) {
		return { error: null };
	}

	const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
	return {
		error: {
			code: body?.code,
			message: body?.message ?? `Admin API update failed with status ${res.status}`
		}
	};
}
