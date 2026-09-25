import { fail } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import type { Database, HomeworkReferenceLink, SkillArea } from '$lib/supabase/database.types';
import { readReferenceLinks } from './homework-details';
import {
	buildHomeworkProgress,
	isOverdue,
	type HomeworkHistoryRow,
	type HomeworkStudentProgress
} from './homework-status';
import { fetchAllHistoryRows } from './history-rows';

/**
 * The student's own homework (#43): a To do / Done list on /student grouped
 * by class, and a detail page per homework instance. Shared by both routes.
 */

type Client = SupabaseClient<Database>;

export const STUDENT_PAGE_SIZE = 10;
export const STUDENT_FILTERS = ['todo', 'done'] as const;
export type StudentFilter = (typeof STUDENT_FILTERS)[number];

const DEFAULT_LOOKAHEAD_DAYS = 14;
/** Keeps `.in('id', ...)` URLs short however much history a student has. */
const IN_CHUNK = 100;

export type StudentHomeworkStatus = 'assigned' | 'done' | 'reviewed';

export type StudentHomeworkItem = {
	instanceId: string;
	assignmentId: string;
	classId: string;
	title: string;
	skillArea: SkillArea;
	description: string | null;
	referenceLinks: HomeworkReferenceLink[];
	dueDate: string;
	status: StudentHomeworkStatus;
	overdue: boolean;
	isRecurring: boolean;
};

export type InstanceRow = {
	id: string;
	assignment_id: string;
	class_id: string;
	due_date: string;
	archived_at: string | null;
};

export type AssignmentRow = {
	id: string;
	title: string;
	skill_area: SkillArea;
	description: string | null;
	reference_links: unknown;
	recurrence_rule: unknown | null;
};

export type StudentClass = { id: string; name: string; hasSyllabus: boolean };

export function statusOf(entry: HomeworkStudentProgress): StudentHomeworkStatus {
	return entry.reviewedAt ? 'reviewed' : entry.doneAt ? 'done' : 'assigned';
}

export function addDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export function toItem(
	instance: InstanceRow,
	assignment: AssignmentRow,
	entry: HomeworkStudentProgress,
	today: string
): StudentHomeworkItem {
	return {
		instanceId: instance.id,
		assignmentId: assignment.id,
		classId: instance.class_id,
		title: assignment.title,
		skillArea: assignment.skill_area,
		description: assignment.description,
		referenceLinks: readReferenceLinks(assignment.reference_links),
		dueDate: instance.due_date,
		status: statusOf(entry),
		overdue: isOverdue(instance.due_date, entry, today),
		isRecurring: assignment.recurrence_rule !== null
	};
}

/**
 * Which instances each list needs, from the student's history alone:
 * - **todo**: targeted, not done or reviewed yet;
 * - **done**: done or reviewed, most recently finished first.
 */
export function splitProgress(history: HomeworkHistoryRow[], studentId: string) {
	const progress = Object.values(buildHomeworkProgress(history)).filter(
		(p) => p.studentId === studentId && p.assignedAt !== null
	);
	const finishedAt = (p: HomeworkStudentProgress) => p.doneAt ?? p.reviewedAt ?? '';
	const todo = progress.filter((p) => !p.doneAt && !p.reviewedAt);
	const done = progress
		.filter((p) => p.doneAt || p.reviewedAt)
		.sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
	return { todo, done };
}

/**
 * To do keeps the old rule (open, due within the look-ahead window or
 * overdue) and, since #42, only classes the student is still in: leaving a
 * class hides its open homework.
 */
export function isTodoVisible(
	instance: InstanceRow,
	enrolledClassIds: Set<string>,
	cutoffDate: string
): boolean {
	return (
		instance.archived_at === null &&
		instance.due_date <= cutoffDate &&
		enrolledClassIds.has(instance.class_id)
	);
}

async function fetchByIds<T>(
	ids: string[],
	fetchChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ rows: T[]; error: boolean }> {
	const rows: T[] = [];
	let error = false;
	for (let i = 0; i < ids.length; i += IN_CHUNK) {
		const result = await fetchChunk(ids.slice(i, i + IN_CHUNK));
		if (result.error) error = true;
		rows.push(...(result.data ?? []));
	}
	return { rows, error };
}

