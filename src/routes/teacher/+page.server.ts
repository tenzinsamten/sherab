import { enrolledStudentIds } from '$lib/server/enrollments';
import { fetchAllHistoryRows } from '$lib/server/history-rows';
import { loadTeacherClasses } from '$lib/server/teacher-class-list';
import { buildTeacherHomeworkTiles } from '$lib/server/teacher-dashboard';
import type { PageServerLoad } from './$types';

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

	// Only the caller's own assignments, under RLS (see loadTeacherClasses).
	const { classes, error } = await loadTeacherClasses(supabase, user.id);

	if (error || classes.length === 0) {
		return { classes, studentsCount: 0, ...EMPTY_TILES, loadError: error };
	}

	const classIds = classes.map((c) => c.id);

	const [
		{ ids: studentIds, error: studentsError },
		{ data: instanceRows, error: instancesError },
		{ rows: history, error: historyError }
	] = await Promise.all([
		// A student in two of this teacher's classes counts once (#42).
		enrolledStudentIds(supabase, classIds),
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
		studentsCount: studentIds.length,
		...tiles,
		loadError: Boolean(studentsError || instancesError || historyError)
	};
};
