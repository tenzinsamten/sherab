import type { HomeworkStatusValue } from '$lib/supabase/database.types';

export type HomeworkHistoryRow = {
	id: string;
	instanceId: string;
	studentId: string;
	status: HomeworkStatusValue;
	recordedBy: string | null;
	recordedAt: string;
};

export type HomeworkStudentProgress = {
	instanceId: string;
	studentId: string;
	assignedAt: string | null;
	doneAt: string | null;
	reviewedAt: string | null;
};

/**
 * Done and Reviewed are independently readable (Intent/Boundaries: "Done
 * alone feeds streaks, Reviewed alone feeds skill-status history... never
 * conflated"). Unlike pickCurrentSkillStatuses (skill-status.ts), which
 * collapses a single-axis history down to "the latest row wins", this scans
 * the *entire* append-only history per (instance_id, student_id) pair and
 * tracks each status independently -- a 'reviewed' row must never hide that
 * a 'done' row also exists, and vice versa.
 *
 * Does not require the input to be pre-sorted (unlike pickCurrentSkillStatuses)
 * -- it keeps the earliest timestamp seen for each status, so row order
 * doesn't affect the result.
 */
export function buildHomeworkProgress(
	rows: HomeworkHistoryRow[]
): Record<string, HomeworkStudentProgress> {
	const progress = new Map<string, HomeworkStudentProgress>();

	for (const row of rows) {
		const key = `${row.instanceId}:${row.studentId}`;
		let entry = progress.get(key);
		if (!entry) {
			entry = {
				instanceId: row.instanceId,
				studentId: row.studentId,
				assignedAt: null,
				doneAt: null,
				reviewedAt: null
			};
			progress.set(key, entry);
		}

		if (row.status === 'assigned' && (!entry.assignedAt || row.recordedAt < entry.assignedAt)) {
			entry.assignedAt = row.recordedAt;
		}
		if (row.status === 'done' && (!entry.doneAt || row.recordedAt < entry.doneAt)) {
			entry.doneAt = row.recordedAt;
		}
		if (row.status === 'reviewed' && (!entry.reviewedAt || row.recordedAt < entry.reviewedAt)) {
			entry.reviewedAt = row.recordedAt;
		}
	}

	return Object.fromEntries(progress);
}

/**
 * Overdue = due_date < today AND not done (Boundaries: "computed at read
 * time... never a stored/auto-set flag"). `dueDate`/`today` are both
 * `YYYY-MM-DD` ISO 8601 dates, which compare correctly with a plain string
 * comparison. Reviewed implies the student was at some point Done, so a
 * reviewed-but-somehow-never-done row (not a state the app itself creates,
 * but not blocked by RLS either -- see the migration's insert policy
 * comment) is still treated as "not overdue", matching the spirit of "not
 * done" rather than the literal absence of a done row.
 */
export function isOverdue(
	dueDate: string,
	progress: HomeworkStudentProgress,
	today: string
): boolean {
	return dueDate < today && !progress.doneAt && !progress.reviewedAt;
}