export async function fetchInstances(supabase: Client, ids: string[]) {
	return fetchByIds<InstanceRow>(ids, (chunk) =>
		supabase
			.from('homework_instances')
			.select('id, assignment_id, class_id, due_date, archived_at')
			.in('id', chunk)
	);
}

export async function fetchAssignments(supabase: Client, ids: string[]) {
	return fetchByIds<AssignmentRow>(ids, (chunk) =>
		supabase
			.from('homework_assignments')
			.select('id, title, skill_area, description, reference_links, recurrence_rule')
			.in('id', chunk)
	);
}

async function lookaheadDays(supabase: Client): Promise<number> {
	// Admin-tunable (app_settings.homework_lookahead_days), not hardcoded.
	const { data } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'homework_lookahead_days')
		.maybeSingle();
	const days =
		data && typeof data.value === 'object' && data.value !== null
			? Number((data.value as { days?: unknown }).days)
			: NaN;
	return Number.isFinite(days) ? days : DEFAULT_LOOKAHEAD_DAYS;
}

/**
 * The classes the student is in (#42), with their names and whether they
 * have a syllabus. classes_select_own_student / class_syllabi_select (0016)
 * let an enrolled student read both.
 */
export async function loadStudentClasses(
	supabase: Client,
	studentId: string
): Promise<{ classes: StudentClass[]; error: boolean }> {
	const { data: enrollments, error } = await supabase
		.from('class_enrollments')
		.select('class_id')
		.eq('student_id', studentId);
	const ids = (enrollments ?? []).map((e) => e.class_id);
	if (error || ids.length === 0) return { classes: [], error: Boolean(error) };

	const [{ data: classRows, error: classesError }, { data: syllabusRows, error: syllabiError }] =
		await Promise.all([
			supabase.from('classes').select('id, name').in('id', ids),
			supabase.from('class_syllabi').select('class_id').in('class_id', ids)
		]);
	const withSyllabus = new Set((syllabusRows ?? []).map((s) => s.class_id));
	const classes = (classRows ?? [])
		.map((c) => ({ id: c.id, name: c.name, hasSyllabus: withSyllabus.has(c.id) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return { classes, error: Boolean(classesError || syllabiError) };
}

export type StudentHomeworkList = {
	items: StudentHomeworkItem[];
	counts: { todo: number; done: number };
	page: number;
	pageCount: number;
	error: boolean;
};

/**
 * One page of the student's homework. To do is short (look-ahead window) so
 * it isn't paged; Done is paged 10 at a time, newest first, and only that
 * page's instances and assignments are read.
 */
export async function loadStudentHomework(
	supabase: Client,
	studentId: string,
	opts: { filter: StudentFilter; page: number; enrolledClassIds: Set<string>; today: string }
): Promise<StudentHomeworkList> {
	// RLS scopes history to the caller's own rows; fetchAllHistoryRows pages
	// past PostgREST's row cap.
	const [{ rows: history, error: historyError }, days] = await Promise.all([
		fetchAllHistoryRows(supabase),
		lookaheadDays(supabase)
	]);
	const { todo, done } = splitProgress(history, studentId);
	const cutoffDate = addDays(opts.today, days);

	// To do needs its instances to count and filter; Done is counted from
	// history alone.
	const todoInstances = await fetchInstances(
		supabase,
		todo.map((p) => p.instanceId)
	);
	const visibleTodo = todoInstances.rows.filter((i) =>
		isTodoVisible(i, opts.enrolledClassIds, cutoffDate)
	);
	const counts = { todo: visibleTodo.length, done: done.length };

	let pageEntries: HomeworkStudentProgress[];
	let instances: InstanceRow[];
	let instancesError = todoInstances.error;
	let page = 1;
	let pageCount = 1;

	if (opts.filter === 'todo') {
		instances = visibleTodo;
		const visibleIds = new Set(visibleTodo.map((i) => i.id));
		pageEntries = todo.filter((p) => visibleIds.has(p.instanceId));
	} else {
		pageCount = Math.max(1, Math.ceil(done.length / STUDENT_PAGE_SIZE));
		page = Math.min(Math.max(1, opts.page), pageCount);
		pageEntries = done.slice((page - 1) * STUDENT_PAGE_SIZE, page * STUDENT_PAGE_SIZE);
		const doneInstances = await fetchInstances(
			supabase,
			pageEntries.map((p) => p.instanceId)
		);
		instances = doneInstances.rows;
		instancesError ||= doneInstances.error;
	}

	const assignments = await fetchAssignments(
		supabase,
		Array.from(new Set(instances.map((i) => i.assignment_id)))
	);
	const instanceById = new Map(instances.map((i) => [i.id, i]));
	const assignmentById = new Map(assignments.rows.map((a) => [a.id, a]));

	const items = pageEntries
		.map((entry) => {
			const instance = instanceById.get(entry.instanceId);
			const assignment = instance && assignmentById.get(instance.assignment_id);
			return instance && assignment ? toItem(instance, assignment, entry, opts.today) : null;
		})
		.filter((item): item is StudentHomeworkItem => item !== null);

	// To do: soonest due first. Done keeps history order (latest finished first).
	if (opts.filter === 'todo') items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

	return {
		items,
		counts,
		page,
		pageCount,
		error: Boolean(historyError || instancesError || assignments.error)
	};
}

export type ClassGroup = {
	classId: string;
	name: string;
	hasSyllabus: boolean;
	items: StudentHomeworkItem[];
};

/**
 * Groups items by class for display: the student's classes first (in name
 * order; with `includeEmpty`, every one of them, so each class shows on To
 * do even with nothing due), then any class they have left (Done only),
 * named `formerLabel`.
 */
export function groupByClass(
	items: StudentHomeworkItem[],
	classes: StudentClass[],
	opts: { includeEmpty: boolean; formerLabel: string }
): ClassGroup[] {
	const groups: ClassGroup[] = classes.map((c) => ({
		classId: c.id,
		name: c.name,
		hasSyllabus: c.hasSyllabus,
		items: items.filter((i) => i.classId === c.id)
	}));
	const known = new Set(classes.map((c) => c.id));
	const formerIds = Array.from(new Set(items.map((i) => i.classId))).filter((id) => !known.has(id));
	for (const classId of formerIds) {
		groups.push({
			classId,
			name: opts.formerLabel,
			hasSyllabus: false,
			items: items.filter((i) => i.classId === classId)
		});
	}
	return opts.includeEmpty ? groups : groups.filter((g) => g.items.length > 0);
}

/** The student's own "done" mark, shared by /student and the detail page. */
export async function markHomeworkDone({
	request,
	supabase,
	user
}: {
	request: Request;
	supabase: Client;
	user: User | null;
}) {
	if (!user) {
		return fail(401, { error: m.student_homework_error_not_signed_in() });
	}

	const formData = await request.formData();
	const instanceId = String(formData.get('instanceId') ?? '');
	if (!instanceId) {
		return fail(400, { error: m.student_homework_error_mark_failed() });
	}

	// RLS-gated read first (homework_instances_select_admin_teacher_or_
	// targeted_student): proves this instance is actually visible to the
	// caller (i.e. they were targeted by it) before the insert below. This
	// also supplies class_id, which the insert needs.
	const { data: instance, error: instanceError } = await supabase
		.from('homework_instances')
		.select('id, class_id')
		.eq('id', instanceId)
		.single();

	if (instanceError || !instance) {
		return fail(400, { error: m.student_homework_error_not_found() });
	}

	// RLS (homework_status_history_insert_admin_teacher_or_self_done) is the
	// real barrier: requires a prior 'assigned' row targeting this exact
	// student for this exact instance (I/O matrix: "Untargeted student
	// attempts Done -> RLS rejects the insert").
	const { error: insertError } = await supabase.from('homework_status_history').insert({
		instance_id: instance.id,
		student_id: user.id,
		class_id: instance.class_id,
		status: 'done',
		recorded_by: user.id
	});

	if (insertError) {
		return fail(400, { error: m.student_homework_error_mark_failed() });
	}

	return { success: true, action: 'markDone' as const };
}
