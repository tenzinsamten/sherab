import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, HomeworkReferenceLink, SkillArea } from '$lib/supabase/database.types';
import { readReferenceLinks } from './homework-details';
import { buildHomeworkProgress, isOverdue, type HomeworkHistoryRow } from './homework-status';

/**
 * Shared shaping for the homework list, detail page and class page (#33).
 * Moved out of the old single homework page's `load`, logic unchanged.
 */

type Client = SupabaseClient<Database>;
const PAGE_SIZE = 1000;

export type AssignmentStudentView = {
	studentId: string;
	displayName: string;
	assignedAt: string | null;
	doneAt: string | null;
	reviewedAt: string | null;
	overdue: boolean;
};

export type AssignmentInstanceView = {
	id: string;
	periodStart: string;
	dueDate: string;
	archivedAt: string | null;
	students: AssignmentStudentView[];
	doneCount: number;
	reviewedCount: number;
};

export type AssignmentView = {
	id: string;
	title: string;
	skillArea: SkillArea;
	description: string | null;
	referenceLinks: HomeworkReferenceLink[];
	createdAt: string;
	isRecurring: boolean;
	wholeClass: boolean;
	dueOffsetDays: number | null;
	endsOn: string | null;
	pausedAt: string | null;
	instances: AssignmentInstanceView[];
};

export const ASSIGNMENT_COLUMNS =
	'id, title, skill_area, description, reference_links, whole_class, recurrence_rule, due_offset_days, ends_on, paused_at, created_at';

export type AssignmentRow = {
	id: string;
	title: string;
	skill_area: SkillArea;
	description: string | null;
	reference_links: unknown;
	whole_class: boolean;
	recurrence_rule: unknown | null;
	due_offset_days: number | null;
	ends_on: string | null;
	paused_at: string | null;
	created_at: string;
};

export type InstanceRow = {
	id: string;
	assignment_id: string;
	period_start: string;
	due_date: string;
	archived_at: string | null;
};

/**
 * An assignment is **open** while it has a non-archived instance, or while it
 * is a series that is neither paused nor ended (a new series may have no
 * instance yet). Everything else counts as archived for the list filter.
 */
export function isOpen(
	assignment: { isRecurring: boolean; pausedAt: string | null; endsOn: string | null },
	hasOpenInstance: boolean,
	today: string
): boolean {
	if (hasOpenInstance) return true;
	return (
		assignment.isRecurring &&
		!assignment.pausedAt &&
		!(assignment.endsOn !== null && assignment.endsOn <= today)
	);
}

export type AssignmentIndexEntry = {
	id: string;
	createdAt: string;
	open: boolean;
};

/**
 * Every assignment of a class, newest first, each marked open or archived.
 * Only light columns are read, so the list can filter and page before
 * loading the heavy instance and status data for one page.
 */
export async function loadAssignmentIndex(
	supabase: Client,
	classId: string,
	today: string
): Promise<{ entries: AssignmentIndexEntry[]; error: boolean }> {
	const [{ data: rows, error: rowsError }, openInstances] = await Promise.all([
		supabase
			.from('homework_assignments')
			.select('id, created_at, recurrence_rule, paused_at, ends_on')
			.eq('class_id', classId)
			.order('created_at', { ascending: false }),
		fetchOpenInstanceAssignmentIds(supabase, classId)
	]);

	const entries = (rows ?? []).map((a) => ({
		id: a.id,
		createdAt: a.created_at,
		open: isOpen(
			{ isRecurring: a.recurrence_rule !== null, pausedAt: a.paused_at, endsOn: a.ends_on },
			openInstances.ids.has(a.id),
			today
		)
	}));

	return { entries, error: Boolean(rowsError) || openInstances.error };
}

