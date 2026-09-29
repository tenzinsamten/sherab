import * as m from '$lib/paraglide/messages.js';

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
