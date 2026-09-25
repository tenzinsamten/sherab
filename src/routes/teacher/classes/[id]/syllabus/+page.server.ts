import { createSyllabus, loadSyllabusList } from '$lib/server/class-syllabus';
import type { Actions, PageServerLoad } from './$types';

/** A class's syllabi, one per school year, and the add form (#37). */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) =>
	loadSyllabusList(supabase, params.id);

export const actions: Actions = {
	create: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return createSyllabus({
			request,
			classId: params.id,
			listPath: `/teacher/classes/${params.id}/syllabus`,
			supabase,
			user
		});
	}
};
