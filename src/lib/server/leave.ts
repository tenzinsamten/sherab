import * as m from '$lib/paraglide/messages.js';
import { toHhMm } from '$lib/server/calendar';

/**
 * Stories 7-4, 7-5: maps a session_leave_history insert or preview_leave
 * refusal to the parent-facing message. RLS / is_parent_of refusals are 42501; the
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
		case 'leave_sick_closed':
			return m.leave_error_sick_closed();
		case 'leave_decided':
			return m.leave_error_decided();
		default:
			return m.leave_error_failed();
	}
}

/**
 * Story 7-5: maps a sick_leave_decisions insert refusal to the teacher /
 * admin message. 42501 = RLS or the trigger's caller check (not their class,
 * or their own child); 23505 = already decided; leave_not_sick = the current
 * answer is no longer Sick.
 */
export function sickDecisionErrorMessage(err: PgError): string {
	if (err?.code === '42501') return m.requests_sick_error_not_allowed();
	if (err?.code === '23505') return m.requests_sick_error_decided();
	if (err?.hint === 'leave_not_sick') return m.requests_sick_error_not_sick();
	return m.requests_sick_error_failed();
}

type SickQueueRow = {
	class_session_id: string;
	student_id: string;
	student_name: string;
	class_name: string;
	day: string;
	start_time: string | null;
	decision: 'approved' | 'rejected' | null;
	decided_at: string | null;
	decided_by_system: boolean;
	own_child: boolean;
};

export type SickRow = {
	sessionId: string;
	studentId: string;
	studentName: string;
	className: string;
	day: string;
	/** `HH:MM`, null = no time set. */
	startTime: string | null;
	decision: 'approved' | 'rejected' | null;
	decidedAt: string | null;
	decidedBySystem: boolean;
	/** The viewer is the student's parent: never decision controls (AD-4). */
	ownChild: boolean;
};

/** How many decided Sick rows the DECIDED history shows. */
const SICK_DECIDED_LIMIT = 50;

function toSick(r: SickQueueRow): SickRow {
	return {
		sessionId: r.class_session_id,
		studentId: r.student_id,
		studentName: r.student_name,
		className: r.class_name,
		day: r.day,
		startTime: r.start_time ? toHhMm(r.start_time) : null,
		decision: r.decision,
		decidedAt: r.decided_at,
		decidedBySystem: r.decided_by_system,
		ownChild: r.own_child
	};
}

/**
 * Story 7-5: the Sick leave queue -- sick_leave_queue() returns the current
 * Sick answers of the caller's classes (every class for the admin). Pending
 * rows first by session; decided rows newest decision first.
 */
export async function loadSickLeave(supabase: App.Locals['supabase']) {
	const { data, error: rpcError } = await supabase.rpc('sick_leave_queue');
	const rows = ((data ?? []) as SickQueueRow[]).map(toSick);
	return {
		sickPending: rows.filter((r) => r.decision === null),
		sickDecided: rows
			.filter((r) => r.decision !== null)
			.sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
			.slice(0, SICK_DECIDED_LIMIT),
		sickError: Boolean(rpcError)
	};
}
