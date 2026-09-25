import { redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import {
	groupByClass,
	loadStudentClasses,
	loadStudentHomework,
	markHomeworkDone,
	STUDENT_FILTERS,
	type StudentFilter
} from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

/**
 * The student's homework (#43): To do / Done grouped by class (#42). Each
 * row opens /student/homework/[instanceId]. Streak and badges moved to
 * /account (#44).
 */
export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	// This route is student-facing only (Code Map) -- a non-student who
	// somehow lands here (e.g. a stale bookmark) is sent home rather than
	// shown an empty homework list. RLS would return nothing useful to them
	// here regardless, so this is UX-only, not the real barrier (AD-2).
	if (!profile || profile.role !== 'student') {
		throw redirect(303, '/');
	}

	const filterParam = url.searchParams.get('filter');
	const filter: StudentFilter = STUDENT_FILTERS.includes(filterParam as StudentFilter)
		? (filterParam as StudentFilter)
		: 'todo';
	const pageParam = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const today = new Date().toISOString().slice(0, 10);

	const { classes, error: classesError } = await loadStudentClasses(supabase, user.id);

	const homework = await loadStudentHomework(supabase, user.id, {
		filter,
		page: Number.isFinite(pageParam) ? pageParam : 1,
		enrolledClassIds: new Set(classes.map((c) => c.id)),
		today
	});

	return {
		filter,
		classes,
		// Grouped by class (#42): on To do every class shows, even with
		// nothing due; on Done only classes with finished homework on this
		// page, including one the student has since left.
		groups: groupByClass(homework.items, classes, {
			includeEmpty: filter === 'todo',
			formerLabel: m.student_class_former()
		}),
		counts: homework.counts,
		page: homework.page,
		pageCount: homework.pageCount,
		loadError: Boolean(classesError || homework.error)
	};
};

export const actions: Actions = {
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return markHomeworkDone({ request, supabase, user });
	}
};
