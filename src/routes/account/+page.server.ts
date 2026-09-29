import { createClient } from '@supabase/supabase-js';
import { error, fail, redirect } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import * as m from '$lib/paraglide/messages.js';
import { getCapabilities, type ParentStatus } from '$lib/server/capabilities';
import { checkNewPassword } from '$lib/server/password-rules';
import { studentEmailToUsername } from '$lib/server/temp-password';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { Database } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const MAX_NAME_LENGTH = 80;

/**
 * Own-account page: name and password for admins and teachers (#23) and
 * parents (Story 7-1, the email is read-only: it is what links children); for
 * students (#44) their name and username (classes, streak and badges are on
 * the student dashboard and class pages since #46). Students
 * sign in with a username + PIN a teacher or admin issues, so they can
 * change their display name but not their PIN here.
 *
 * B14a (#68): a teacher or admin also gets `parentStatus` (their own parents
 * row, null when none) for the "Parent access" card.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { session, profile } = await parent();

	if (!session) {
		throw redirect(303, '/login');
	}
	if (!profile) {
		throw error(403, 'No account profile.');
	}

	const displayName = profile.display_name ?? '';

	if (profile.role === 'admin' || profile.role === 'teacher') {
		// RLS-scoped to the caller's own row. A failed read falls back to
		// null (the button shows; the RPC still refuses a duplicate).
		const capabilities = await getCapabilities(supabase, session.user.id);
		const parentStatus: ParentStatus | null = capabilities?.parentStatus ?? null;
		return {
			role: profile.role,
			displayName,
			email: profile.email ?? session.user.email,
			parentStatus
		};
	}

	if (profile.role !== 'student') {
		return {
			role: profile.role,
			displayName,
			email: profile.email ?? session.user.email
		};
	}

	return {
		role: profile.role,
		displayName,
		username: profile.email ? studentEmailToUsername(profile.email) : null
	};
};

type Role = Database['public']['Enums']['user_role'];

/** The role gate, re-checked per action (a POST skips `load`). */
async function requireRole(
	supabase: App.Locals['supabase'],
	safeGetSession: App.Locals['safeGetSession'],
	roles: Role[]
) {
	const { user } = await safeGetSession();
	if (!user) return null;
	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	return profile && roles.includes(profile.role) ? user : null;
}

export const actions: Actions = {
	updateName: async ({ request, locals: { supabase, safeGetSession } }) => {
		const user = await requireRole(supabase, safeGetSession, [
			'admin',
			'teacher',
			'student',
			'parent'
		]);
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
		// Staff and parents: a student's PIN is reset by their teacher or an
		// admin (#44).
		const user = await requireRole(supabase, safeGetSession, ['admin', 'teacher', 'parent']);
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
	},

	/**
	 * B14a (#68): a teacher or admin asks for parent capability. The RPC
	 * re-checks the role and only ever creates the caller's own pending row.
	 */
	requestParentAccess: async ({ locals: { supabase, safeGetSession } }) => {
		const user = await requireRole(supabase, safeGetSession, ['admin', 'teacher']);
		if (!user) return fail(403, { error: m.account_parent_error_failed() });

		const { error: rpcError } = await supabase.rpc('request_parent_access');
		if (rpcError) {
			return fail(rpcError.code === '42501' ? 403 : 400, {
				error: parentAccessErrorMessage(rpcError)
			});
		}

		return { success: true, action: 'requestParentAccess' as const };
	}
};

/** Maps request_parent_access()'s error hint to a message. */
function parentAccessErrorMessage(err: { code?: string; hint?: string | null }): string {
	switch (err.hint) {
		case 'already_pending':
			return m.account_parent_error_pending();
		case 'already_parent':
			return m.account_parent_error_parent();
		case 'rejected':
			return m.account_parent_error_rejected();
		default:
			return m.account_parent_error_failed();
	}
}
