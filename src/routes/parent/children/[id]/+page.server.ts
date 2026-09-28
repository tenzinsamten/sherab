import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { shapeStudentBadges, type StudentBadge } from '$lib/server/badges';
import { toHhMm } from '$lib/server/calendar';
import { shapeTeamLeaderboard, type TeamRank } from '$lib/server/leaderboard';
import { leaveErrorMessage } from '$lib/server/leave';
import { pickCurrentSkillStatuses, type SkillHistoryRow } from '$lib/server/skill-status';
import { shapeStudentStreak, type StudentStreak } from '$lib/server/streak';
import {
	addDays,
	loadClassPeople,
	loadStudentHomework,
	teamRank,
	type ClassPerson,
	type StudentHomeworkItem,
	type TeamStanding
} from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

export type LeaveAnswer = 'coming' | 'on_leave' | 'sick';
export type LeaveClassification = 'planned' | 'short_notice';
export type SickDecision = 'approved' | 'rejected';
/** Story 7-6: the latest deletion request for the child (no withdrawal; a rejected one can be followed by a new one). */
export type DeletionStatus = 'pending' | 'rejected';

export type ChildSession = {
	id: string;
	day: string;
	className: string;
	/** `HH:MM`, null = no time set (the session then starts at 00:00). */
	startTime: string | null;
	durationMinutes: number | null;
	/** Coming / On leave can still be set: the session has not started (DB instant). */
	open: boolean;
	answer: LeaveAnswer | null;
	classification: LeaveClassification | null;
	/** Story 7-5: the decision on this session's Sick. Once set, the answers are locked. */
	decision: SickDecision | null;
	/**
	 * Story 7-5 (decision 2): Sick can be offered -- the session is dated
	 * yesterday or today (Berlin), so still inside the database's Sick window
	 * (until the end of the day after), and nothing has been decided.
	 */
	sickOpen: boolean;
};

/** How far ahead the leave page lists sessions. */
const LEAVE_WINDOW_DAYS = 12 * 7;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The child page's tabs (decision 1); anything else shows Overview. */
const CHILD_TABS = ['overview', 'homework', 'sessions', 'record'] as const;
export type ChildTab = (typeof CHILD_TABS)[number];

function readTab(value: string | null): ChildTab {
	return CHILD_TABS.find((t) => t === value) ?? 'overview';
}

/** `?done=` page number: a positive integer, anything else is page 1. */
function readPage(value: string | null): number {
	if (!value || !/^\d{1,6}$/.test(value)) return 1;
	return Math.max(1, Number(value));
}

/** A homework row on the parent page (read-only): the item plus its class name. */
export type ChildHomeworkItem = Pick<
	StudentHomeworkItem,
	'instanceId' | 'title' | 'dueDate' | 'status' | 'overdue' | 'referenceLinks'
> & { className: string | null };

export type ChildAttendance = {
	sessionDate: string;
	classId: string;
	className: string;
	present: boolean;
};

export type ChildSkillClass = {
	classId: string;
	/** null: a class the child has left (its name is no longer readable). */
	className: string | null;
	/** Current level per skill area (latest row). */
	current: Record<string, SkillHistoryRow>;
	/** Full history, newest first, with the teacher's notes. */
	history: SkillHistoryRow[];
};

export type ChildClassTeachers = { classId: string; className: string; teachers: ClassPerson[] };

/** Per-section load failures: a failing section shows its own error line. */
export type ChildSectionErrors = {
	summary: boolean;
	team: boolean;
	open: boolean;
	done: boolean;
	attendance: boolean;
	skills: boolean;
	teachers: boolean;
};

/**
 * Stories 7-4, 7-5: one approved child's non-cancelled sessions from
 * yesterday (Berlin) through the next 12 weeks, each with its current leave
 * answer and the decision on a Sick answer. The child must be
 * one of the caller's approved children (linked_children(), the same rule as
 * is_parent_of); anything else is a 404. RLS (is_parent_in_class,
 * is_parent_of) is the real barrier for every read.
 *
 * Since the detail-page follow-up (deferred from 7-3) it also reads the
 * child's summary, homework, attendance, skills, teachers and the team
 * leaderboard, each with the child's explicit id and its own error flag.
 * Every section is read whatever the tab, so switching tabs never shows a
 * stale error.
 */
