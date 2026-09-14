import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		return { classes: [], loadError: false };
	}

	// RLS (class_teachers_select_admin_or_own + classes_select_admin_or_assigned_teacher)
	// is what actually restricts this to the caller's own assignments -- the
	// explicit .eq below is belt-and-suspenders, not the enforcement.
	const { data: assignments, error } = await supabase
		.from('class_teachers')
		.select('classes ( id, name, code )')
		.eq('teacher_id', user.id);

	const classes = (assignments ?? [])
		.map((row) => row.classes as unknown as { id: string; name: string; code: string } | null)
		.filter((cls): cls is { id: string; name: string; code: string } => cls !== null);

	return { classes, loadError: Boolean(error) };
};
