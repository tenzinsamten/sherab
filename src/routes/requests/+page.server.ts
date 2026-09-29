import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdminClient, updateAuthUserEmailAndPassword } from '$lib/supabase/admin';
import {
	STUDENT_EMAIL_DOMAIN,
	generateStudentPin,
	generateUniqueStudentUsername,
	studentEmailToUsername,
	studentUsernameToEmail
} from '$lib/server/temp-password';
import { getCapabilities } from '$lib/server/capabilities';
import { loadSickLeave, sickDecisionErrorMessage } from '$lib/server/leave';
import { classJoinDecisionErrorMessage, loadClassJoinRequests } from '$lib/server/class-join';
import * as m from '$lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

const MAX_CREDENTIAL_ATTEMPTS = 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StudentRow = {
	id: string;
	registration_name: string | null;
	status: 'pending' | 'approved' | 'rejected' | null;
	created_at: string;
	reviewed_at: string | null;
	classes: { id: string; name: string; code: string } | null;
};

type ParentRow = {
	id: string;
	status: 'pending' | 'approved' | 'rejected';
	created_at: string;
	reviewed_at: string | null;
	profiles: {
		display_name: string | null;
		email: string;
		email_confirmed_at: string | null;
	} | null;
};

/**
 * parents -> profiles has two FK paths (id, reviewed_by), so the embed needs
 * the explicit hint (same PGRST201 reason as the student select below).
 */
const PARENT_COLUMNS =
	'id, status, created_at, reviewed_at, profiles!parents_id_fkey ( display_name, email, email_confirmed_at )';

function toParent(row: unknown) {
	const r = row as ParentRow;
	return {
		id: r.id,
		status: r.status,
		name: r.profiles?.display_name || r.profiles?.email || '',
		email: r.profiles?.email ?? '',
		emailConfirmedAt: r.profiles?.email_confirmed_at ?? null,
		createdAt: r.created_at,
		reviewedAt: r.reviewed_at
	};
}

type DeletionRow = {
	id: string;
	student_id: string | null;
	requested_by: string | null;
	status: 'pending' | 'approved' | 'rejected';
	requested_at: string;
	reviewed_at: string | null;
	student: { display_name: string | null; registration_name: string | null } | null;
	requester: { display_name: string | null; email: string } | null;
};

/**
 * Story 7-6: deletion_requests -> profiles has three FK paths (student_id,
 * requested_by, reviewed_by), so each embed names its FK.
 */
const DELETION_COLUMNS =
	'id, student_id, requested_by, status, requested_at, reviewed_at, student:profiles!deletion_requests_student_id_fkey ( display_name, registration_name ), requester:profiles!deletion_requests_requested_by_fkey ( display_name, email )';

function toDeletion(row: unknown, viewerId: string) {
	const r = row as DeletionRow;
	return {
		id: r.id,
		status: r.status,
		/** null = the student has been erased (the de-identified row). */
		studentName:
			r.student_id === null ? null : r.student?.display_name || r.student?.registration_name || '',
		requesterName: r.requester?.display_name || r.requester?.email || '',
		requestedAt: r.requested_at,
		reviewedAt: r.reviewed_at,
		// Only the child's parent submits, so the requester is the parent: the
		// admin never decides for their own child (the policy refuses it too).
		ownChild: r.requested_by !== null && r.requested_by === viewerId
	};
}

/**
 * Story 7-1: parent accounts are decided by the admin only. UX gate over
 * RLS (parents_update_admin), re-checked per action since a POST skips load.
 */
