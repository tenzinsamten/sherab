import { fail, redirect } from '@sveltejs/kit';
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
			return fail(400, { error: m.login_error_required(), email });
		}

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			// Deliberately generic: never reveal whether the account exists
			// (Story 1-1 AC: "Wrong password -> standard auth error, no
			// account/session leak").
			return fail(400, { error: m.login_error_invalid(), email });
		}

		throw redirect(303, '/');
	}
};
