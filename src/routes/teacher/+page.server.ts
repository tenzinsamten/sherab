import { fetchAllHistoryRows } from '$lib/server/history-rows';
import { buildTeacherHomeworkTiles } from '$lib/server/teacher-dashboard';
import type { PageServerLoad } from './$types';

type TeacherClass = { id: string; name: string; code: string };

const EMPTY_TILES = { dueThisWeek: 0, overdue: 0, awaitingReview: 0, completionPercent: 0 };

/**
 * Teacher dashboard (#24): stat tiles over the teacher's own classes, then
 * the class cards. The pending-requests tile uses `pendingRequestsCount`
 * from the root layout, which RLS already scopes to the teacher's classes.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		return { classes: [], studentsCount: 0, ...EMPTY_TILES, loadError: false };
	}

	// RLS (class_teachers_select_admin_or_own + classes_select_admin_or_assigned_teacher)
	// is what actually restricts this to the caller's own assignments -- the
	// explicit .eq below is belt-and-suspenders, not the enforcement.
	const { data: assignments, error } = await supabase
		.from('class_teachers')
		.select('classes ( id, name, code )')
		.eq('teacher_id', user.id);

	const classes = (assignments ?? [])
		.map((row) => row.classes as unknown as TeacherClass | null)
		.filter((cls): cls is TeacherClass => cls !== null);

	if (error || classes.length === 0) {
		return { classes, studentsCount: 0, ...EMPTY_TILES, loadError: Boolean(error) };
	}

	const classIds = classes.map((c) => c.id);

	const [
		{ count: studentsCount, error: studentsError },
		{ data: instanceRows, error: instancesError },
		{ rows: history, error: historyError }
	] = await Promise.all([
		supabase
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.eq('role', 'student')
			.eq('status', 'approved')
			.in('class_id', classIds),
		// One class generates about one instance a week, so a teacher's
		// instances stay well under PostgREST's 1000-row cap; history is the
		// table that needs paging.
		supabase
			.from('homework_instances')
			.select('id, due_date, archived_at')
			.in('class_id', classIds),
		fetchAllHistoryRows(supabase, classIds)
	]);

	const today = new Date().toISOString().slice(0, 10);
	const tiles = buildTeacherHomeworkTiles(
		(instanceRows ?? []).map((i) => ({
			id: i.id,
			dueDate: i.due_date,
			archivedAt: i.archived_at
		})),
		history,
		today
	);

	return {
		classes,
		studentsCount: studentsCount ?? 0,
		...tiles,
		loadError: Boolean(studentsError || instancesError || historyError)
	};
};
