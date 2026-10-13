import { fail, redirect } from '@sveltejs/kit';
import { JOIN_RECEIPT_COOKIE, type JoinReceipt } from '$lib/server/join-receipt';
import {
	approvedParentExists,
	studentRegistrationState,
	type StudentRegistrationState
} from '$lib/server/parent-registration';
import {
	MAX_CREDENTIAL_ATTEMPTS,
	PENDING_EMAIL_PREFIX,
	isDuplicateEmailError,
	takenStudentUsernames
} from '$lib/server/student-credentials';
import {
	STUDENT_EMAIL_DOMAIN,
	generateStudentPin,
	generateUniqueStudentUsername,
	studentUsernameToEmail
} from '$lib/server/temp-password';
import { createSupabaseAdminClient, updateAuthUserEmailAndPassword } from '$lib/supabase/admin';
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

/**
 * The registration-time auth address (Story 7-2): the only shape
 * handle_new_user() accepts for a student sign-up. #100 replaces it with the
 * username address right after the account exists.
 */
function pendingStudentEmail(): string {
	return `${PENDING_EMAIL_PREFIX}${crypto.randomUUID()}@${STUDENT_EMAIL_DOMAIN}`;
}

/**
 * #100: gives a just-created student the username address and a PIN, the
 * way approval did before. Auth's unique email is the guarantee for the
 * username: on a taken address the next one is tried, with a new PIN.
 *
 * Returns the credentials; `null` when they could not be set or recorded
 * (the account stays on its placeholder address in the profile, so approval
 * makes them); `'exhausted'` when every try met a taken username.
 *
 * The PIN is the Auth password. It is returned for the confirmation cookie
 * and is never stored or logged here.
 */
async function assignCredentials(
	adminClient: ReturnType<typeof createSupabaseAdminClient>,
	studentId: string,
	registrationName: string
): Promise<{ username: string; pin: string } | null | 'exhausted'> {
	try {
		const taken = await takenStudentUsernames(adminClient);
		for (let attempt = 0; attempt < MAX_CREDENTIAL_ATTEMPTS; attempt++) {
			const username = generateUniqueStudentUsername(registrationName, taken);
			const pin = generateStudentPin();
			const email = studentUsernameToEmail(username);
			const { error } = await updateAuthUserEmailAndPassword(studentId, { email, password: pin });
			if (error) {
				if (isDuplicateEmailError(error)) {
					taken.add(username);
					continue;
				}
				console.error('(auth)/join register: setting the username failed', error.message);
				return null;
			}

			// The Admin API call changed auth.users only; nothing copies an
			// updated address to the profile. Approval tells by the profile
			// address whether a student has credentials, so without this row
			// the credentials are not handed out: approval then makes new ones.
			const { data: saved, error: profileError } = await adminClient
				.from('profiles')
				.update({ email })
				.eq('id', studentId)
				.select('id')
				.maybeSingle();
			if (profileError || !saved) {
				console.error(
					'(auth)/join register: recording the username failed',
					profileError?.message ?? 'no profile row'
				);
				return null;
			}
			return { username, pin };
		}
		console.error('(auth)/join register: no free username after retries');
		return 'exhausted';
	} catch (unexpected) {
		console.error('(auth)/join register: credentials failed', unexpected);
		return null;
	}
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

		// The auth user is created on a synthetic, pre-confirmed `pending-<uuid>`
		// address with a random password: no mail is sent, and it is the only
		// address handle_new_user() (0024) accepts for a student sign-up. The
		// username and PIN follow right below (#100).
		const { data: created, error: createError } = await adminClient.auth.admin.createUser({
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

		// #100: the student gets the username and PIN now, not at approval.
		// From here on the registration has succeeded whatever happens: without
		// credentials the page shows its generic text, and approval makes them
		// as it does for a registration from before #100. The one exception is
		// five taken usernames in a row, which ends the registration and removes
		// the account.
		const studentId = created.user?.id;
		let credentials: { username: string; pin: string } | null = null;
		if (studentId) {
			const outcome = await assignCredentials(adminClient, studentId, registrationName);
			if (outcome === 'exhausted') {
				const { error: deleteError } = await adminClient.auth.admin.deleteUser(studentId);
				if (!deleteError) {
					return fail(400, { error: m.join_error_generic(), guardianEmail });
				}
				// The account could not be removed and would block registering
				// again (#98), so the registration stands, without credentials:
				// approval makes them.
				console.error('(auth)/join register: cleanup failed', deleteError.message);
			} else {
				credentials = outcome;
			}
		}

		cookies.set(
			JOIN_RECEIPT_COOKIE,
			JSON.stringify({
				name: registrationName,
				className,
				classCode,
				...(credentials ?? {})
			} satisfies JoinReceipt),
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
