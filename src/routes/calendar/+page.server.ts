import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { localizedName } from '$lib/localized-name';
import { currentBerlinMonth, todayInBerlin } from '$lib/berlin-date';
import {
	isIsoDate,
	monthBounds,
	parseDurationInput,
	parseMonth,
	parseScheduleInput,
	parseTimeInput,
	scheduleErrorMessages,
	scheduleFormValues,
	shapeMonth,
	shiftMonth,
	toHhMm,
	weeklyDates
} from '$lib/server/calendar';
import type { Actions, PageServerLoad } from './$types';

/** A class the caller may edit, with its schedule (Story 6-4). */
export type ClassSchedule = {
	id: string;
	name: string;
	/** ISO weekdays 1 = Mon .. 7 = Sun. */
	weekdays: number[];
	startTime: string | null;
	durationMinutes: number | null;
	startsOn: string;
	endsOn: string | null;
	/** Repeat every N weeks (1-4, issue #51). */
	intervalWeeks: number;
};

/** A session's leave answer as the student sees it (Story 7-4). */
export type LeaveAnswer = 'coming' | 'on_leave' | 'sick';

/** A linked, approved child in the parent's calendar picker (#58). */
export type CalendarChild = { id: string; name: string };

/** One enrolled child's current answer on a session, for a parent (#58). */
export type ChildSessionAnswer = { childId: string; name: string; answer: LeaveAnswer | null };

/** Postgres error codes the schedule / extra-session functions raise. */
const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
/** class_days guards (0052, #105): the day or target date is not after today (Berlin). */
const CLASS_DAY_NOT_FUTURE = 'CD001';
/** class_days_guard_delete (0052): a session has attendance, answers or a sick-leave decision. */
const CLASS_DAY_TOUCHED = 'CD002';

/**
 * Calendar (Stories 6-1, 6-4): one month's class days and sessions, for every
 * signed-in role. RLS is the real barrier: class days are readable by
 * everyone, sessions only for the admin, the class's teachers and its
 * enrolled students. `role` here only decides which edit controls render.
 */
