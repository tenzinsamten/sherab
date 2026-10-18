import * as m from '$lib/paraglide/messages.js';
import { pickLocalized } from '$lib/localized-name';
import { toHhMm } from '$lib/server/calendar';
import { todayInBerlin } from '$lib/berlin-date';
import { studentDisplayName } from '$lib/server/enrollments';
import { addDays } from '$lib/server/student-homework';

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
 * B11 (#57): maps a preview_leave_range / set_leave_range refusal. 42501 =
 * not the child's approved parent; leave_range_invalid = the period's
 * limits (from today on, to on or after from, at most 182 days).
 */
export function leaveRangeErrorMessage(err: PgError): string {
	if (err?.code === '42501') return m.leave_error_not_allowed();
	if (err?.hint === 'leave_range_invalid') return m.leave_range_error_invalid();
	return m.leave_range_error_failed();
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
	class_name_bo?: string | null;
	class_name_de?: string | null;
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
		className: pickLocalized(r.class_name, r.class_name_bo, r.class_name_de),
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

export type UpcomingLeaveRow = {
	sessionId: string;
	studentId: string;
	studentName: string;
	className: string;
	day: string;
	/** `HH:MM`, null = no time set. */
	startTime: string | null;
	classification: 'planned' | 'short_notice' | null;
};

/** #107: how far ahead the upcoming On leave list looks (as the parent's leave page). */
const UPCOMING_LEAVE_DAYS = 12 * 7;

/** Leave rows per request: PostgREST max_rows (supabase/config.toml). */
const LEAVE_PAGE_SIZE = 1000;

/**
 * #107: the current On leave answers on the sessions from today through the
 * next 12 weeks of the caller's classes (every class for the admin), for the
 * list on /requests. A list only: On leave needs no decision. RLS
 * (session_leave_history_select) lets a teacher read their classes' rows; the
 * class filter keeps a teacher-parent's own child in another class out.
 * Cancelled sessions are left out. Ordered by session, then student name.
 */
export async function loadUpcomingLeave(
	supabase: App.Locals['supabase'],
	userId: string,
	isAdmin: boolean
): Promise<{ upcomingLeave: UpcomingLeaveRow[]; upcomingLeaveError: boolean }> {
	const failed = { upcomingLeave: [], upcomingLeaveError: true };

	let classIds: string[] | null = null;
	if (!isAdmin) {
		const { data, error } = await supabase
			.from('class_teachers')
			.select('class_id')
			.eq('teacher_id', userId);
		if (error) return failed;
		classIds = (data ?? []).map((r) => r.class_id);
		if (classIds.length === 0) return { upcomingLeave: [], upcomingLeaveError: false };
	}

	// Newest first, paged past max_rows: the first row per (session, student)
	// is the current answer.
	const today = todayInBerlin();
	const current = new Map<
		string,
		{ sessionId: string; studentId: string; answer: string; classification: string | null }
	>();
	for (let from = 0; ; from += LEAVE_PAGE_SIZE) {
		let query = supabase
			.from('session_leave_history')
			.select(
				'class_session_id, student_id, answer, classification, class_sessions!inner(class_id, class_days!inner(day))'
			)
			.gte('class_sessions.class_days.day', today)
			.lte('class_sessions.class_days.day', addDays(today, UPCOMING_LEAVE_DAYS));
		if (classIds) query = query.in('class_sessions.class_id', classIds);
		const { data, error } = await query
			.order('answered_at', { ascending: false })
			.order('id', { ascending: false })
			.range(from, from + LEAVE_PAGE_SIZE - 1);
		if (error) return failed;
		for (const r of data ?? []) {
			const key = `${r.class_session_id}:${r.student_id}`;
			if (!current.has(key)) {
				current.set(key, {
					sessionId: r.class_session_id,
					studentId: r.student_id,
					answer: r.answer,
					classification: r.classification
				});
			}
		}
		if ((data ?? []).length < LEAVE_PAGE_SIZE) break;
	}

	const onLeave = [...current.values()].filter((a) => a.answer === 'on_leave');
	if (onLeave.length === 0) return { upcomingLeave: [], upcomingLeaveError: false };

	const sessionIds = [...new Set(onLeave.map((a) => a.sessionId))];
	const studentIds = [...new Set(onLeave.map((a) => a.studentId))];
	const [sessionsResult, studentsResult] = await Promise.all([
		supabase
			.from('class_sessions_effective')
			.select('id, day, start_time, cancelled, class_name, class_name_bo, class_name_de')
			.in('id', sessionIds),
		supabase.from('profiles').select('id, display_name, registration_name').in('id', studentIds)
	]);
	if (sessionsResult.error || studentsResult.error) return failed;

	const sessions = new Map((sessionsResult.data ?? []).map((s) => [s.id, s]));
	const names = new Map(
		(studentsResult.data ?? []).map((p) => [p.id, studentDisplayName(p)] as const)
	);
	const rows: UpcomingLeaveRow[] = onLeave.flatMap((a) => {
		const s = sessions.get(a.sessionId);
		if (!s?.day || s.cancelled !== false) return [];
		return [
			{
				sessionId: a.sessionId,
				studentId: a.studentId,
				studentName: names.get(a.studentId) ?? a.studentId,
				className: pickLocalized(s.class_name ?? '', s.class_name_bo, s.class_name_de),
				day: s.day,
				startTime: s.start_time ? toHhMm(s.start_time) : null,
				classification:
					a.classification === 'planned' || a.classification === 'short_notice'
						? a.classification
						: null
			}
		];
	});
	rows.sort(
		(a, b) =>
			a.day.localeCompare(b.day) ||
			(a.startTime ?? '').localeCompare(b.startTime ?? '') ||
			a.className.localeCompare(b.className) ||
			a.studentName.localeCompare(b.studentName)
	);
	return { upcomingLeave: rows, upcomingLeaveError: false };
}
