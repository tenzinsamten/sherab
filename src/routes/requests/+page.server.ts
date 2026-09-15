import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdminClient, updateAuthUserEmailAndPassword } from '$lib/supabase/admin';
import {
	STUDENT_EMAIL_DOMAIN,
	generateStudentPin,
	generateUniqueStudentUsername,
	studentEmailToUsername,
	studentUsernameToEmail
} from '$lib/server/temp-password';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

const MAX_CREDENTIAL_ATTEMPTS = 5;

type StudentRow = {
	id: string;
	registration_name: string | null;
	status: 'pending' | 'approved' | 'rejected' | null;
	created_at: string;
	reviewed_at: string | null;
	classes: { id: string; name: string; code: string } | null;
};

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', session.user.id)
		.single();

	// UX-level gate only (AD-2: the real barrier is profiles_select_admin_or_
	// teacher_of_student_class in the migration -- a student or an
	// unassigned teacher gets zero rows below regardless of this check).
	if (!profile || (profile.role !== 'admin' && profile.role !== 'teacher')) {
		throw error(403, 'Admin or teacher access only.');
	}

	const selectColumns =
		'id, registration_name, status, created_at, reviewed_at, classes ( id, name, code )';

	const [
		{ data: pendingRows, error: pendingError },
		{ data: decidedRows, error: decidedError },
		{ data: teams, error: teamsError }
	] = await Promise.all([
		supabase
			.from('profiles')
			.select(selectColumns)
			.eq('role', 'student')
			.eq('status', 'pending')
			.order('created_at', { ascending: true }),
		supabase
			.from('profiles')
			.select(selectColumns)
			.eq('role', 'student')
			.in('status', ['approved', 'rejected'])
			.order('reviewed_at', { ascending: false }),
		supabase.from('teams').select('id, name').order('name')
	]);

	const toRow = (row: unknown) => {
		const r = row as StudentRow;
		return {
			id: r.id,
			registrationName: r.registration_name ?? '',
			status: r.status,
			createdAt: r.created_at,
			reviewedAt: r.reviewed_at,
			class: r.classes as unknown as { id: string; name: string; code: string } | null
		};
	};

	return {
		role: profile.role as 'admin' | 'teacher',
		pending: (pendingRows ?? []).map(toRow),
		decided: (decidedRows ?? []).map(toRow),
		teams: teams ?? [],
		loadError: Boolean(pendingError || decidedError || teamsError)
	};
};

