import { createClient } from '@supabase/supabase-js';
import { error, fail, redirect } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import * as m from '$lib/paraglide/messages.js';
import { checkNewPassword } from '$lib/server/password-rules';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { Database } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const MAX_NAME_LENGTH = 80;

/**
 * Own-account page (#23) for admins and teachers. Students sign in with a
 * username + PIN that a teacher or admin issues, so they have no page here.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { session, profile } = await parent();

	if (!session) {
		throw redirect(303, '/login');
	}
	if (!profile || (profile.role !== 'admin' && profile.role !== 'teacher')) {
		throw error(403, 'Admin and teacher accounts only.');
	}

	return { displayName: profile.display_name ?? '', email: profile.email ?? session.user.email };
};

/** Same role gate as `load`, re-checked per action (a POST skips `load`). */
async function requireStaff(
	supabase: App.Locals['supabase'],
	safeGetSession: App.Locals['safeGetSession']
) {
	const { user } = await safeGetSession();
	if (!user) return null;
	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	return profile && (profile.role === 'admin' || profile.role === 'teacher') ? user : null;
}

export const actions: Actions = {
	updateName: async ({ request, locals: { supabase, safeGetSession } }) => {
		const user = await requireStaff(supabase, safeGetSession);
		if (!user) return fail(403, { error: m.account_name_error_failed() });

		const formData = await request.formData();
		const displayName = String(formData.get('displayName') ?? '').trim();
		if (!displayName || displayName.length > MAX_NAME_LENGTH) {
			return fail(400, { error: m.account_name_error_required() });
		}

		// profiles has no update-own RLS policy, so this goes through the
		// service-role client. It only ever touches the caller's own row (id
		// from the verified session, never the form) and only display_name.
		const { error: updateError } = await createSupabaseAdminClient()
			.from('profiles')
			.update({ display_name: displayName })
			.eq('id', user.id);

		if (updateError) {
			return fail(500, { error: m.account_name_error_failed() });
		}

		return { success: true, action: 'updateName' as const };
	},

	changePassword: async ({ request, locals: { supabase, safeGetSession } }) => {
		const user = await requireStaff(supabase, safeGetSession);
		if (!user || !user.email) return fail(403, { error: m.account_password_error_failed() });

		const formData = await request.formData();
		const currentPassword = String(formData.get('currentPassword') ?? '');
		const password = String(formData.get('password') ?? '');
		const confirm = String(formData.get('confirm') ?? '');

		const problem = checkNewPassword(password, confirm);
		if (problem === 'length') return fail(400, { error: m.reset_error_length() });
		if (problem === 'mismatch') return fail(400, { error: m.reset_error_mismatch() });

		// Confirm it's really them before changing the password, on a
		// throwaway client that stores no session, so the check never touches
		// the request's own auth cookies.
		const verifier = createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const { error: verifyError } = await verifier.auth.signInWithPassword({
			email: user.email,
			password: currentPassword
		});
		if (verifyError) {
			return fail(400, { error: m.account_password_error_current() });
		}
		// Ends only the verification session. The default scope is 'global',
		// which would also sign the user out here.
		await verifier.auth.signOut({ scope: 'local' });

		const { error: updateError } = await supabase.auth.updateUser({ password });
		if (updateError) {
			return fail(400, {
				error:
					updateError.code === 'same_password'
						? m.account_password_error_same()
						: m.account_password_error_failed()
			});
		}

		// Same as reset-password: a password change signs out every other session.
		const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
		if (signOutError) {
			console.error('account: failed to sign out other sessions', signOutError.message);
		}

		return { success: true, action: 'changePassword' as const };
	}
};
