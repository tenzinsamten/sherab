import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import {
	enrollStudent,
	loadClassRoster,
	loadEnrollableStudents,
	unenrollStudent
} from '$lib/server/enrollments';
import type { Actions, PageServerLoad } from './$types';

/** A class's students: add existing students from other classes, or remove them (#42). */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const cls = rowOr404(
		await supabase.from('classes').select('id, name, code').eq('id', params.id).maybeSingle(),
		CLASS_MESSAGES
	);
	const [roster, enrollable] = await Promise.all([
		loadClassRoster(supabase, params.id),
		loadEnrollableStudents(supabase, params.id)
	]);
	return {
		class: cls,
		students: roster.students,
		enrollable: enrollable.students,
		loadError: roster.error || enrollable.error
	};
};

export const actions: Actions = {
	enroll: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return enrollStudent({ request, classId: params.id, supabase, user });
	},

	unenroll: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return unenrollStudent({ request, classId: params.id, supabase, user });
	}
};