export const load: PageServerLoad = async ({ params, url, parent, locals: { supabase } }) => {
	const { parentStatus } = await parent();
	if (parentStatus !== 'approved' || !UUID_PATTERN.test(params.id)) {
		throw error(404, 'Not found');
	}

	const { data: linked } = await supabase.rpc('linked_children');
	const child = (linked ?? []).find((c) => c.id === params.id && c.status === 'approved');
	if (!child) {
		throw error(404, 'Not found');
	}

	const { data: enrollments, error: enrollmentsError } = await supabase
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', child.id);
	const classIds = (enrollments ?? []).map((e) => e.class_id);

	let sessions: ChildSession[] = [];
	let loadError = Boolean(enrollmentsError);

	if (classIds.length > 0) {
		const today = todayInBerlin();
		const yesterday = addDays(today, -1);
		const { data: rows, error: sessionsError } = await supabase
			.from('class_sessions_effective')
			.select('id, day, class_name, start_time, duration_minutes, starts_at')
			.in('class_id', classIds)
			.eq('cancelled', false)
			.gte('day', yesterday)
			.lte('day', addDays(today, LEAVE_WINDOW_DAYS))
			.order('day')
			.order('start_time', { nullsFirst: true });
		if (sessionsError) loadError = true;

		const sessionIds = (rows ?? []).flatMap((r) => (r.id ? [r.id] : []));
		const current = new Map<
			string,
			{ answer: LeaveAnswer; classification: LeaveClassification | null }
		>();
		const decisions = new Map<string, SickDecision>();
		if (sessionIds.length > 0) {
			const [{ data: answers, error: answersError }, { data: decided, error: decidedError }] =
				await Promise.all([
					supabase
						.from('session_leave_history')
						.select('class_session_id, answer, classification')
						.eq('student_id', child.id)
						.in('class_session_id', sessionIds)
						.order('answered_at', { ascending: false })
						.order('id', { ascending: false }),
					supabase
						.from('sick_leave_decisions')
						.select('class_session_id, decision')
						.eq('student_id', child.id)
						.in('class_session_id', sessionIds)
				]);
			if (answersError || decidedError) loadError = true;
			for (const d of decided ?? []) decisions.set(d.class_session_id, d.decision);
			// Newest first: the first row per session is the current answer.
			for (const a of answers ?? []) {
				if (!current.has(a.class_session_id)) {
					current.set(a.class_session_id, {
						answer: a.answer,
						classification: a.classification
					});
				}
			}
		}

		const now = Date.now();
		sessions = (rows ?? []).flatMap((r) =>
			r.id && r.day
				? [
						{
							id: r.id,
							day: r.day,
							className: r.class_name ?? '',
							startTime: r.start_time ? toHhMm(r.start_time) : null,
							durationMinutes: r.duration_minutes,
							open: r.starts_at ? Date.parse(r.starts_at) > now : false,
							answer: current.get(r.id)?.answer ?? null,
							classification: current.get(r.id)?.classification ?? null,
							decision: decisions.get(r.id) ?? null,
							sickOpen: r.day >= yesterday && r.day <= today && !decisions.has(r.id)
						}
					]
				: []
		);
	}

	// Story 7-6: the latest deletion request (RLS: the requester / parent).
	// An approved one erases the child, so the page is gone by then.
	const { data: requests, error: requestsError } = await supabase
		.from('deletion_requests')
		.select('status, requested_at')
		.eq('student_id', child.id)
		.order('requested_at', { ascending: false });
	const latest = (requests ?? [])[0];
	const deletion =
		latest && (latest.status === 'pending' || latest.status === 'rejected')
			? { status: latest.status as DeletionStatus, requestedAt: latest.requested_at }
			: null;

	const details = await loadChildDetails(supabase, child.id, classIds, {
		enrollmentsError: Boolean(enrollmentsError),
		donePage: readPage(url.searchParams.get('done'))
	});

	return {
		child: { id: child.id, name: child.name },
		tab: readTab(url.searchParams.get('tab')),
		sessions,
		deletion,
		deletionLoadError: Boolean(requestsError),
		loadError,
		...details
	};
};

