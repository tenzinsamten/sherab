import * as m from '$lib/paraglide/messages.js';
import { pickLocalized } from '$lib/localized-name';

/**
 * B12a (#67): class join requests. The 0031 functions name their refusal in
 * the error hint; 42501 = not allowed.
 */
export type PgError = { code?: string; hint?: string | null } | null;

/** How long a typed class code may be before it's refused without a lookup. */
export const MAX_JOIN_CODE_LENGTH = 32;

/**
 * At most this many pending requests per student. The cap itself is the
 * literal in request_class_join (0031); keep the two in step.
 */
export const MAX_PENDING_JOIN_REQUESTS = 3;

/** A request_class_join refusal -> the student-facing message. */
export function classJoinErrorMessage(err: PgError): string {
	if (err?.code === '42501') return m.student_join_error_not_allowed();
	switch (err?.hint) {
		case 'join_code_invalid':
			return m.student_join_error_invalid();
		case 'join_already_pending':
			return m.student_join_error_already_pending();
		case 'join_limit':
			return m.student_join_error_limit({ max: MAX_PENDING_JOIN_REQUESTS });
	}
	return m.student_join_error_failed();
}

/** A dismiss_class_join refusal -> the student-facing message. */
export function classJoinDismissErrorMessage(err: PgError): string {
	if (err?.hint === 'join_not_rejected') return m.student_join_error_not_rejected();
	return m.student_join_error_dismiss_failed();
}

/** A decide_class_join refusal -> the teacher / admin message (B12b's /requests). */
export function classJoinDecisionErrorMessage(err: PgError): string {
	if (err?.code === '42501') return m.class_join_error_not_allowed();
	switch (err?.hint) {
		case 'join_not_pending':
			return m.class_join_error_not_pending();
		case 'join_decision_invalid':
			return m.class_join_error_decision_invalid();
		case 'join_student_not_approved':
			return m.class_join_error_student_not_approved();
	}
	return m.class_join_error_failed();
}

export type StudentJoinRequest = {
	id: string;
	className: string;
	status: 'pending' | 'rejected';
};

/** B12b (#67): one row of the teacher / admin queue on /requests. */
export type ClassJoinQueueRow = {
	id: string;
	studentId: string;
	studentName: string;
	/** The student's current classes, comma-separated ('' = none). */
	currentClasses: string;
	classId: string;
	className: string;
	requestedAt: string;
	/** The caller is the student's parent: someone else decides (AD-4). */
	ownChild: boolean;
};

type ClassJoinListRow = {
	request_id: string;
	student_id: string;
	student_name: string | null;
	current_classes: string | null;
	current_classes_bo?: string | null;
	current_classes_de?: string | null;
	class_id: string;
	class_name: string;
	class_name_bo?: string | null;
	class_name_de?: string | null;
	requested_at: string;
	own_child: boolean;
};

/**
 * B12b (#67): the pending join requests the caller may see
 * (list_class_join_requests, 0031: the admin all, a teacher their classes),
 * oldest first. A failure only empties this queue and sets joinError.
 */
export async function loadClassJoinRequests(supabase: App.Locals['supabase']) {
	const { data, error } = await supabase.rpc('list_class_join_requests');
	return {
		joinPending: ((data ?? []) as ClassJoinListRow[]).map((r): ClassJoinQueueRow => ({
			id: r.request_id,
			studentId: r.student_id,
			studentName: r.student_name || m.requests_join_unnamed_student(),
			currentClasses: pickLocalized(
				r.current_classes ?? '',
				r.current_classes_bo,
				r.current_classes_de
			),
			classId: r.class_id,
			className: pickLocalized(r.class_name, r.class_name_bo, r.class_name_de),
			requestedAt: r.requested_at,
			ownChild: Boolean(r.own_child)
		})),
		joinError: Boolean(error)
	};
}
