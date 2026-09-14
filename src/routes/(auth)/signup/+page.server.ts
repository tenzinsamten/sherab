import { fail, redirect } from '@sveltejs/kit';
import { isDuplicateSignup } from '$lib/server/signup-duplicate';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (session) {
		throw redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const password = String(formData.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { error: m.signup_error_required(), email });
		}
		if (password.length < 6) {
			return fail(400, { error: m.signup_error_password_length(), email });
		}

		const { data, error } = await supabase.auth.signUp({ email, password });

		// Checked before the plain error branch: when email confirmation is
		// required, Supabase returns *success* with an empty `identities` array
		// for a duplicate email instead of an error (see isDuplicateSignup).
		if (isDuplicateSignup(error, data?.user ?? null)) {
			return fail(400, { error: m.signup_error_duplicate(), email });
		}
		if (error) {
			return fail(400, { error: error.message, email });
		}

		throw redirect(303, '/?justSignedUp=1');
	}
};
