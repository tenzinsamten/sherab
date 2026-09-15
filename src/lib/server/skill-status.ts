import type { SkillArea, SkillLevel } from '$lib/supabase/database.types';

export type SkillHistoryRow = {
	id: string;
	studentId: string;
	skillArea: SkillArea;
	level: SkillLevel;
	notes: string | null;
	recordedAt: string;
};

/**
 * "Current" = the latest row per (student_id, skill_area) (AD-5). Pure
 * dedup logic, extracted out of +page.server.ts's `load()` so it can be
 * unit-tested directly (skill-status.spec.ts) without a Supabase client.
 *
 * Requires `rows` to already be sorted newest-first by the caller (recorded_at
 * desc, with an id-desc tiebreaker for an exact-timestamp collision -- a real
 * scenario given the spec's own concurrent-edit requirement, see the
 * `.order()` calls in +page.server.ts's `load()`). Given that ordering, the
 * first occurrence of each (student_id, skill_area) key is current; a
 * last-wins (or otherwise inverted) dedup guard would instead surface the
 * oldest entry as current, which skill-status.spec.ts asserts against.
 */
export function pickCurrentSkillStatuses(rows: SkillHistoryRow[]): Record<string, SkillHistoryRow> {
	const current = new Map<string, SkillHistoryRow>();
	for (const row of rows) {
		const key = `${row.studentId}:${row.skillArea}`;
		if (!current.has(key)) {
			current.set(key, row);
		}
	}
	return Object.fromEntries(current);
}
