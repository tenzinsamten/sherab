import { fail, redirect } from '@sveltejs/kit';
import { RECOVERY_COOKIE } from '$lib/server/password-reset';
import { checkNewPassword } from '$lib/server/password-rules';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = '/forgot-password?error=expired';

export const load: PageServerLoad = async ({ cookies, locals: { safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (!session || !cookies.get(RECOVERY_COOKIE)) {
		throw redirect(303, EXPIRED);
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, locals: { supabase, safeGetSession } }) => {
		const { session } = await safeGetSession();
		if (!session || !cookies.get(RECOVERY_COOKIE)) {
			throw redirect(303, EXPIRED);
		}

		const formData = await request.formData();
		const password = String(formData.get('password') ?? '');
		const confirm = String(formData.get('confirm') ?? '');

		const problem = checkNewPassword(password, confirm);
		if (problem === 'length') {
			return fail(400, { error: m.reset_error_length() });
		}
		if (problem === 'mismatch') {
			return fail(400, { error: m.reset_error_mismatch() });
		}

		const { error } = await supabase.auth.updateUser({ password });
		if (error) {
			return fail(400, { error: m.reset_error_failed() });
		}

		cookies.delete(RECOVERY_COOKIE, { path: '/' });
		// Invalidate every other session (e.g. an attacker's) after the change.
		const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
		if (signOutError) {
			console.error('reset-password: failed to sign out other sessions', signOutError.message);
		}

		throw redirect(303, '/');
	}
};
