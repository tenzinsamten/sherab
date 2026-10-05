import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { isValidParentEmail } from '$lib/server/parent-registration';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals: { safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (session) {
		throw redirect(303, '/');
	}
	// Prefilled from the register receipt and the sign-in form.
	return { email: url.searchParams.get('email') ?? '' };
};

/**
 * #89: a parent whose confirmation mail expired, got lost or was used up asks
 * for a new one with only their email. Until now the only way was to sign in
 * with the right password, which nothing told them.
 */
export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const email = String((await request.formData()).get('email') ?? '')
			.trim()
			.toLowerCase();
		if (!isValidParentEmail(email)) {
			return fail(400, { error: m.resend_error_required(), email });
		}

		// GoTrue sends nothing for an unknown or already confirmed address and
		// allows one mail per address per minute. Whatever happens the answer
		// is the same, so the form can't be used to find out who has an account.
		const { error } = await supabase.auth.resend({
			type: 'signup',
			email,
			options: { emailRedirectTo: `${url.origin}/auth/confirm?flow=signup` }
		});
		if (error) console.error('resend-confirmation: resend failed', error.message);

		return { success: true as const, email };
	}
};
