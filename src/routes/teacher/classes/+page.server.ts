import { loadTeacherClasses } from '$lib/server/teacher-class-list';
import type { PageServerLoad } from './$types';

/**
 * The teacher's classes (#108, the Classes tab): the same class cards as the
 * dashboard, from the same RLS-scoped `class_teachers` query. A failed query
 * sets `loadError` (the root layout's load-error toast) with an empty list.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return { classes: [], loadError: false };

	const { classes, error } = await loadTeacherClasses(supabase, user.id);
	return { classes: error ? [] : classes, loadError: error };
};
