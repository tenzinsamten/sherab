import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { currentBerlinMonth, todayInBerlin } from '$lib/berlin-date';
import {
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
};

/** Postgres error codes the schedule / extra-session functions raise. */
const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';

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
	const { profile } = await parent();
	const role = profile?.role ?? null;

	// One clock read, so today and the current month agree at a month end.
	const now = new Date();
	const today = todayInBerlin(now);
	const currentMonth = currentBerlinMonth(now);
	const month = parseMonth(url.searchParams.get('month'), currentMonth);
	const { first, last } = monthBounds(month);
	const canEdit = role === 'admin' || role === 'teacher';

	const [daysResult, sessionsResult, classesResult] = await Promise.all([
		supabase
			.from('class_days')
			.select('id, day, cancelled')
			.gte('day', first)
			.lte('day', last)
			.order('day'),
		supabase
			.from('class_sessions_effective')
			.select(
				'id, class_id, class_name, class_day_id, start_time, duration_minutes, start_time_override, duration_minutes_override, session_cancelled, day_cancelled, extra'
			)
			.gte('day', first)
			.lte('day', last),
		canEdit
			? supabase
					.from('classes')
					.select(
						'id, name, default_start_time, default_duration_minutes, schedule_weekdays, schedule_starts_on, schedule_ends_on'
					)
					.order('name')
			: Promise.resolve({ data: [], error: null })
	]);

	// RLS scopes this to every class for the admin and the assigned classes
	// for a teacher: exactly the classes the caller may edit.
	const classSchedules: ClassSchedule[] = (classesResult.data ?? []).map((c) => ({
		id: c.id,
		name: c.name,
		weekdays: [...(c.schedule_weekdays ?? [])].sort((a, b) => a - b),
		startTime: c.default_start_time ? toHhMm(c.default_start_time) : null,
		durationMinutes: c.default_duration_minutes,
		startsOn: c.schedule_starts_on,
		endsOn: c.schedule_ends_on
	}));

	return {
		role,
		canEdit,
		isAdmin: role === 'admin',
		month,
		currentMonth,
		prevMonth: shiftMonth(month, -1),
		nextMonth: shiftMonth(month, 1),
		today,
		days: shapeMonth(daysResult.data ?? [], sessionsResult.data ?? [], today),
		classSchedules,
		loadError: Boolean(daysResult.error || sessionsResult.error || classesResult.error)
	};
};

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
	 * Admin or a teacher of the class: the class's schedule (weekdays, time,
	 * duration, from, until). The function regenerates sessions from today
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

		const { weekdays, startTime, durationMinutes, startsOn, endsOn } = parsed.value;
		const { error } = await supabase.rpc('set_class_schedule', {
			p_class_id: classId,
			p_weekdays: weekdays,
			p_start_time: startTime,
			p_duration_minutes: durationMinutes,
			p_starts_on: startsOn,
			p_ends_on: endsOn
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