export const actions: Actions = {
	approve: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.requests_error_not_signed_in() });
		}

		const formData = await request.formData();
		const studentId = String(formData.get('studentId') ?? '');
		const teamId = String(formData.get('teamId') ?? '');
		const studentName = String(formData.get('studentName') ?? '');

		if (!studentId || !teamId) {
			return fail(400, { error: m.requests_error_team_required(), studentId, studentName });
		}

		// RLS-gated read first (profiles_select_admin_or_teacher_of_student_
		// class): proves the caller is admin, or the teacher assigned to this
		// student's class, and that the row is still Pending, before the
		// privileged Admin API calls below (which bypass RLS entirely) run at
		// all. This also gets us registration_name for username generation.
		const { data: student, error: fetchError } = await supabase
			.from('profiles')
			.select('id, registration_name')
			.eq('id', studentId)
			.eq('role', 'student')
			.eq('status', 'pending')
			.single();

		if (fetchError || !student || !student.registration_name) {
			return fail(400, { error: m.requests_error_not_found(), studentId, studentName });
		}

		const adminClient = createSupabaseAdminClient();

		// Existing usernames = local part of every already-assigned synthesized
		// student email (the `pending-<uuid>` placeholder shape never collides
		// with a slugified-name username -- see generatePendingRegistrationEmail).
		const { data: existingProfiles } = await adminClient
			.from('profiles')
			.select('email')
			.ilike('email', `%@${STUDENT_EMAIL_DOMAIN}`);
		const existingUsernames = new Set(
			(existingProfiles ?? [])
				.map((p) => studentEmailToUsername(p.email))
				.filter((u): u is string => u !== null && !u.startsWith('pending-'))
		);

		let username = generateUniqueStudentUsername(student.registration_name, existingUsernames);
		let pin = generateStudentPin();
		let credentialsAssigned = false;

		for (let attempt = 0; attempt < MAX_CREDENTIAL_ATTEMPTS; attempt++) {
			// Goes through updateAuthUserEmailAndPassword (a direct Admin REST
			// call), not adminClient.auth.admin.updateUserById() -- the SDK
			// wraps every 500-status failure from this endpoint into a generic
			// AuthRetryableFetchError with no `code` and a fixed "Error updating
			// user" message, discarding the real Postgres error (`code:
			// "23505"`) a duplicate-email collision actually returns. Without
			// that code there is no way to tell "this email is already taken,
			// try the next candidate" apart from any other failure.
			const { error: updateAuthError } = await updateAuthUserEmailAndPassword(studentId, {
				email: studentUsernameToEmail(username),
				password: pin
			});

			if (!updateAuthError) {
				credentialsAssigned = true;
				break;
			}

			const isDuplicate =
				updateAuthError.code === '23505' ||
				updateAuthError.code === 'email_exists' ||
				/already.*registered|exists|duplicate/i.test(updateAuthError.message ?? '');
			if (!isDuplicate) {
				return fail(500, { error: m.requests_error_approve_failed(), studentId, studentName });
			}

			existingUsernames.add(username);
			username = generateUniqueStudentUsername(student.registration_name, existingUsernames);
			pin = generateStudentPin();
		}

		if (!credentialsAssigned) {
			return fail(500, { error: m.requests_error_approve_failed(), studentId, studentName });
		}

		// Only now flip status/team -- RLS (profiles_update_registration_review)
		// and the team_id-set-once trigger are the real enforcement (AD-2/AD-4);
		// this call is independently checked even though the fetch above
		// already proved the caller is authorized. `email` is included here
		// too: the Admin API call above only updated auth.users.email -- there
		// is no trigger syncing that back onto profiles.email on UPDATE (only
		// handle_new_user() populates it, and only on INSERT), so without this
		// the profile row would keep showing its stale pending-<uuid>
		// placeholder forever.
		const { error: updateProfileError } = await supabase
			.from('profiles')
			.update({
				status: 'approved',
				team_id: teamId,
				email: studentUsernameToEmail(username),
				reviewed_by: user.id,
				reviewed_at: new Date().toISOString()
			})
			.eq('id', studentId)
			.select('id')
			.single();

		if (updateProfileError) {
			// Credentials are already live on the auth user at this point; the
			// approval record itself failed to flip. Surface the credentials
			// anyway (they are real and will keep working) and let the admin
			// retry the same action -- a retry re-fetches (still Pending) and
			// simply regenerates fresh credentials, which is safe since no one
			// has seen the stale ones yet.
			return fail(500, {
				error: m.requests_error_approve_partial({ username, pin }),
				studentId,
				studentName
			});
		}

		return { success: true, action: 'approved' as const, studentId, studentName, username, pin };
	},

	reject: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.requests_error_not_signed_in() });
		}

		const formData = await request.formData();
		const studentId = String(formData.get('studentId') ?? '');
		const studentName = String(formData.get('studentName') ?? '');

		if (!studentId) {
			return fail(400, { error: m.requests_error_not_found(), studentId, studentName });
		}

		// Same RLS-gated pre-check as `approve`/`clearRejected`: distinguishes
		// "not found / already decided / not yours to act on" (the specific
		// message) from a genuine unexpected update failure below.
		const { data: student, error: fetchError } = await supabase
			.from('profiles')
			.select('id')
			.eq('id', studentId)
			.eq('role', 'student')
			.eq('status', 'pending')
			.single();

		if (fetchError || !student) {
			return fail(400, { error: m.requests_error_not_found(), studentId, studentName });
		}

		const { error: updateError } = await supabase
			.from('profiles')
			.update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
			.eq('id', studentId)
			.select('id')
			.single();

		if (updateError) {
			return fail(400, { error: m.requests_error_reject_failed(), studentId, studentName });
		}

		return { success: true, action: 'rejected' as const, studentId, studentName };
	},

	clearRejected: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const studentId = String(formData.get('studentId') ?? '');
		const studentName = String(formData.get('studentName') ?? '');

		if (!studentId) {
			return fail(400, { error: m.requests_error_not_found(), studentId, studentName });
		}

		// RLS-gated read first, same reasoning as `approve` above: proves the
		// caller may act on this row before the privileged delete (which
		// bypasses RLS) runs. Only a still-rejected row is clearable.
		const { data: student, error: fetchError } = await supabase
			.from('profiles')
			.select('id')
			.eq('id', studentId)
			.eq('role', 'student')
			.eq('status', 'rejected')
			.single();

		if (fetchError || !student) {
			return fail(400, { error: m.requests_error_not_found(), studentId, studentName });
		}

		// Deletes the auth.users row, which cascades to profiles (AD-4's FK)
		// -- this IS the explicit deletion the story's AC requires ("not
		// silently deleted without that explicit action").
		const adminClient = createSupabaseAdminClient();
		const { error: deleteError } = await adminClient.auth.admin.deleteUser(studentId);

		if (deleteError) {
			return fail(500, { error: m.requests_error_clear_failed(), studentId, studentName });
		}

		return { success: true, action: 'cleared' as const, studentId, studentName };
	}
};
