import { fail, redirect } from '@sveltejs/kit';
import { resolveLoginIdentifierToEmail } from '$lib/server/temp-password';
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
		// One shared form for every role (Design Notes) -- an admin/teacher
		// types their real email, a student types the bare username they were
		// given at approval. The field is still named/echoed as `email` to
		// keep this a minimal change; `identifier` is only the local name for
		// what's actually in it before resolution.
		const identifier = String(formData.get('email') ?? '').trim();
		const password = String(formData.get('password') ?? '');

		if (!identifier || !password) {
			return fail(400, { error: m.login_error_required(), email: identifier });
		}

		const email = resolveLoginIdentifierToEmail(identifier);
		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			// Deliberately generic: never reveal whether the account exists
			// (Story 1-1 AC: "Wrong password -> standard auth error, no
			// account/session leak").
			return fail(400, { error: m.login_error_invalid(), email: identifier });
		}

		throw redirect(303, '/');
	}
};