type Client = App.Locals['supabase'];

/**
 * The read-only sections for one child. Homework reuses the student's own
 * loader (the same To-do rule and numbers as homework_counts and the /parent
 * card); history is filtered to this child by splitProgress, the skill and
 * streak reads by an explicit student_id.
 */
async function loadChildDetails(
	supabase: Client,
	childId: string,
	classIds: string[],
	opts: { enrollmentsError: boolean; donePage: number }
) {
	const today = todayInBerlin();
	const enrolledClassIds = new Set(classIds);

	const [
		classesResult,
		open,
		done,
		{ data: streakRow, error: streakError },
		{ data: badgeRows, error: badgesError },
		{ data: profileRow, error: profileError },
		{ data: teamRows, error: teamError },
		{ data: attendanceRows, error: attendanceError },
		{ data: skillRows, error: skillError }
	] = await Promise.all([
		classIds.length > 0
			? supabase.from('classes').select('id, name').in('id', classIds)
			: Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
		loadStudentHomework(supabase, childId, { filter: 'todo', page: 1, enrolledClassIds, today }),
		loadStudentHomework(supabase, childId, {
			filter: 'done',
			page: opts.donePage,
			enrolledClassIds,
			today
		}),
		supabase
			.from('student_streaks')
			.select('current_streak, last_qualifying_week')
			.eq('student_id', childId)
			.maybeSingle(),
		supabase
			.from('badges_earned')
			.select('badge_type, milestone, earned_at')
			.eq('student_id', childId)
			.order('badge_type')
			.order('milestone', { ascending: true }),
		supabase.from('profiles').select('team_id').eq('id', childId).maybeSingle(),
		supabase.rpc('team_leaderboard'),
		supabase.rpc('child_attendance', { p_student_id: childId }),
		supabase
			.from('skill_status_history')
			.select('id, student_id, class_id, skill_area, level, notes, recorded_at')
			.eq('student_id', childId)
			// Newest first with an id tiebreak: pickCurrentSkillStatuses keeps
			// the first row per key.
			.order('recorded_at', { ascending: false })
			.order('id', { ascending: false })
	]);

	const classes = (classesResult.data ?? [])
		.filter((c) => enrolledClassIds.has(c.id))
		.sort((a, b) => a.name.localeCompare(b.name));
	const classNames = new Map(classes.map((c) => [c.id, c.name]));
	const classNamesError = opts.enrollmentsError || Boolean(classesResult.error);

	const toChildItem = (item: StudentHomeworkItem): ChildHomeworkItem => ({
		instanceId: item.instanceId,
		title: item.title,
		dueDate: item.dueDate,
		status: item.status,
		overdue: item.overdue,
		referenceLinks: item.referenceLinks,
		className: classNames.get(item.classId) ?? null
	});

	// Skills: grouped per class (enrolled classes first, then any left).
	const history: (SkillHistoryRow & { classId: string })[] = (skillRows ?? [])
		.filter((r) => r.student_id === childId)
		.map((r) => ({
			id: r.id,
			studentId: r.student_id,
			classId: r.class_id,
			skillArea: r.skill_area,
			level: r.level,
			notes: r.notes,
			recordedAt: r.recorded_at
		}));
	const skillClassIds = [
		...classes.map((c) => c.id).filter((id) => history.some((r) => r.classId === id)),
		...Array.from(new Set(history.map((r) => r.classId))).filter((id) => !classNames.has(id))
	];
	const skills: ChildSkillClass[] = skillClassIds.map((classId) => {
		const rows = history.filter((r) => r.classId === classId);
		const current: Record<string, SkillHistoryRow> = {};
		for (const row of Object.values(pickCurrentSkillStatuses(rows))) {
			current[row.skillArea] = row;
		}
		return { classId, className: classNames.get(classId) ?? null, current, history: rows };
	});

	// Teachers per enrolled class (class_people: teachers only for a parent).
	const people = await Promise.all(classes.map((c) => loadClassPeople(supabase, c.id)));
	const teachers: ChildClassTeachers[] = classes.map((c, i) => ({
		classId: c.id,
		className: c.name,
		teachers: people[i].teachers
	}));

	const leaderboard: TeamRank[] = teamError ? [] : shapeTeamLeaderboard(teamRows);
	const teamId = profileRow?.team_id ?? null;
	const team: TeamStanding | null = teamRank(leaderboard, teamId);

	const attendance: ChildAttendance[] = (attendanceRows ?? []).map((r) => ({
		sessionDate: r.session_date,
		classId: r.class_id,
		className: r.class_name,
		present: r.present
	}));

	const streak: StudentStreak | null = shapeStudentStreak(streakRow);
	const badges: StudentBadge[] = shapeStudentBadges(badgeRows);

	const errors: ChildSectionErrors = {
		summary: Boolean(streakError || badgesError),
		team: Boolean(teamError || profileError),
		open: open.error || classNamesError,
		done: done.error || classNamesError,
		attendance: Boolean(attendanceError),
		skills: Boolean(skillError) || classNamesError,
		teachers: classNamesError || people.some((p) => p.error)
	};

	return {
		streak,
		badges,
		team,
		teamId: team ? teamId : null,
		leaderboard,
		homework: {
			open: open.items.map(toChildItem),
			done: done.items.map(toChildItem),
			donePage: done.page,
			donePageCount: done.pageCount
		},
		attendance,
		skills,
		teachers,
		errors
	};
}

