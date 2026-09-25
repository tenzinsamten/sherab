import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { currentBerlinMonth, todayInBerlin } from '$lib/berlin-date';
import {
	monthBounds,
	parseDurationInput,
	parseMonth,
	parseTimeInput,
	shapeMonth,
	shiftMonth,
	toHhMm,
	weeklyDates
} from '$lib/server/calendar';
import type { Actions, PageServerLoad } from './$types';

export type ClassDefault = {
	id: string;
	name: string;
	startTime: string | null;
	durationMinutes: number | null;
};

/**
 * Calendar (Story 6-1): one month's class days and sessions, for every
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
				'id, class_id, class_name, class_day_id, start_time, duration_minutes, start_time_override, duration_minutes_override, session_cancelled, day_cancelled'
			)
			.gte('day', first)
			.lte('day', last),
		canEdit
			? supabase
					.from('classes')
					.select('id, name, default_start_time, default_duration_minutes')
					.order('name')
			: Promise.resolve({ data: [], error: null })
	]);

	const classDefaults: ClassDefault[] = (classesResult.data ?? []).map((c) => ({
		id: c.id,
		name: c.name,
		startTime: c.default_start_time ? toHhMm(c.default_start_time) : null,
		durationMinutes: c.default_duration_minutes
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
		classDefaults,
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

	/** Admin or a teacher of the class: the class's default start time and duration. */
	setClassDefault: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: m.calendar_error_failed() });

		const formData = await request.formData();
		const classId = String(formData.get('classId') ?? '');
		const startTime = parseTimeInput(String(formData.get('startTime') ?? ''));
		const duration = parseDurationInput(String(formData.get('durationMinutes') ?? ''));
		if (!startTime.ok || !duration.ok) {
			return fail(400, {
				defaultError: !startTime.ok
					? m.calendar_error_time_invalid()
					: m.calendar_error_duration_invalid(),
				classId
			});
		}

		const { error } = await supabase.rpc('set_class_default', {
			p_class_id: classId,
			p_start_time: startTime.value,
			p_duration_minutes: duration.value
		});
		if (error) return fail(400, { error: m.calendar_error_failed() });

		return { success: true, action: 'defaultSaved' as const };
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
