import * as m from '$lib/paraglide/messages.js';

/**
 * Story 7-4: maps a session_leave_history insert or preview_leave refusal to
 * the parent-facing message. RLS / is_parent_of refusals are 42501; the
 * BEFORE INSERT trigger names its reason in the error hint.
 */
export type PgError = { code?: string; hint?: string | null } | null;

/** A trigger or RLS refusal -> the parent-facing message. */
export function leaveErrorMessage(err: PgError): string {
	if (err?.code === '42501') return m.leave_error_not_allowed();
	switch (err?.hint) {
		case 'leave_started':
			return m.leave_error_started();
		case 'leave_cancelled':
			return m.leave_error_cancelled();
		case 'leave_not_enrolled':
			return m.leave_error_not_allowed();
		default:
			return m.leave_error_failed();
	}
}
