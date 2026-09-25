import { redirect } from '@sveltejs/kit';
import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import { listSyllabi, pickStudentSyllabus } from '$lib/server/class-syllabus';
import {
	loadClassPeople,
	loadStudentHomework,
	markHomeworkDone,
	STUDENT_FILTERS,
	type StudentFilter
} from '$lib/server/student-homework';
import { currentSchoolYear } from '$lib/school-year';
import type { Actions, PageServerLoad } from './$types';

/**
 * One of the student's classes (#46): teachers, this year's syllabus, the
 * class's homework (To do / Done) and classmates. RLS
 * (classes_select_own_student, 0016) returns no row for a class the student
 * isn't in, so that's a 404.
 */
export const load: PageServerLoad = async ({
	params,
	url,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const cls = rowOr404(
		await supabase.from('classes').select('id, name').eq('id', params.classId).maybeSingle(),
		CLASS_MESSAGES
	);

	const filterParam = url.searchParams.get('filter');
	const filter: StudentFilter = STUDENT_FILTERS.includes(filterParam as StudentFilter)
		? (filterParam as StudentFilter)
		: 'todo';
	const pageParam = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const today = new Date().toISOString().slice(0, 10);

	const [people, syllabusList, homework] = await Promise.all([
		loadClassPeople(supabase, cls.id),
		listSyllabi(supabase, cls.id),
		loadStudentHomework(supabase, user.id, {
			filter,
			page: Number.isFinite(pageParam) ? pageParam : 1,
			enrolledClassIds: new Set([cls.id]),
			today,
			classId: cls.id
		})
	]);

	return {
		class: cls,
		teachers: people.teachers,
		classmates: people.students.filter((s) => s.id !== user.id),
		syllabus: pickStudentSyllabus(syllabusList.syllabi, currentSchoolYear()),
		filter,
		items: homework.items,
		counts: homework.counts,
		page: homework.page,
		pageCount: homework.pageCount,
		loadError: Boolean(people.error || syllabusList.error || homework.error)
	};
};

export const actions: Actions = {
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return markHomeworkDone({ request, supabase, user });
	}
};
