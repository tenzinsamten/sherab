import { fail, redirect } from '@sveltejs/kit';
import { JOIN_RECEIPT_COOKIE, type JoinReceipt } from '$lib/server/join-receipt';
import { approvedParentExists } from '$lib/server/parent-registration';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

/** The registration-time auth address (Story 7-2); approval replaces it. */
function pendingStudentEmail(): string {
	return `pending-${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`;
}

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
		const guardianEmail = String(formData.get('guardianEmail') ?? '').trim();
		const guardianConsent = formData.get('guardianConsent') === 'on';

		if (!classId || !registrationName || !guardianEmail) {
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

		// Story 7-2: a student registers only with an approved parent's email.
		// Found / not found is all this reveals; a pending, unconfirmed or
		// rejected parent counts as not found. handle_new_user() repeats the
		// match inside the sign-up transaction -- this is the friendly
		// pre-check, not the enforcement.
		const adminClient = createSupabaseAdminClient();
		let parentFound: boolean;
		try {
			parentFound = await approvedParentExists(adminClient, guardianEmail);
		} catch (lookupError) {
			console.error('(auth)/join register: parent lookup failed', lookupError);
			return fail(500, { error: m.join_error_generic(), guardianEmail });
		}
		if (!parentFound) {
			return fail(400, { error: m.join_error_no_parent(), guardianEmail });
		}

		// The auth user gets a synthetic, pre-confirmed address and a random
		// password nobody ever sees: no mail is sent, and siblings never
		// collide on Auth's unique email. Real credentials are minted at
		// teacher approval (requests/+page.server.ts), which rewrites this
		// address -- the `pending-` prefix is skipped by its username scan.
		const { error: createError } = await adminClient.auth.admin.createUser({
			email: pendingStudentEmail(),
			password: crypto.randomUUID(),
			email_confirm: true,
			user_metadata: {
				role: 'student',
				class_id: classId,
				registration_name: registrationName,
				guardian_consent_given_at: new Date().toISOString(),
				guardian_email: guardianEmail
			}
		});

		if (createError) {
			// The error is generic whatever the cause inside handle_new_user().
			// Re-checking tells the two expected races apart: a concurrent
			// registration for the same (class, name) pair, or the parent
			// becoming unavailable since the pre-check above.
			const { data: stillAvailable } = await supabase.rpc('check_registration_available', {
				p_class_id: classId,
				p_registration_name: registrationName
			});
			if (stillAvailable === false) {
				return fail(400, { error: m.join_error_duplicate(), guardianEmail });
			}
			const stillFound = await approvedParentExists(adminClient, guardianEmail).catch(
				(recheckError) => {
					console.error('(auth)/join register: parent re-check failed', recheckError);
					return true;
				}
			);
			if (!stillFound) {
				return fail(400, { error: m.join_error_no_parent(), guardianEmail });
			}
			console.error('(auth)/join register: createUser failed', createError.message);
			return fail(400, { error: m.join_error_generic(), guardianEmail });
		}

		cookies.set(
			JOIN_RECEIPT_COOKIE,
			JSON.stringify({ name: registrationName, className, classCode } satisfies JoinReceipt),
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
