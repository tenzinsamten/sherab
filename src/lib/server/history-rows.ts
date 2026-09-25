import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import type { HomeworkHistoryRow } from './homework-status';

const PAGE_SIZE = 1000;

/**
 * Reads every `homework_status_history` row the caller can see, optionally
 * limited to some classes.
 *
 * PostgREST caps every unfiltered select at `api.max_rows` (1000 locally,
 * `supabase/config.toml`), and a school's history passes that quickly, so a
 * single `.select()` would silently truncate and undercount. `.range()` in a
 * loop until a page comes back short reads the whole set without an RPC.
 * Moved here from the admin dashboard (Story 5-1) so the teacher dashboard
 * (#24) can reuse it.
 */
export async function fetchAllHistoryRows(
	supabase: SupabaseClient<Database>,
	classIds?: string[]
): Promise<{ rows: HomeworkHistoryRow[]; error: { message: string } | null }> {
	const rows: HomeworkHistoryRow[] = [];
	let from = 0;

	for (;;) {
		let query = supabase
			.from('homework_status_history')
			.select('id, instance_id, student_id, status, recorded_by, recorded_at');
		if (classIds) query = query.in('class_id', classIds);
		const { data, error } = await query
			.order('id', { ascending: true })
			.range(from, from + PAGE_SIZE - 1);

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

		if (page.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}

	return { rows, error: null };
}