export const load: PageServerLoad = async ({
	url,
	parent,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}
	// B13 (#68): the view follows the active role, so a teacher-parent with
	// Parent active gets the parent (children) view. activeRole is always a
	// role the login holds (parent only when approved); RLS still decides
	// what each query returns.
	const { profile, activeRole } = await parent();
	const role = activeRole ?? profile?.role ?? null;

	// One clock read, so today and the current month agree at a month end.
	const now = new Date();
	const today = todayInBerlin(now);
	const currentMonth = currentBerlinMonth(now);
	const month = parseMonth(url.searchParams.get('month'), currentMonth);
	const { first, last } = monthBounds(month);
	const canEdit = role === 'admin' || role === 'teacher';

	// #104h (CAP-4): the student and parent reads start in the same batch as
	// days and sessions. They filter by what is known up front (the caller's
	// id and the month) instead of by ids from an earlier read; the results
	// are joined in code below.
	const [daysResult, sessionsResult, classesResult, studentAnswersResult, parentReads] =
		await Promise.all([
			supabase
				.from('class_days')
				.select('id, day, cancelled')
				.gte('day', first)
				.lte('day', last)
				.order('day'),
			supabase
				.from('class_sessions_effective')
				.select(
					'id, class_id, class_name, class_name_bo, class_name_de, class_day_id, start_time, duration_minutes, start_time_override, duration_minutes_override, session_cancelled, day_cancelled, extra'
				)
				.gte('day', first)
				.lte('day', last),
			canEdit
				? supabase
						.from('classes')
						.select(
							'id, name, name_bo, name_de, default_start_time, default_duration_minutes, schedule_weekdays, schedule_starts_on, schedule_ends_on, schedule_interval_weeks'
						)
						.order('name')
				: Promise.resolve({ data: [], error: null }),
			// Story 7-4: a student's own answers on this month's sessions. RLS
			// (session_leave_history_select) lets a student read only their own rows.
			role === 'student'
				? supabase
						.from('session_leave_history')
						.select('class_session_id, answer, class_sessions!inner(class_days!inner(day))')
						.eq('student_id', user.id)
						.gte('class_sessions.class_days.day', first)
						.lte('class_sessions.class_days.day', last)
						.order('answered_at', { ascending: false })
						.order('id', { ascending: false })
				: null,
			role === 'parent' ? readParentView(supabase, user.id, first, last) : null
		]);

	// #58: a parent (a parent-only login, or B13 a staff login with Parent
	// active) sees the sessions of their approved children's classes (RLS
	// is_parent_in_class lets them read those), optionally narrowed to one
	// child, with each enrolled child's current answer.
	let sessionRows = sessionsResult.data ?? [];
	let children: CalendarChild[] = [];
	let selectedChild: string | null = null;
	const childAnswers: Record<string, ChildSessionAnswer[]> = {};
	let parentError = false;
	if (parentReads) {
		const parentView = shapeParentView(parentReads, url.searchParams.get('child'), sessionRows);
		children = parentView.children;
		selectedChild = parentView.selectedChild;
		sessionRows = parentView.sessionRows;
		Object.assign(childAnswers, parentView.childAnswers);
		parentError = parentView.error;
	}

	// Story 7-4: a student's own current answer per session, read-only. Only
	// sessions the month shows count, and a failed answers read counts only
	// when the month shows at least one session.
	const leaveAnswers: Record<string, LeaveAnswer> = {};
	let leaveError = false;
	const monthSessionIds = new Set(sessionRows.flatMap((r) => (r.id ? [r.id] : [])));
	if (studentAnswersResult && monthSessionIds.size > 0) {
		leaveError = Boolean(studentAnswersResult.error);
		// Newest first: the first row per session is the current answer.
		for (const a of studentAnswersResult.data ?? []) {
			if (!monthSessionIds.has(a.class_session_id)) continue;
			leaveAnswers[a.class_session_id] ??= a.answer;
		}
	}

	// RLS scopes this to every class for the admin and the assigned classes
	// for a teacher: exactly the classes the caller may edit.
	const classSchedules: ClassSchedule[] = (classesResult.data ?? [])
		.map((c) => ({
			id: c.id,
			name: localizedName(c),
			weekdays: [...(c.schedule_weekdays ?? [])].sort((a, b) => a - b),
			startTime: c.default_start_time ? toHhMm(c.default_start_time) : null,
			durationMinutes: c.default_duration_minutes,
			startsOn: c.schedule_starts_on,
			endsOn: c.schedule_ends_on,
			intervalWeeks: c.schedule_interval_weeks
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		role,
		canEdit,
		isAdmin: role === 'admin',
		month,
		currentMonth,
		prevMonth: shiftMonth(month, -1),
		nextMonth: shiftMonth(month, 1),
		today,
		days: shapeMonth(daysResult.data ?? [], sessionRows, today),
		classSchedules,
		leaveAnswers,
		children,
		selectedChild,
		childAnswers,
		loadError: Boolean(
			daysResult.error || sessionsResult.error || classesResult.error || leaveError || parentError
		)
	};
};

type SupabaseClient = App.Locals['supabase'];
type SessionRow = {
	id: string | null;
	class_id: string | null;
	session_cancelled: boolean | null;
	day_cancelled: boolean | null;
};

/**
 * The parent branch's reads (#58, #104h), all started at once: children from
 * linked_children(), the enrollments of the caller's children, and their
 * answers on this month's sessions (embedded class_days.day in the month).
 * spec-second-parent story 2: "the caller's children" is the caller's own
 * active student_parents link (embedded, removed_at null), never
 * registered_by_parent_id, so a slot-2 parent sees the same as slot 1.
 */
const OWN_LINK = 'student_parents!student_parents_student_id_fkey!inner(parent_id)';

function readParentView(supabase: SupabaseClient, userId: string, first: string, last: string) {
	return Promise.all([
		supabase.rpc('linked_children'),
		supabase
			.from('class_enrollments')
			.select(
				`class_id, student_id, student:profiles!class_enrollments_student_id_fkey!inner(${OWN_LINK})`
			)
			.eq('student.student_parents.parent_id', userId)
			.is('student.student_parents.removed_at', null),
		supabase
			.from('session_leave_history')
			.select(
				`class_session_id, student_id, answer, class_sessions!inner(class_days!inner(day)), student:profiles!session_leave_history_student_id_fkey!inner(${OWN_LINK})`
			)
			.eq('student.student_parents.parent_id', userId)
			.is('student.student_parents.removed_at', null)
			.gte('class_sessions.class_days.day', first)
			.lte('class_sessions.class_days.day', last)
			.order('answered_at', { ascending: false })
			.order('id', { ascending: false })
	]);
}

/**
 * The parent branch of the calendar load (#58), shaped from readParentView's
 * results. Only approved children count (linked_children() also returns
 * pending ones); enrollments and answers are kept only for the children in
 * view, so a teacher-parent's wider RLS reach never shows. `?child=` narrows
 * the view when it names an approved child; anything else is the
 * all-children view. Sessions of classes no child in view is enrolled in are
 * dropped, so a pending child's classes never show. The current answer per
 * (session, child) is the newest row. A failed linked_children read always
 * counts; a failed enrollments read counts only when a child is in view; a
 * failed answers read counts only when at least one session is shown.
 */
function shapeParentView<T extends SessionRow>(
	[linkedResult, enrollResult, answersResult]: Awaited<ReturnType<typeof readParentView>>,
	childParam: string | null,
	rows: T[]
): {
	children: CalendarChild[];
	selectedChild: string | null;
	sessionRows: T[];
	childAnswers: Record<string, ChildSessionAnswer[]>;
	error: boolean;
} {
	const linkedError = Boolean(linkedResult.error);
	const children: CalendarChild[] = (linkedResult.data ?? [])
		.filter((c) => c.status === 'approved')
		.map((c) => ({ id: c.id, name: c.name }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const selectedChild = children.some((c) => c.id === childParam) ? childParam : null;
	const inView = selectedChild ? children.filter((c) => c.id === selectedChild) : children;
	const childAnswers: Record<string, ChildSessionAnswer[]> = {};
	if (inView.length === 0) {
		return { children, selectedChild, sessionRows: [], childAnswers, error: linkedError };
	}

	const enrollError = Boolean(enrollResult.error);
	const childrenByClass = new Map<string, CalendarChild[]>();
	for (const child of inView) {
		for (const e of enrollResult.data ?? []) {
			if (e.student_id !== child.id) continue;
			const list = childrenByClass.get(e.class_id) ?? [];
			if (!list.some((c) => c.id === child.id)) list.push(child);
			childrenByClass.set(e.class_id, list);
		}
	}

	const sessionRows = rows.filter((r) => r.class_id !== null && childrenByClass.has(r.class_id));
	const sessionIds = new Set(sessionRows.flatMap((r) => (r.id ? [r.id] : [])));
	const childIds = new Set(inView.map((c) => c.id));

	const current = new Map<string, LeaveAnswer>();
	let answersError = false;
	if (sessionIds.size > 0) {
		answersError = Boolean(answersResult.error);
		// Newest first: the first row per (session, child) is the current answer.
		for (const a of answersResult.data ?? []) {
			if (!childIds.has(a.student_id) || !sessionIds.has(a.class_session_id)) continue;
			const key = `${a.class_session_id}:${a.student_id}`;
			if (!current.has(key)) current.set(key, a.answer);
		}
	}

	for (const row of sessionRows) {
		// A cancelled session lists no answers.
		if (!row.id || !row.class_id || row.session_cancelled || row.day_cancelled) continue;
		const sessionId = row.id;
		childAnswers[sessionId] = (childrenByClass.get(row.class_id) ?? []).map((c) => ({
			childId: c.id,
			name: c.name,
			answer: current.get(`${sessionId}:${c.id}`) ?? null
		}));
	}

	return {
		children,
		selectedChild,
		sessionRows,
		childAnswers,
		error: linkedError || enrollError || answersError
	};
}

function isTrue(value: FormDataEntryValue | null): boolean {
	return value === 'true';
}

export const actions: Actions = {
	/** Admin: start date + weekly until end date. Existing dates are skipped, not errors. */
	addClassDays: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		// UX gate only (RLS class_days_insert_admin is the real barrier): a
		// non-admin gets the generic error before any date handling.
		const { data: profile } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.maybeSingle();
		if (profile?.role !== 'admin') return fail(403, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const start = String(formData.get('startDate') ?? '').trim();
		const endRaw = String(formData.get('endDate') ?? '').trim();
		const end = endRaw === '' ? start : endRaw;

		const range = weeklyDates(start, end);
		if (!range.ok) {
			const addDaysError =
				range.problem === 'order'
					? m.calendar_error_end_before_start()
					: range.problem === 'range'
						? m.calendar_error_range_too_long()
						: m.calendar_error_date_invalid();
			return fail(400, { addDaysError, startDate: start, endDate: endRaw });
		}

		// ignoreDuplicates = ON CONFLICT DO NOTHING: the returned rows are the
		// newly added days only.
		const { data, error } = await supabase
			.from('class_days')
			.upsert(
				range.dates.map((day) => ({ day })),
				{ onConflict: 'day', ignoreDuplicates: true }
			)
			.select('day');

		if (error) return fail(400, { error: m.calendar_error_failed() });

		const added = data?.length ?? 0;
		return {
			success: true,
			action: 'daysAdded' as const,
			added,
			existed: range.dates.length - added
		};
	},

	/** Admin: soft-cancel or restore a whole class day. */
	setClassDayCancelled: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const dayId = String(formData.get('dayId') ?? '');
		const cancelled = isTrue(formData.get('cancelled'));

		// .select() + row check: RLS turns a forbidden update into zero rows.
		const { data, error } = await supabase
			.from('class_days')
			.update({ cancelled })
			.eq('id', dayId)
			.select('id');
		if (error || !data || data.length === 0) {
			return fail(400, { error: m.calendar_error_failed() });
		}
		return {
			success: true,
			action: cancelled ? ('dayCancelled' as const) : ('dayRestored' as const)
		};
	},

	/**
	 * Admin (#105): move a future class day to another free future date. Its
	 * sessions and their answers follow through class_day_id. The database
	 * enforces every rule (class_days_guard_move, class_days_day_unique, RLS).
	 */
	moveClassDay: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const dayId = String(formData.get('dayId') ?? '');
		const newDate = String(formData.get('newDate') ?? '').trim();
		if (!dayId) return fail(400, { error: m.calendar_error_failed() });
		if (!isIsoDate(newDate)) return fail(400, { error: m.calendar_error_date_invalid() });

		// The database accepts a no-op move; tell the admin instead.
		const { data: current, error: readError } = await supabase
			.from('class_days')
			.select('day')
			.eq('id', dayId)
			.maybeSingle();
		if (readError || !current) return fail(400, { error: m.calendar_error_failed() });
		if (current.day === newDate) return fail(400, { error: m.calendar_error_move_same_date() });

		const { data, error } = await supabase
			.from('class_days')
			.update({ day: newDate })
			.eq('id', dayId)
			.select('id');
		if (error) {
			const message =
				error.code === CLASS_DAY_NOT_FUTURE
					? m.calendar_error_move_not_future()
					: error.code === UNIQUE_VIOLATION
						? m.calendar_error_day_taken()
						: m.calendar_error_failed();
			return fail(400, { error: message });
		}
		// RLS turns a non-admin's update into zero rows.
		if (!data || data.length === 0) return fail(400, { error: m.calendar_error_failed() });
		return { success: true, action: 'dayMoved' as const, date: newDate };
	},

	/**
	 * Admin (#105): delete a future class day nothing references, with its
	 * sessions. class_days_guard_delete refuses today, the past and a day
	 * with attendance, answers or sick-leave decisions.
	 */
	deleteClassDay: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const dayId = String(formData.get('dayId') ?? '');
		if (!dayId) return fail(400, { error: m.calendar_error_failed() });

		const { data, error } = await supabase.from('class_days').delete().eq('id', dayId).select('id');
		if (error) {
			const message =
				error.code === CLASS_DAY_NOT_FUTURE
					? m.calendar_error_delete_not_future()
					: error.code === CLASS_DAY_TOUCHED
						? m.calendar_error_day_has_answers()
						: m.calendar_error_failed();
			return fail(400, { error: message });
		}
		// RLS turns a non-admin's delete into zero rows.
		if (!data || data.length === 0) return fail(400, { error: m.calendar_error_failed() });
		return { success: true, action: 'dayDeleted' as const };
	},

	/**
	 * Admin or a teacher of the class: the class's schedule (weekdays, repeat
	 * interval, time, duration, from, until). The function regenerates sessions from today
	 * (Berlin) on; earlier sessions are never changed.
	 */
	setClassSchedule: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const classId = String(formData.get('classId') ?? '');
		const parsed = parseScheduleInput(scheduleFormValues(formData));
		if (!parsed.ok) {
			return fail(400, { scheduleErrors: scheduleErrorMessages(parsed.errors), classId });
		}

		const { weekdays, startTime, durationMinutes, startsOn, endsOn, intervalWeeks } = parsed.value;
		const { error } = await supabase.rpc('set_class_schedule', {
			p_class_id: classId,
			p_weekdays: weekdays,
			p_start_time: startTime,
			p_duration_minutes: durationMinutes,
			p_starts_on: startsOn,
			p_ends_on: endsOn,
			p_interval_weeks: intervalWeeks
		});
		// 42501 (not a teacher of the class), P0002 (no such class) or a
		// check violation: the generic message, never the raw Postgres text.
		if (error) return fail(400, { error: m.calendar_error_failed() });

		return { success: true, action: 'scheduleSaved' as const };
	},

	/**
	 * Admin or a teacher of the class: a one-off session on a class day
	 * outside the class's schedule. Empty time / duration = the class's.
	 */
	addExtraSession: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const classId = String(formData.get('classId') ?? '').trim();
		const dayId = String(formData.get('dayId') ?? '').trim();
		const startTime = parseTimeInput(String(formData.get('startTime') ?? ''));
		const duration = parseDurationInput(String(formData.get('durationMinutes') ?? ''));
		if (!classId || !dayId || !startTime.ok || !duration.ok) {
			return fail(400, {
				extraError: !classId
					? m.calendar_error_class_required()
					: !dayId
						? m.calendar_error_failed()
						: !startTime.ok
							? m.calendar_error_time_invalid()
							: m.calendar_error_duration_invalid(),
				dayId
			});
		}

		const { error } = await supabase.rpc('add_extra_session', {
			p_class_id: classId,
			p_class_day_id: dayId,
			p_start_time: startTime.value,
			p_duration_minutes: duration.value
		});
		if (error) {
			return fail(error.code === INSUFFICIENT_PRIVILEGE ? 403 : 400, {
				extraError:
					error.code === UNIQUE_VIOLATION
						? m.calendar_error_extra_exists()
						: m.calendar_error_failed(),
				dayId
			});
		}

		return { success: true, action: 'extraAdded' as const };
	},

	/** Admin or a teacher of the class: one session's overrides. Empty = follow the class default. */
	updateSession: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const sessionId = String(formData.get('sessionId') ?? '');
		const startTime = parseTimeInput(String(formData.get('startTime') ?? ''));
		const duration = parseDurationInput(String(formData.get('durationMinutes') ?? ''));
		if (!startTime.ok || !duration.ok) {
			return fail(400, {
				sessionError: !startTime.ok
					? m.calendar_error_time_invalid()
					: m.calendar_error_duration_invalid(),
				sessionId
			});
		}

		// Only this row's override columns: never the class default or another
		// session. updated_by / updated_at are stamped by a trigger.
		const { data, error } = await supabase
			.from('class_sessions')
			.update({
				start_time_override: startTime.value,
				duration_minutes_override: duration.value
			})
			.eq('id', sessionId)
			.select('id');
		if (error || !data || data.length === 0) {
			return fail(400, { error: m.calendar_error_failed() });
		}
		return { success: true, action: 'sessionSaved' as const };
	},

	/** Admin or a teacher of the class: cancel or restore one session. */
	setSessionCancelled: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const sessionId = String(formData.get('sessionId') ?? '');
		const cancelled = isTrue(formData.get('cancelled'));

		const { data, error } = await supabase
			.from('class_sessions')
			.update({ cancelled })
			.eq('id', sessionId)
			.select('id');
		if (error || !data || data.length === 0) {
			return fail(400, { error: m.calendar_error_failed() });
		}
		return {
			success: true,
			action: cancelled ? ('sessionCancelled' as const) : ('sessionRestored' as const)
		};
	}
};