async function requireAdmin(
	supabase: App.Locals['supabase'],
	safeGetSession: App.Locals['safeGetSession']
) {
	const { user } = await safeGetSession();
	if (!user) return null;
	const capabilities = await getCapabilities(supabase, user.id);
	return capabilities?.role === 'admin' ? user : null;
}

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

	// classes!profiles_class_id_fkey (not the bare "classes" embed shorthand)
	// -- profiles<->classes now has three FK paths (classes.created_by,
	// profiles.class_id, and the class_teachers many-to-many), so PostgREST
	// refuses to guess and returns PGRST201 without an explicit hint. Caught
	// live: rls.spec.ts asserts against raw table selects, never against this
	// route's actual embedded-relation syntax, so this was silently broken
	// for every real visit to /requests until browser-verified here.
	const selectColumns =
		'id, registration_name, status, created_at, reviewed_at, classes!profiles_class_id_fkey ( id, name, code )';

	const [
		{ data: pendingRows, error: pendingError },
		{ data: decidedRows, error: decidedError },
		{ data: teams, error: teamsError },
		{ sickPending, sickDecided, sickError },
		{ joinPending, joinError }
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
		supabase.from('teams').select('id, name').order('name'),
		loadSickLeave(supabase),
		// B12b (#67): class join requests of the caller's classes (every class
		// for the admin). A failure shows in that section only (joinLoadError).
		loadClassJoinRequests(supabase)
	]);

	// Admin only: teachers never see parent registrations, not even a count.
	let parentsPending: ReturnType<typeof toParent>[] = [];
	let parentsDecided: ReturnType<typeof toParent>[] = [];
	let parentsError = false;
	let deletionPending: ReturnType<typeof toDeletion>[] = [];
	let deletionDecided: ReturnType<typeof toDeletion>[] = [];
	let deletionError = false;
	if (profile.role === 'admin') {
		const [pendingParents, decidedParents, pendingDeletions, decidedDeletions] = await Promise.all([
			supabase
				.from('parents')
				.select(PARENT_COLUMNS)
				.eq('status', 'pending')
				.order('created_at', { ascending: true }),
			supabase
				.from('parents')
				.select(PARENT_COLUMNS)
				.in('status', ['approved', 'rejected'])
				.order('reviewed_at', { ascending: false }),
			// Story 7-6: the deletion queue is admin-only (teachers have no access).
			supabase
				.from('deletion_requests')
				.select(DELETION_COLUMNS)
				.eq('status', 'pending')
				.order('requested_at', { ascending: true }),
			supabase
				.from('deletion_requests')
				.select(DELETION_COLUMNS)
				.in('status', ['approved', 'rejected'])
				.order('reviewed_at', { ascending: false })
		]);
		deletionPending = (pendingDeletions.data ?? []).map((r) => toDeletion(r, session.user.id));
		deletionDecided = (decidedDeletions.data ?? []).map((r) => toDeletion(r, session.user.id));
		deletionError = Boolean(pendingDeletions.error || decidedDeletions.error);
		parentsPending = (pendingParents.data ?? []).map(toParent);
		parentsDecided = (decidedParents.data ?? []).map(toParent);
		parentsError = Boolean(pendingParents.error || decidedParents.error);
	}

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
		parentsPending,
		parentsDecided,
		sickPending,
		sickDecided,
		deletionPending,
		deletionDecided,
		joinPending,
		joinLoadError: joinError,
		loadError: Boolean(
			pendingError || decidedError || teamsError || parentsError || sickError || deletionError
		)
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
				error: m.requests_error_approve_partial(),
				studentId,
				studentName,
				username,
				pin
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
	},

	/**
	 * Story 7-5: approve or reject a pending Sick answer. The database stamps
	 * decided_by / decided_at, refuses anything but a current Sick, and RLS
	 * refuses anyone but a teacher of the class or the admin -- and never the
	 * student's own parent. A decision is final (unique per session, student).
	 */
	decideSick: async ({ request, locals: { supabase, safeGetSession } }) => {
		const formData = await request.formData();
		const sessionId = String(formData.get('sessionId') ?? '');
		const studentId = String(formData.get('studentId') ?? '');
		const studentName = String(formData.get('studentName') ?? '');
		const decision = String(formData.get('decision') ?? '');

		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.requests_error_not_signed_in(), sessionId, studentId });
		}
		if (
			!UUID_PATTERN.test(sessionId) ||
			!UUID_PATTERN.test(studentId) ||
			(decision !== 'approved' && decision !== 'rejected')
		) {
			return fail(400, { error: m.requests_error_not_found(), sessionId, studentId });
		}

		const { error: insertError } = await supabase
			.from('sick_leave_decisions')
			.insert({ class_session_id: sessionId, student_id: studentId, decision })
			.select('id')
			.single();
		if (insertError) {
			return fail(insertError.code === '42501' ? 403 : 400, {
				error: sickDecisionErrorMessage(insertError),
				sessionId,
				studentId
			});
		}

		return {
			success: true,
			action: decision === 'approved' ? ('sickApproved' as const) : ('sickRejected' as const),
			sessionId,
			studentId,
			sickStudentName: studentName
		};
	},

	approveParent: async ({ request, locals: { supabase, safeGetSession } }) => {
		const formData = await request.formData();
		const parentId = String(formData.get('parentId') ?? '');
		const parentName = String(formData.get('parentName') ?? '');

		const user = await requireAdmin(supabase, safeGetSession);
		if (!user) {
			return fail(403, { error: m.requests_parent_error_admin_only(), parentId, parentName });
		}

		const { data: row, error: fetchError } = await supabase
			.from('parents')
			.select(PARENT_COLUMNS)
			.eq('id', parentId)
			.eq('status', 'pending')
			.maybeSingle();
		if (fetchError || !row) {
			return fail(400, { error: m.requests_error_not_found(), parentId, parentName });
		}
		// Friendly message; parents_update_admin's WITH CHECK refuses it anyway.
		if (!toParent(row).emailConfirmedAt) {
			return fail(400, { error: m.requests_parent_error_unconfirmed(), parentId, parentName });
		}

		// reviewed_by / reviewed_at are stamped by the parents_stamp_review trigger.
		const { error: updateError } = await supabase
			.from('parents')
			.update({ status: 'approved' })
			.eq('id', parentId)
			.eq('status', 'pending')
			.select('id')
			.single();
		if (updateError) {
			return fail(400, { error: m.requests_parent_error_approve_failed(), parentId, parentName });
		}

		return { success: true, action: 'parentApproved' as const, parentId, parentName };
	},

	rejectParent: async ({ request, locals: { supabase, safeGetSession } }) => {
		const formData = await request.formData();
		const parentId = String(formData.get('parentId') ?? '');
		const parentName = String(formData.get('parentName') ?? '');

		const user = await requireAdmin(supabase, safeGetSession);
		if (!user) {
			return fail(403, { error: m.requests_parent_error_admin_only(), parentId, parentName });
		}

		// RLS-scoped read first: proves the caller is the admin and the row
		// exists before the service-role delete below (which bypasses RLS).
		// A 'rejected' row is one whose delete failed earlier: retry it.
		const { data: row, error: fetchError } = await supabase
			.from('parents')
			.select('id, status')
			.eq('id', parentId)
			.in('status', ['pending', 'rejected'])
			.maybeSingle();
		if (fetchError || !row) {
			return fail(400, { error: m.requests_error_not_found(), parentId, parentName });
		}

		// Only a parent-only login is deleted. A dual-role login (deferred)
		// must never lose its staff account here.
		const { data: target } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', parentId)
			.maybeSingle();
		if (target?.role !== 'parent') {
			return fail(400, { error: m.requests_parent_error_reject_failed(), parentId, parentName });
		}

		if (row.status === 'pending') {
			const { error: updateError } = await supabase
				.from('parents')
				.update({ status: 'rejected' })
				.eq('id', parentId)
				.eq('status', 'pending')
				.select('id')
				.single();
			if (updateError) {
				return fail(400, { error: m.requests_parent_error_reject_failed(), parentId, parentName });
			}
		}

		// Deleting the auth user cascades to profiles and parents, so the same
		// email can register again.
		const { error: deleteError } =
			await createSupabaseAdminClient().auth.admin.deleteUser(parentId);
		if (deleteError) {
			console.error('requests rejectParent: deleteUser failed', deleteError.message);
			return fail(500, { error: m.requests_parent_error_reject_failed(), parentId, parentName });
		}

		return { success: true, action: 'parentRejected' as const, parentId, parentName };
	},

	/**
	 * Story 7-6: approve a pending deletion request. The database stamps
	 * reviewed_by / reviewed_at and, on approval, erases the child's account
	 * and every student-keyed row by trigger. RLS refuses anyone but the admin,
	 * and the admin for their own child.
	 */
	approveDeletion: async (event) => decideDeletion(event, 'approved'),

	/** Story 7-6: reject a pending deletion request. Nothing is erased. */
	rejectDeletion: async (event) => decideDeletion(event, 'rejected'),

	/**
	 * B12b (#67): approve a class join request. decide_class_join (0031)
	 * refuses anyone but the class's teacher or the admin, and never the
	 * student's own parent; approval enrols the student.
	 */
	approveJoin: async (event) => decideJoin(event, 'approved'),

	/** B12b (#67): reject a class join request. Nothing is enrolled. */
	rejectJoin: async (event) => decideJoin(event, 'rejected')
};

