import { createClient } from '@supabase/supabase-js';
import { error, fail, redirect } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import * as m from '$lib/paraglide/messages.js';
import { shapeStudentBadges } from '$lib/server/badges';
import { checkNewPassword } from '$lib/server/password-rules';
import { shapeStudentStreak } from '$lib/server/streak';
import { loadStudentClasses } from '$lib/server/student-homework';
import { studentEmailToUsername } from '$lib/server/temp-password';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { Database } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const MAX_NAME_LENGTH = 80;

/**
 * Own-account page: name and password for admins and teachers (#23); for
 * students (#44) their name, username, classes, streak and badges. Students
 * sign in with a username + PIN a teacher or admin issues, so they can
 * change their display name but not their PIN here.
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

	if (profile.role !== 'student') {
		return {
			role: profile.role,
			displayName,
			email: profile.email ?? session.user.email
		};
	}

	// Story 4-1 / 4-2 (moved from /student): student_streaks and badges_earned
	// are trigger-written only (AD-3) -- plain reads, scoped by RLS to the
	// caller's own rows; the explicit .eq is belt-and-suspenders. No row / no
	// badges yet is a legitimate empty state, not a load error.
	const [
		{ classes, error: classesError },
		{ data: streakRow, error: streakError },
		{ data: badgeRows, error: badgesError }
	] = await Promise.all([
		loadStudentClasses(supabase, profile.id),
		supabase
			.from('student_streaks')
			.select('current_streak, last_qualifying_week')
			.eq('student_id', profile.id)
			.maybeSingle(),
		supabase
			.from('badges_earned')
			.select('badge_type, milestone, earned_at')
			.eq('student_id', profile.id)
			.order('badge_type')
			.order('milestone', { ascending: true })
	]);

	return {
		role: profile.role,
		displayName,
		username: profile.email ? studentEmailToUsername(profile.email) : null,
		classes,
		streak: shapeStudentStreak(streakRow),
		badges: shapeStudentBadges(badgeRows),
		loadError: Boolean(classesError || streakError || badgesError)
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
		const user = await requireRole(supabase, safeGetSession, ['admin', 'teacher', 'student']);
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
		// Staff only: a student's PIN is reset by their teacher or an admin (#44).
		const user = await requireRole(supabase, safeGetSession, ['admin', 'teacher']);
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
