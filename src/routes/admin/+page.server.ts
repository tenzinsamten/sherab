import { buildHomeworkProgress, type HomeworkHistoryRow } from '$lib/server/homework-status';
import type { PageServerLoad } from './$types';

type HistoryQuerySupabase = Parameters<PageServerLoad>[0]['locals']['supabase'];

/**
 * PostgREST caps every unfiltered select at `api.max_rows` (1000 locally,
 * `supabase/config.toml`) -- confirmed empirically during this story's own
 * review: `homework_status_history` already holds 1091 rows in this dev
 * database, so a single unpaged `.select()` here silently truncates and
 * undercounts the completion percentage once a real school's history grows
 * past that cap. `.range()` in a loop until a page comes back short of the
 * page size avoids a second migration/RPC (Boundaries: "no new migration")
 * while still reading the whole table.
 */
async function fetchAllHistoryRows(
	supabase: HistoryQuerySupabase
): Promise<{ rows: HomeworkHistoryRow[]; error: { message: string } | null }> {
	const pageSize = 1000;
	const rows: HomeworkHistoryRow[] = [];
	let from = 0;

	for (;;) {
		const { data, error } = await supabase
			.from('homework_status_history')
			.select('id, instance_id, student_id, status, recorded_by, recorded_at')
			.order('id', { ascending: true })
			.range(from, from + pageSize - 1);

		if (error) return { rows: [], error };

		const page = data ?? [];
		for (const r of page) {
			rows.push({
				id: r.id,
				instanceId: r.instance_id,
				studentId: r.student_id,
				status: r.status,
				recordedBy: r.recorded_by,
				recordedAt: r.recorded_at
			});
		}

		if (page.length < pageSize) break;
		from += pageSize;
	}

	return { rows, error: null };
}

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
