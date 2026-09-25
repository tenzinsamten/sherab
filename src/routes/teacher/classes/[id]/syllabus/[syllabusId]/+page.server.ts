import { deleteSyllabus, loadSyllabusDetail, updateSyllabus } from '$lib/server/class-syllabus';
import type { Actions, PageServerLoad } from './$types';

/** One syllabus: view, edit, delete (#37). `?edit=1` (just added) opens the form. */
export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => ({
	...(await loadSyllabusDetail(supabase, params.id, params.syllabusId)),
	startInEdit: url.searchParams.get('edit') === '1'
});

export const actions: Actions = {
	update: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return updateSyllabus({
			request,
			classId: params.id,
			listPath: `/teacher/classes/${params.id}/syllabus`,
			supabase,
			user
		});
	},
	delete: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return deleteSyllabus({
			request,
			classId: params.id,
			listPath: `/teacher/classes/${params.id}/syllabus`,
			supabase,
			user
		});
	}
};
