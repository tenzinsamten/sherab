import { fail, redirect } from '@sveltejs/kit';
import { resolveLoginIdentifierToEmail } from '$lib/server/temp-password';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals: { safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (session) {
		throw redirect(303, '/');
	}
	// Set by /auth/confirm when a sign-up confirmation link fails (Story 7-1).
	return { confirmLinkFailed: url.searchParams.get('error') === 'confirm' };
};

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
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

		// GoTrue checks the password before the confirmation, so this only
		// tells someone who knows the password that the email is unconfirmed
		// (a parent who hasn't opened their link yet, Story 7-1). The first
		// link may have expired, so send a fresh one.
		if (error?.code === 'email_not_confirmed') {
			const { error: resendError } = await supabase.auth.resend({
				type: 'signup',
				email,
				options: { emailRedirectTo: `${url.origin}/auth/confirm?flow=signup` }
			});
			if (resendError) {
				console.error('login: confirmation resend failed', resendError.message);
				return fail(400, {
					error: m.login_error_unconfirmed(),
					email: identifier,
					unconfirmed: true
				});
			}
			return fail(400, {
				error: m.login_error_unconfirmed_resent(),
				email: identifier,
				unconfirmed: true
			});
		}

		if (error) {
			// Deliberately generic: never reveal whether the account exists
			// (Story 1-1 AC: "Wrong password -> standard auth error, no
			// account/session leak").
			return fail(400, { error: m.login_error_invalid(), email: identifier });
		}

		throw redirect(303, '/');
	}
};
