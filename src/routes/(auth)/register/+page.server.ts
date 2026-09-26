import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { checkNewPassword } from '$lib/server/password-rules';
import { isDuplicateSignup } from '$lib/server/signup-duplicate';
import {
	MAX_PARENT_NAME_LENGTH,
	emailHasLogin,
	isValidParentEmail
} from '$lib/server/parent-registration';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (session) {
		throw redirect(303, '/');
	}
	return {};
};

/**
 * Story 7-1: parent registration. handle_new_user() (0023) turns the
 * sign-up's user_metadata role 'parent' into a `parent` profile plus a
 * pending parents row, in the same transaction. The anon signUp() is what
 * makes GoTrue send the confirmation mail.
 */
export const actions: Actions = {
	register: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const displayName = String(formData.get('displayName') ?? '').trim();
		const email = String(formData.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(formData.get('password') ?? '');
		const confirm = String(formData.get('confirm') ?? '');

		if (
			!displayName ||
			displayName.length > MAX_PARENT_NAME_LENGTH ||
			!isValidParentEmail(email) ||
			!password
		) {
			return fail(400, { error: m.register_error_required(), displayName, email });
		}
		const problem = checkNewPassword(password, confirm);
		if (problem === 'length') {
			return fail(400, { error: m.reset_error_length(), displayName, email });
		}
		if (problem === 'mismatch') {
			return fail(400, { error: m.reset_error_mismatch(), displayName, email });
		}

		// Any existing login with this email: create nothing, one generic
		// message that never names the role.
		try {
			if (await emailHasLogin(createSupabaseAdminClient(), email)) {
				return fail(400, { error: m.register_error_exists(), displayName, email });
			}
		} catch (err) {
			console.error('(auth)/register: email lookup failed', err);
			return fail(500, { error: m.register_error_generic(), displayName, email });
		}

		const { data, error: signUpError } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: { role: 'parent', display_name: displayName },
				emailRedirectTo: `${url.origin}/auth/confirm?flow=signup`
			}
		});

		// With confirmations on there is no session; if a project runs without
		// them, still don't keep one from the registration form.
		if (data?.session) {
			const { error: signOutError } = await supabase.auth.signOut();
			if (signOutError) {
				console.error('(auth)/register: sign-out failed', signOutError.message);
			}
		}

		// Backstop for a race past the lookup above (same shapes as /join).
		if (isDuplicateSignup(signUpError, data?.user ?? null)) {
			return fail(400, { error: m.register_error_exists(), displayName, email });
		}
		if (signUpError || !data?.user) {
			console.error('(auth)/register: signUp failed', signUpError?.message);
			return fail(400, { error: m.register_error_generic(), displayName, email });
		}

		return { success: true as const, email };
	}
};
