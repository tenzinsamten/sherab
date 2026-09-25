import { buildHomeworkProgress, isOverdue, type HomeworkHistoryRow } from './homework-status';

export type DashboardInstance = { id: string; dueDate: string; archivedAt: string | null };

export type TeacherHomeworkTiles = {
	/** Open instances due today or within the next 6 days. */
	dueThisWeek: number;
	/** (instance, student) pairs past due and not done, archived excluded. */
	overdue: number;
	/** (instance, student) pairs marked Done but not yet Reviewed, archived excluded. */
	awaitingReview: number;
	/** Done-or-reviewed pairs over assigned pairs, 0 when nothing is assigned. */
	completionPercent: number;
};

function addDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/**
 * Homework tiles for the teacher dashboard (#24), over the teacher's own
 * classes only (the caller passes just those instances and history rows).
 * Completion uses the admin dashboard's formula (distinct pairs, never raw
 * row counts, capped at 100) and includes archived work, as the admin one does.
 */
export function buildTeacherHomeworkTiles(
	instances: DashboardInstance[],
	history: HomeworkHistoryRow[],
	today: string
): TeacherHomeworkTiles {
	const weekEnd = addDays(today, 6);
	const openById = new Map(
		instances.filter((i) => i.archivedAt === null).map((i) => [i.id, i] as const)
	);

	const dueThisWeek = [...openById.values()].filter(
		(i) => i.dueDate >= today && i.dueDate <= weekEnd
	).length;

	let overdue = 0;
	let awaitingReview = 0;
	let assigned = 0;
	let doneOrReviewed = 0;

	for (const entry of Object.values(buildHomeworkProgress(history))) {
		if (entry.assignedAt !== null) assigned++;
		if (entry.doneAt !== null || entry.reviewedAt !== null) doneOrReviewed++;

		const instance = openById.get(entry.instanceId);
		if (!instance || entry.assignedAt === null) continue;
		if (isOverdue(instance.dueDate, entry, today)) overdue++;
		if (entry.doneAt !== null && entry.reviewedAt === null) awaitingReview++;
	}

	return {
		dueThisWeek,
		overdue,
		awaitingReview,
		completionPercent:
			assigned === 0 ? 0 : Math.min(100, Math.round((doneOrReviewed / assigned) * 100))
	};
}