async function decideJoin(
	{ request, locals: { supabase, safeGetSession } }: Parameters<Actions[string]>[0],
	decision: 'approved' | 'rejected'
) {
	const formData = await request.formData();
	const requestId = String(formData.get('requestId') ?? '');

	const { user } = await safeGetSession();
	if (!user) {
		return fail(401, { error: m.requests_error_not_signed_in(), requestId });
	}
	if (!UUID_PATTERN.test(requestId)) {
		return fail(400, { error: m.requests_error_not_found(), requestId });
	}

	const { error: decideError } = await supabase.rpc('decide_class_join', {
		p_request_id: requestId,
		p_decision: decision
	});
	if (decideError) {
		return fail(decideError.code === '42501' ? 403 : 400, {
			error: classJoinDecisionErrorMessage(decideError),
			requestId,
			// Decided elsewhere: the page reloads so the stale row goes.
			joinStale: decideError.hint === 'join_not_pending'
		});
	}

	return {
		success: true,
		action: decision === 'approved' ? ('joinApproved' as const) : ('joinRejected' as const),
		requestId
	};
}

async function decideDeletion(
	{ request, locals: { supabase, safeGetSession } }: Parameters<Actions[string]>[0],
	status: 'approved' | 'rejected'
) {
	const formData = await request.formData();
	const requestId = String(formData.get('requestId') ?? '');
	const deletionStudentName = String(formData.get('studentName') ?? '');

	const user = await requireAdmin(supabase, safeGetSession);
	if (!user) {
		return fail(403, {
			error: m.requests_deletion_error_not_allowed(),
			requestId,
			deletionStudentName
		});
	}
	if (!UUID_PATTERN.test(requestId)) {
		return fail(400, { error: m.requests_error_not_found(), requestId, deletionStudentName });
	}

	const { data, error: updateError } = await supabase
		.from('deletion_requests')
		.update({ status })
		.eq('id', requestId)
		.eq('status', 'pending')
		.select('id')
		.maybeSingle();
	if (updateError) {
		return fail(updateError.code === '42501' ? 403 : 400, {
			error:
				updateError.code === '42501'
					? m.requests_deletion_error_not_allowed()
					: m.requests_deletion_error_failed(),
			requestId,
			deletionStudentName
		});
	}
	if (!data) {
		return fail(400, { error: m.requests_error_not_found(), requestId, deletionStudentName });
	}

	return {
		success: true,
		action: status === 'approved' ? ('deletionApproved' as const) : ('deletionRejected' as const),
		requestId,
		deletionStudentName
	};
}
