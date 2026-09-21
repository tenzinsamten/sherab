import { fail, redirect } from '@sveltejs/kit';
import { requestPasswordReset } from '$lib/server/password-reset';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals: { safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (session) {
		throw redirect(303, '/');
	}
	return { expired: url.searchParams.get('error') === 'expired' };
};

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const identifier = String(formData.get('email') ?? '').trim();
		if (!identifier) {
			return fail(400, { error: m.forgot_error_required(), email: identifier });
		}

		if (!identifier.includes('@')) {
			return fail(400, { error: m.forgot_error_student(), email: identifier });
		}

		await requestPasswordReset(identifier, { origin: url.origin, supabase });

		// Identical response whether or not the account exists.
		return { success: true };
	}
};