/** assignment_ids with at least one non-archived instance, paged past max_rows. */
async function fetchOpenInstanceAssignmentIds(
	supabase: Client,
	classId: string
): Promise<{ ids: Set<string>; error: boolean }> {
	const ids = new Set<string>();
	let from = 0;
	for (;;) {
		const { data, error } = await supabase
			.from('homework_instances')
			.select('id, assignment_id')
			.eq('class_id', classId)
			.is('archived_at', null)
			.order('id', { ascending: true })
			.range(from, from + PAGE_SIZE - 1);
		if (error) return { ids, error: true };
		const page = data ?? [];
		for (const row of page) ids.add(row.assignment_id);
		if (page.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}
	return { ids, error: false };
}

/** Instances and status history for a handful of assignments (one page, or one assignment). */
export async function fetchInstancesAndHistory(
	supabase: Client,
	assignmentIds: string[]
): Promise<{ instances: InstanceRow[]; history: HomeworkHistoryRow[]; error: boolean }> {
	if (assignmentIds.length === 0) return { instances: [], history: [], error: false };

	const { data: instanceData, error: instancesError } = await supabase
		.from('homework_instances')
		.select('id, assignment_id, period_start, due_date, archived_at')
		.in('assignment_id', assignmentIds);
	const instances = instanceData ?? [];

	const instanceIds = instances.map((i) => i.id);
	if (instanceIds.length === 0) {
		return { instances, history: [], error: Boolean(instancesError) };
	}

	const { data: historyData, error: historyError } = await supabase
		.from('homework_status_history')
		.select('id, instance_id, student_id, status, recorded_by, recorded_at')
		.in('instance_id', instanceIds);

	const history = (historyData ?? []).map((r) => ({
		id: r.id,
		instanceId: r.instance_id,
		studentId: r.student_id,
		status: r.status,
		recordedBy: r.recorded_by,
		recordedAt: r.recorded_at
	}));

	return { instances, history, error: Boolean(instancesError || historyError) };
}

export function buildAssignmentViews(
	assignmentRows: AssignmentRow[],
	instanceRows: InstanceRow[],
	history: HomeworkHistoryRow[],
	studentNameById: Map<string, string>,
	today: string
): AssignmentView[] {
	const instancesByAssignmentId = new Map<string, InstanceRow[]>();
	for (const inst of instanceRows) {
		const list = instancesByAssignmentId.get(inst.assignment_id) ?? [];
		list.push(inst);
		instancesByAssignmentId.set(inst.assignment_id, list);
	}

	const progress = buildHomeworkProgress(history);

	// Students targeted per instance -- only the ones with an 'assigned' row
	// for that instance, NOT every approved student unconditionally (a
	// subset-targeted one-off assignment must only list its actual targets).
	const targetedStudentIdsByInstance = new Map<string, Set<string>>();
	for (const row of history) {
		if (row.status !== 'assigned') continue;
		const set = targetedStudentIdsByInstance.get(row.instanceId) ?? new Set<string>();
		set.add(row.studentId);
		targetedStudentIdsByInstance.set(row.instanceId, set);
	}

	return assignmentRows.map((a) => {
		const instances: AssignmentInstanceView[] = (instancesByAssignmentId.get(a.id) ?? [])
			.map((instance) => {
				const targetedIds = Array.from(targetedStudentIdsByInstance.get(instance.id) ?? []);

				const students: AssignmentStudentView[] = targetedIds
					.map((studentId) => {
						const entry = progress[`${instance.id}:${studentId}`] ?? {
							instanceId: instance.id,
							studentId,
							assignedAt: null,
							doneAt: null,
							reviewedAt: null
						};
						return {
							studentId,
							displayName: studentNameById.get(studentId) ?? studentId,
							assignedAt: entry.assignedAt,
							doneAt: entry.doneAt,
							reviewedAt: entry.reviewedAt,
							overdue: isOverdue(instance.due_date, entry, today)
						};
					})
					.sort((x, y) => x.displayName.localeCompare(y.displayName));

				return {
					id: instance.id,
					periodStart: instance.period_start,
					dueDate: instance.due_date,
					archivedAt: instance.archived_at,
					students,
					doneCount: students.filter((s) => s.doneAt !== null).length,
					reviewedCount: students.filter((s) => s.reviewedAt !== null).length
				};
			})
			// Most recently started period first -- a series' newest instance is
			// almost always the one a teacher wants to act on first.
			.sort((x, y) => y.periodStart.localeCompare(x.periodStart));

		return {
			id: a.id,
			title: a.title,
			skillArea: a.skill_area,
			description: a.description,
			referenceLinks: readReferenceLinks(a.reference_links),
			createdAt: a.created_at,
			isRecurring: a.recurrence_rule !== null,
			wholeClass: a.whole_class,
			dueOffsetDays: a.due_offset_days,
			endsOn: a.ends_on,
			pausedAt: a.paused_at,
			instances
		};
	});
}

export type AssignmentSummary = {
	id: string;
	title: string;
	skillArea: SkillArea;
	isRecurring: boolean;
	/** Earliest open instance due today or later, else the latest instance's due date. */
	nextDue: string | null;
	/** Done / targeted for the most recent instance. */
	latestDone: number;
	latestTotal: number;
	overdue: boolean;
	archived: boolean;
};

/** One list row (#33). `instances` must be newest first, as buildAssignmentViews returns them. */
export function summarise(view: AssignmentView, open: boolean, today: string): AssignmentSummary {
	const openInstances = view.instances.filter((i) => i.archivedAt === null);
	const upcoming = openInstances
		.map((i) => i.dueDate)
		.filter((d) => d >= today)
		.sort();
	const latest = view.instances[0];
	const latestDueDate = view.instances.reduce<string | null>(
		(max, i) => (max === null || i.dueDate > max ? i.dueDate : max),
		null
	);

	return {
		id: view.id,
		title: view.title,
		skillArea: view.skillArea,
		isRecurring: view.isRecurring,
		nextDue: upcoming[0] ?? latestDueDate,
		latestDone: latest?.doneCount ?? 0,
		latestTotal: latest?.students.length ?? 0,
		overdue: openInstances.some((i) => i.students.some((s) => s.overdue)),
		archived: !open
	};
}
