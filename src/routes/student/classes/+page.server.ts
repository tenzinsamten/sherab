import { redirect } from '@sveltejs/kit';
import {
	loadClassPeople,
	loadStudentClasses,
	loadStudentHomework
} from '$lib/server/student-homework';
import type { PageServerLoad } from './$types';

/** My classes (#46): each class the student is in, its teachers and what's to do. */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const { classes, error: classesError } = await loadStudentClasses(supabase, user.id);
	const today = new Date().toISOString().slice(0, 10);

	// A student has a handful of classes, so one class_people() call each.
	const [homework, people] = await Promise.all([
		loadStudentHomework(supabase, user.id, {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(classes.map((c) => c.id)),
			today
		}),
		Promise.all(classes.map((c) => loadClassPeople(supabase, c.id)))
	]);

	return {
		classes: classes.map((c, i) => ({
			...c,
			teachers: people[i].teachers.map((t) => t.name),
			todo: homework.items.filter((item) => item.classId === c.id).length
		})),
		loadError: Boolean(classesError || homework.error || people.some((p) => p.error))
	};
};
