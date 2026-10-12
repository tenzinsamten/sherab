import { fail, redirect } from '@sveltejs/kit';
import { JOIN_RECEIPT_COOKIE, type JoinReceipt } from '$lib/server/join-receipt';
import {
	approvedParentExists,
	studentRegistrationState,
	type StudentRegistrationState
} from '$lib/server/parent-registration';
import { STUDENT_EMAIL_DOMAIN } from '$lib/server/temp-password';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * #98: the refusal for a parent who already has a student with this name.
 * An approved child is sent to "Join another class" (which keeps the team);
 * a pending or rejected one waits for the teacher.
 */
function duplicateMessage(state: StudentRegistrationState): string | null {
	if (state === 'approved') return m.join_error_already_student();
	if (state === 'pending' || state === 'rejected') return m.join_error_duplicate();
	return null;
}

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
	register: async ({ request, cookies }) => {
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

		// #98: one student account per parent and name, in any class and any
		// status. The real, DB-level guarantee is the unique index
		// profiles_student_parent_name_unique (migration 0042), which makes
		// handle_new_user()'s insert fail -- this lookup turns the expected
		// case into a clean message. It comes after the parent lookup because
		// the rule is per parent.
		let state: StudentRegistrationState;
		try {
			state = await studentRegistrationState(adminClient, guardianEmail, registrationName);
		} catch (lookupError) {
			console.error('(auth)/join register: registration state lookup failed', lookupError);
			return fail(500, { error: m.join_error_generic(), guardianEmail });
		}
		const refusal = duplicateMessage(state);
		if (refusal) {
			return fail(400, { error: refusal, guardianEmail });
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
			// Re-reading the state tells the two expected races apart: a
			// concurrent registration for the same parent and name (the unique
			// index refused this one), or the parent becoming unavailable since
			// the pre-check above.
			const stateNow = await studentRegistrationState(
				adminClient,
				guardianEmail,
				registrationName
			).catch((recheckError) => {
				console.error('(auth)/join register: registration state re-check failed', recheckError);
				return 'available' as const;
			});
			const refusalNow = duplicateMessage(stateNow);
			if (refusalNow) {
				return fail(400, { error: refusalNow, guardianEmail });
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
