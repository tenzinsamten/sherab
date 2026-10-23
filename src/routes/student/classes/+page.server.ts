import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { localizedName, pickLocalized } from '$lib/localized-name';
import {
	loadClassPeople,
	loadStudentClasses,
	loadStudentHomework
} from '$lib/server/student-homework';
import {
	MAX_JOIN_CODE_LENGTH,
	classJoinDismissErrorMessage,
	classJoinErrorMessage,
	type StudentJoinRequest
} from '$lib/server/class-join';
import type { Actions, PageServerLoad } from './$types';

/**
 * My classes (#46): each class the student is in, its teachers and what's
 * to do, and (#67, moved here from the dashboard by #113) the "Join another
 * class" card with the student's pending / rejected join requests.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const { classes, error: classesError } = await loadStudentClasses(supabase, user.id);
	const today = new Date().toISOString().slice(0, 10);

	// A student has a handful of classes, so one class_people() call each.
	const [homework, people, { data: joinRows, error: joinError }] = await Promise.all([
		loadStudentHomework(supabase, user.id, {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(classes.map((c) => c.id)),
			today
		}),
		Promise.all(classes.map((c) => loadClassPeople(supabase, c.id))),
		// Pending and not-dismissed rejected requests, newest first (0031).
		supabase.rpc('my_class_join_requests')
	]);

	return {
		classes: classes.map((c, i) => ({
			...c,
			teachers: people[i].teachers.map((t) => t.name),
			todo: homework.items.filter((item) => item.classId === c.id).length
		})),
		joinRequests: (joinRows ?? []).map((r): StudentJoinRequest => ({
			id: r.id,
			className: pickLocalized(r.class_name, r.class_name_bo, r.class_name_de),
			status: r.status
		})),
		// Its own flag: the join card says so, the class list stays.
		joinLoadError: Boolean(joinError),
		loadError: Boolean(classesError || homework.error || people.some((p) => p.error))
	};
};

export const actions: Actions = {
	/** #67: ask to join another class by its code (request_class_join, 0031). */
	requestJoin: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { joinError: m.student_homework_error_not_signed_in() });
		}
		const formData = await request.formData();
		const code = String(formData.get('code') ?? '')
			.trim()
			.toUpperCase();

		if (!code) {
			return fail(400, { joinError: m.student_join_error_code_required(), code });
		}
		// Far longer than any class code: the same answer as an unknown one.
		if (code.length > MAX_JOIN_CODE_LENGTH) {
			return fail(400, { joinError: m.student_join_error_invalid(), code });
		}

		const { data: className, error } = await supabase.rpc('request_class_join', { p_code: code });
		if (error) {
			return fail(400, { joinError: classJoinErrorMessage(error), code });
		}
		// request_class_join returns the English name only (0031, kept as is by
		// 0036): the names in every language come from the code lookup.
		const { data: names } = await supabase.rpc('validate_class_code', { p_code: code });
		return { joinSent: names?.[0] ? localizedName(names[0]) : (className ?? code) };
	},

	/** #67: hide a rejected request (dismiss_class_join, 0031). */
	dismissJoin: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { joinError: m.student_homework_error_not_signed_in() });
		}
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		if (!id) {
			return fail(400, { joinError: m.student_join_error_dismiss_failed() });
		}

		const { error } = await supabase.rpc('dismiss_class_join', { p_request_id: id });
		if (error) {
			return fail(400, { joinError: classJoinDismissErrorMessage(error) });
		}
		return { joinDismissed: true };
	}
};
