import { redirect } from '@sveltejs/kit';
import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import { listSyllabi, pickStudentSyllabus } from '$lib/server/class-syllabus';
import { currentSchoolYear } from '$lib/school-year';
import type { PageServerLoad } from './$types';

/**
 * A class's syllabus for its students (#43): this school year's, or the
 * newest. RLS (classes_select_own_student, class_syllabi_select, 0016) only
 * shows a class the student is enrolled in, so another class is a 404.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const cls = rowOr404(
		await supabase.from('classes').select('id, name').eq('id', params.classId).maybeSingle(),
		CLASS_MESSAGES
	);
	const { syllabi, error } = await listSyllabi(supabase, cls.id);

	return {
		class: cls,
		syllabus: pickStudentSyllabus(syllabi, currentSchoolYear()),
		loadError: error
	};
};
