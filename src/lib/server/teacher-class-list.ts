import type { SupabaseClient } from '@supabase/supabase-js';
import { localizeName, type LocalizedNames } from '$lib/localized-name';
import type { Database } from '$lib/supabase/database.types';

/** A class card on the teacher dashboard and on /teacher/classes (#108). */
export type TeacherClass = { id: string; name: string; code: string };

/**
 * The classes assigned to `teacherId`, names in the viewer's language.
 * Shared by the teacher dashboard and the teacher classes page (#108).
 *
 * RLS (class_teachers_select_admin_or_own + classes_select_admin_or_assigned_teacher)
 * is what actually restricts this to the caller's own assignments -- the
 * explicit .eq below is belt-and-suspenders, not the enforcement.
 */
export async function loadTeacherClasses(
	supabase: SupabaseClient<Database>,
	teacherId: string
): Promise<{ classes: TeacherClass[]; error: boolean }> {
	const { data: assignments, error } = await supabase
		.from('class_teachers')
		.select('classes ( id, name, name_bo, name_de, code )')
		.eq('teacher_id', teacherId);

	const classes = (assignments ?? [])
		.map((row) => row.classes as unknown as (TeacherClass & LocalizedNames) | null)
		.filter((cls): cls is TeacherClass & LocalizedNames => cls !== null)
		.map((cls): TeacherClass => localizeName(cls));

	return { classes, error: Boolean(error) };
}
