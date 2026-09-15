import { fail, redirect } from '@sveltejs/kit';
import { generatePendingRegistrationEmail } from '$lib/server/temp-password';
import { JOIN_RECEIPT_COOKIE } from '$lib/server/join-receipt';
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
	register: async ({ request, cookies, locals: { supabase } }) => {
		const formData = await request.formData();
		const classId = String(formData.get('classId') ?? '').trim();
		const className = String(formData.get('className') ?? '').trim();
		const classCode = String(formData.get('classCode') ?? '').trim();
		const registrationName = String(formData.get('registrationName') ?? '').trim();
		const guardianConsent = formData.get('guardianConsent') === 'on';

		if (!classId || !registrationName) {
			return fail(400, { error: m.join_error_missing_fields() });
		}
		if (!guardianConsent) {
			return fail(400, { error: m.join_error_consent_required() });
		}

		// Friendly pre-check for the duplicate-registration Boundary. The real,
		// DB-level guarantee is profiles_open_student_registration_unique (see
		// migration 0002) -- this RPC just turns the expected case into a clean
		// inline error instead of a raw failure surfaced through signUp()'s
		// trigger-side insert below (AD-2 spirit: this is a UX nicety on top of
		// the real enforcement, not a replacement for it).
		const { data: available, error: availabilityError } = await supabase.rpc(
			'check_registration_available',
			{ p_class_id: classId, p_registration_name: registrationName }
		);

		if (availabilityError) {
			return fail(400, { error: m.join_error_generic() });
		}
		if (available === false) {
			return fail(400, { error: m.join_error_duplicate() });
		}

		const guardianConsentGivenAt = new Date().toISOString();

		const { error: signUpError } = await supabase.auth.signUp({
			email: generatePendingRegistrationEmail(),
			password: crypto.randomUUID(),
			options: {
				data: {
					role: 'student',
					class_id: classId,
					registration_name: registrationName,
					guardian_consent_given_at: guardianConsentGivenAt
				}
			}
		});

		// Whether signUp succeeded or not, never leave a session behind for a
		// Pending account -- there is nothing a Pending student can
		// legitimately do yet (I/O matrix: "invisible everywhere, no
		// activity"), and /join/pending needs no session, only the receipt
		// cookie set below. A failed sign-out here would otherwise leave that
		// browser holding a live (if useless -- RLS still gates real access)
		// session, so it's worth a server-side log even though the user-facing
		// flow doesn't need to change over it.
		const { error: signOutError } = await supabase.auth.signOut();
		if (signOutError) {
			console.error(
				'(auth)/join register: failed to sign out after registration',
				signOutError.message
			);
		}

		if (signUpError) {
			// The raw signUp() error is generic ("Database error saving new
			// user", status 500, no distinguishing code) regardless of cause --
			// Postgres/GoTrue give no signal here for "the
			// profiles_open_student_registration_unique backstop rejected this
			// insert" versus any other failure inside handle_new_user().
			// Re-checking availability is what actually tells them apart: if a
			// concurrent registration for the same (class, name) pair won the
			// race between this action's own pre-check above and this signUp()
			// call, check_registration_available now says so.
			const { data: stillAvailable } = await supabase.rpc('check_registration_available', {
				p_class_id: classId,
				p_registration_name: registrationName
			});

			if (stillAvailable === false) {
				return fail(400, { error: m.join_error_duplicate() });
			}
			return fail(400, { error: m.join_error_generic() });
		}

		cookies.set(
			JOIN_RECEIPT_COOKIE,
			JSON.stringify({ name: registrationName, className, classCode }),
			{
				path: '/join/pending',
				maxAge: 60 * 10,
				httpOnly: true,
				sameSite: 'lax'
			}
		);

		throw redirect(303, '/join/pending');
	}
};