async function readSessionId(request: Request) {
	const formData = await request.formData();
	return { formData, sessionId: String(formData.get('sessionId') ?? '') };
}

export const actions: Actions = {
	/** The classification an On leave saved now would get (preview_leave, never computed here). */
	preview: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');

		const { sessionId } = await readSessionId(request);
		if (!UUID_PATTERN.test(sessionId)) {
			return fail(400, { error: m.leave_error_failed(), sessionId });
		}

		const { data, error: rpcError } = await supabase.rpc('preview_leave', {
			p_class_session_id: sessionId,
			p_student_id: params.id
		});
		if (rpcError || (data !== 'planned' && data !== 'short_notice')) {
			return fail(rpcError?.code === '42501' ? 403 : 400, {
				error: leaveErrorMessage(rpcError),
				sessionId
			});
		}
		return { action: 'preview' as const, sessionId, preview: data };
	},

	/**
	 * Appends Coming, On leave or Sick. The database stamps actor, time and
	 * classification, and enforces every cutoff and a decided session's lock.
	 */
	setLeave: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');

		const { formData, sessionId } = await readSessionId(request);
		const answer = String(formData.get('answer') ?? '');
		if (
			!UUID_PATTERN.test(sessionId) ||
			(answer !== 'coming' && answer !== 'on_leave' && answer !== 'sick')
		) {
			return fail(400, { error: m.leave_error_invalid(), sessionId });
		}

		const { data, error: insertError } = await supabase
			.from('session_leave_history')
			.insert({ class_session_id: sessionId, student_id: params.id, answer })
			.select('answer, classification')
			.single();
		if (insertError || !data) {
			return fail(insertError?.code === '42501' ? 403 : 400, {
				error: leaveErrorMessage(insertError),
				sessionId
			});
		}
		return {
			action: 'setLeave' as const,
			success: true,
			sessionId,
			answer: data.answer,
			classification: data.classification
		};
	},

	/**
	 * Story 7-6: submits a deletion request for this child into the admin's
	 * queue. The database stamps requester, time and status, refuses anyone
	 * but the child's approved parent (42501) and a second pending request
	 * (23505). Nothing is erased until the admin approves.
	 */
	requestDeletion: async ({ params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');
		if (!UUID_PATTERN.test(params.id)) {
			return fail(400, { deletionError: m.deletion_error_failed() });
		}

		const { error: insertError } = await supabase
			.from('deletion_requests')
			.insert({ student_id: params.id })
			.select('id')
			.single();
		if (insertError) {
			if (insertError.code === '23505') {
				return fail(400, { deletionError: m.deletion_error_duplicate() });
			}
			if (insertError.code === '42501') {
				return fail(403, { deletionError: m.deletion_error_not_allowed() });
			}
			return fail(400, { deletionError: m.deletion_error_failed() });
		}
		return { action: 'requestDeletion' as const, success: true };
	}
};
