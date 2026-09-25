import { fetchAllHistoryRows } from '$lib/server/history-rows';
import { buildHomeworkProgress } from '$lib/server/homework-status';
import type { PageServerLoad } from './$types';

/**
 * Cross-class aggregate stat tiles for the admin dashboard (Story 5-1). Every
 * query below reads a table that already has an admin-readable RLS policy
 * (Boundaries: "no new RLS, no new migration") -- this route only aggregates
 * what admin can already see one management screen at a time.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [
		{ count: classesCount, error: classesError },
		{ count: teachersCount, error: teachersError },
		{ count: studentsCount, error: studentsError },
		{ count: pendingRequestsCount, error: pendingError },
		{ count: homeworkAssignmentsCount, error: assignmentsError },
		{ rows: history, error: historyError }
	] = await Promise.all([
		// profiles_select_admin (0001_init.sql) -- admin reads every class's
		// row here, unlike admin/teachers/+page.server.ts's narrower selects.
		supabase.from('classes').select('id', { count: 'exact', head: true }),
		supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher'),
		supabase
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.eq('role', 'student')
			.eq('status', 'approved'),
		// Same query shape as src/routes/+layout.server.ts's own
		// pendingRequestsCount (Code Map: "reuse the exact query... do not
		// reimplement") -- there is no shared helper to import, so this is the
		// identical role='student'/status='pending' count copied verbatim,
		// not a divergent reimplementation.
		supabase
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.eq('role', 'student')
			.eq('status', 'pending'),
		supabase.from('homework_assignments').select('id', { count: 'exact', head: true }),
		// homework_status_history_select_admin_teacher_or_own
		// (0004_homework.sql) -- admin has no class filter, so this is every
		// row in the table, not just one class's. buildHomeworkProgress()
		// (src/lib/server/homework-status.ts) is grain-agnostic -- it only
		// ever keys off (instance_id, student_id) pairs found in whatever rows
		// it's given, so it's directly reusable here at school-wide grain
		// with no modification. Paged via fetchAllHistoryRows so the school-
		// wide read isn't silently capped at max_rows.
		fetchAllHistoryRows(supabase)
	]);

	const progress = Object.values(buildHomeworkProgress(history));

	// Denominator: total assigned instance-rows, counted as distinct
	// (instance, student) pairs that ever received an 'assigned' row --
	// never a raw homework_status_history row count (codebase-wide dedup
	// convention, Stories 4-1/4-2/4-3). Numerator: distinct done-or-reviewed
	// pairs, same discipline AD-3 already requires for streaks/badges.
	const totalAssigned = progress.filter((p) => p.assignedAt !== null).length;
	const totalDoneOrReviewed = progress.filter(
		(p) => p.doneAt !== null || p.reviewedAt !== null
	).length;
	const homeworkCompletionPercent =
		totalAssigned === 0
			? 0
			: Math.min(100, Math.round((totalDoneOrReviewed / totalAssigned) * 100));

	return {
		classesCount: classesCount ?? 0,
		teachersCount: teachersCount ?? 0,
		studentsCount: studentsCount ?? 0,
		pendingRequestsCount: pendingRequestsCount ?? 0,
		homeworkAssignmentsCount: homeworkAssignmentsCount ?? 0,
		homeworkCompletionPercent,
		loadError: Boolean(
			classesError ||
			teachersError ||
			studentsError ||
			pendingError ||
			assignmentsError ||
			historyError
		)
	};
};
