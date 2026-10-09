import {
	createSection,
	deleteSection,
	deleteSyllabus,
	loadSyllabusDetail,
	moveSection,
	updateSection
} from '$lib/server/class-syllabus';
import { deleteFile, replaceFile, uploadFile } from '$lib/server/syllabus-files';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * One syllabus (#37): its sections (add, edit, move, delete; 0038), each
 * section's PDF files (upload, replace, remove; 0039) and deleting the syllabus.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) =>
	loadSyllabusDetail(supabase, params.id, params.syllabusId);

async function sectionContext({
	request,
	params,
	locals: { supabase, safeGetSession }
}: RequestEvent) {
	const { user } = await safeGetSession();
	return { request, classId: params.id, syllabusId: params.syllabusId, supabase, user };
}

export const actions: Actions = {
	addSection: async (event) => createSection(await sectionContext(event)),
	updateSection: async (event) => updateSection(await sectionContext(event)),
	moveSection: async (event) => moveSection(await sectionContext(event)),
	deleteSection: async (event) => deleteSection(await sectionContext(event)),
	uploadFile: async (event) => uploadFile(await sectionContext(event)),
	replaceFile: async (event) => replaceFile(await sectionContext(event)),
	deleteFile: async (event) => deleteFile(await sectionContext(event)),
	delete: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return deleteSyllabus({
			request,
			classId: params.id,
			listPath: `/admin/classes/${params.id}/syllabus`,
			supabase,
			user
		});
	}
};
