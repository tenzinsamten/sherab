import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import {
	buildHomeworkProgress,
	isOverdue,
	type HomeworkHistoryRow
} from '$lib/server/homework-status';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { SkillArea } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const SKILL_AREAS: SkillArea[] = ['language', 'song', 'dance'];

type StudentRow = { id: string; displayName: string };

/**
 * `YYYY-MM-DD`, and a real calendar date -- not just a truthy string.
 * Mirrors ../+page.server.ts's isValidSessionDate; duplicated locally
 * rather than extracted, matching this codebase's existing per-file
 * convention (the roster route doesn't export it either).
 */
function isValidDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type AssignmentStudentView = {
	studentId: string;
	displayName: string;
	assignedAt: string | null;
	doneAt: string | null;
	reviewedAt: string | null;
	overdue: boolean;
};

type AssignmentView = {
	id: string;
	title: string;
	skillArea: SkillArea;
	referenceLink: string | null;
	createdAt: string;
	instanceId: string | null;
	dueDate: string | null;
	archivedAt: string | null;
	students: AssignmentStudentView[];
	doneCount: number;
	reviewedCount: number;
};

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	const classId = params.id;

	// RLS (classes_select_admin_or_assigned_teacher) is the real barrier
	// (AD-2) -- see ../+page.server.ts for the identical reasoning.
	const { data: cls, error: classError } = await supabase
		.from('classes')
		.select('id, name, code')
		.eq('id', classId)
		.single();

	if (classError || !cls) {
		throw error(404, 'Class not found.');
	}

	const { data: studentRows, error: studentsError } = await supabase
		.from('profiles')
		.select('id, display_name, registration_name')
		.eq('class_id', classId)
		.eq('role', 'student')
		.eq('status', 'approved')
		.order('display_name', { ascending: true });

	const students: StudentRow[] = (studentRows ?? []).map((s) => ({
		id: s.id,
		displayName: s.display_name ?? s.registration_name ?? s.id
	}));
	const studentNameById = new Map(students.map((s) => [s.id, s.displayName]));

	const { data: assignmentRows, error: assignmentsError } = await supabase
		.from('homework_assignments')
		.select('id, title, skill_area, reference_link, created_at')
		.eq('class_id', classId)
		.order('created_at', { ascending: false });

	const assignmentIds = (assignmentRows ?? []).map((a) => a.id);

	let instances: {
		id: string;
		assignment_id: string;
		due_date: string;
		archived_at: string | null;
	}[] = [];
	let instancesError = false;

	if (assignmentIds.length > 0) {
		const { data, error: instErr } = await supabase
			.from('homework_instances')
			.select('id, assignment_id, due_date, archived_at')
			.in('assignment_id', assignmentIds);
		instances = data ?? [];
		instancesError = Boolean(instErr);
	}

	const instanceByAssignmentId = new Map(instances.map((i) => [i.assignment_id, i]));
	const instanceIds = instances.map((i) => i.id);

	let history: HomeworkHistoryRow[] = [];
	let historyError = false;

	if (instanceIds.length > 0) {
		const { data, error: histErr } = await supabase
			.from('homework_status_history')
			.select('id, instance_id, student_id, status, recorded_by, recorded_at')
			.in('instance_id', instanceIds);

		history = (data ?? []).map((r) => ({
			id: r.id,
			instanceId: r.instance_id,
			studentId: r.student_id,
			status: r.status,
			recordedBy: r.recorded_by,
			recordedAt: r.recorded_at
		}));
		historyError = Boolean(histErr);
	}

	const progress = buildHomeworkProgress(history);

	// Students targeted per instance -- only the ones with an 'assigned' row
	// for that instance, NOT every approved student unconditionally (a
	// subset-targeted assignment must only list its actual targets; a
	// whole-class assignment ends up listing every approved student because
	// every one of them got an 'assigned' row at creation time).
	const targetedStudentIdsByInstance = new Map<string, Set<string>>();
	for (const row of history) {
		if (row.status !== 'assigned') continue;
		const set = targetedStudentIdsByInstance.get(row.instanceId) ?? new Set<string>();
		set.add(row.studentId);
		targetedStudentIdsByInstance.set(row.instanceId, set);
	}

	const today = new Date().toISOString().slice(0, 10);

	const assignments: AssignmentView[] = (assignmentRows ?? []).map((a) => {
		const instance = instanceByAssignmentId.get(a.id) ?? null;
		const targetedIds = instance
			? Array.from(targetedStudentIdsByInstance.get(instance.id) ?? [])
			: [];

		const studentViews: AssignmentStudentView[] = targetedIds
			.map((studentId) => {
				const entry = progress[`${instance!.id}:${studentId}`] ?? {
					instanceId: instance!.id,
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
					overdue: instance ? isOverdue(instance.due_date, entry, today) : false
				};
			})
			.sort((x, y) => x.displayName.localeCompare(y.displayName));

		return {
			id: a.id,
			title: a.title,
			skillArea: a.skill_area,
			referenceLink: a.reference_link,
			createdAt: a.created_at,
			instanceId: instance?.id ?? null,
			dueDate: instance?.due_date ?? null,
			archivedAt: instance?.archived_at ?? null,
			students: studentViews,
			doneCount: studentViews.filter((s) => s.doneAt !== null).length,
			reviewedCount: studentViews.filter((s) => s.reviewedAt !== null).length
		};
	});

	return {
		class: cls,
		students,
		assignments,
		today,
		loadError: Boolean(studentsError || assignmentsError || instancesError || historyError)
	};
};

export const actions: Actions = {
	createAssignment: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const classId = params.id;
		const formData = await request.formData();
		const title = String(formData.get('title') ?? '').trim();
		const skillArea = String(formData.get('skillArea') ?? '');
		const dueDate = String(formData.get('dueDate') ?? '');
		const referenceLinkRaw = String(formData.get('referenceLink') ?? '').trim();
		const targetMode = String(formData.get('targetMode') ?? 'all');
		const selectedStudentIds = formData.getAll('studentIds').map(String);

		if (!title) {
			return fail(400, {
				error: m.homework_error_title_required(),
				action: 'createAssignment' as const
			});
		}
		if (!SKILL_AREAS.includes(skillArea as SkillArea)) {
			return fail(400, {
				error: m.homework_error_invalid_skill(),
				action: 'createAssignment' as const
			});
		}
		if (!dueDate || !isValidDate(dueDate)) {
			return fail(400, {
				error: m.homework_error_invalid_due_date(),
				action: 'createAssignment' as const
			});
		}
		if (targetMode !== 'all' && targetMode !== 'subset') {
			return fail(400, {
				error: m.homework_error_invalid_target_mode(),
				action: 'createAssignment' as const
			});
		}

		// RLS-gated read first (approved students of this class) -- also what
		// resolves the "whole class" target list and validates a "subset"
		// target list against real, approved students of THIS class, the same
		// "RLS-gated fetch first, privileged action after" shape used
		// elsewhere in this codebase (e.g. requests/+page.server.ts).
		const { data: studentRows, error: studentsError } = await supabase
			.from('profiles')
			.select('id')
			.eq('class_id', classId)
			.eq('role', 'student')
			.eq('status', 'approved');

		if (studentsError) {
			return fail(400, {
				error: m.homework_error_create_failed(),
				action: 'createAssignment' as const
			});
		}

		const approvedIds = new Set((studentRows ?? []).map((s) => s.id));
		const targetIds =
			targetMode === 'subset'
				? selectedStudentIds.filter((id) => approvedIds.has(id))
				: Array.from(approvedIds);

		if (targetIds.length === 0) {
			return fail(400, {
				error: m.homework_error_no_students(),
				action: 'createAssignment' as const
			});
		}

		const { data: assignment, error: assignmentError } = await supabase
			.from('homework_assignments')
			.insert({
				class_id: classId,
				title,
				skill_area: skillArea as SkillArea,
				reference_link: referenceLinkRaw || null,
				created_by: user.id
			})
			.select('id')
			.single();

		if (assignmentError || !assignment) {
			return fail(400, {
				error: m.homework_error_create_failed(),
				action: 'createAssignment' as const
			});
		}

		// One-off assignment: exactly one instance, period_start = due_date
		// (Story 3-2 gives period_start its real recurring-period meaning --
		// see the migration comment).
		const { data: instance, error: instanceError } = await supabase
			.from('homework_instances')
			.insert({
				assignment_id: assignment.id,
				class_id: classId,
				period_start: dueDate,
				due_date: dueDate
			})
			.select('id')
			.single();

		if (instanceError || !instance) {
			// Roll back the orphaned assignment row -- no client-facing DELETE
			// policy exists on homework_assignments (by design, Never: this
			// story doesn't build assignment editing/deletion as a feature), so
			// this narrow cleanup goes through the service-role client, the same
			// precedent requests/+page.server.ts already uses for privileged
			// cleanup. Cascades (on delete cascade) take any already-inserted
			// instance/history rows with it, though none exist yet at this point.
			await createSupabaseAdminClient()
				.from('homework_assignments')
				.delete()
				.eq('id', assignment.id);
			return fail(400, {
				error: m.homework_error_create_failed(),
				action: 'createAssignment' as const
			});
		}

		// Per-row inserts, not a single multi-row insert (Code Map: reuse the
		// markAttendance idiom) -- one bad row (e.g. a student whose status
		// changed between page load and submit) must not silently discard
		// every other target's 'assigned' row along with it.
		const failedStudentIds: string[] = [];
		for (const studentId of targetIds) {
			const { error: insertError } = await supabase.from('homework_status_history').insert({
				instance_id: instance.id,
				student_id: studentId,
				class_id: classId,
				status: 'assigned',
				recorded_by: user.id
			});
			if (insertError) {
				failedStudentIds.push(studentId);
			}
		}

		if (failedStudentIds.length === targetIds.length) {
			// Same rollback as above -- every target failed, so the assignment
			// and its instance are pure orphans (cascades away the instance too).
			await createSupabaseAdminClient()
				.from('homework_assignments')
				.delete()
				.eq('id', assignment.id);
			return fail(400, {
				error: m.homework_error_create_failed(),
				action: 'createAssignment' as const
			});
		}

		return {
			success: true,
			action: 'createAssignment' as const,
			title,
			targetCount: targetIds.length - failedStudentIds.length,
			failedStudentIds
		};
	},

	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const formData = await request.formData();
		const instanceId = String(formData.get('instanceId') ?? '');
		const studentId = String(formData.get('studentId') ?? '');

		if (!instanceId || !studentId) {
			return fail(400, { error: m.homework_error_mark_failed(), action: 'markDone' as const });
		}

		// RLS-gated read first, re-deriving class_id from the instance itself
		// rather than trusting the route's params.id -- a teacher legitimately
		// assigned to THIS class could otherwise submit their own real
		// class_id alongside an instanceId/studentId belonging to a different
		// class and have it accepted (mirrors student/+page.server.ts's
		// markDone, and the migration's own insert-policy fix for the same
		// gap).
		const { data: instance, error: instanceError } = await supabase
			.from('homework_instances')
			.select('id, class_id')
			.eq('id', instanceId)
			.single();

		if (instanceError || !instance) {
			return fail(400, { error: m.homework_error_mark_failed(), action: 'markDone' as const });
		}

		// RLS (homework_status_history_insert_admin_teacher_or_self_done) is
		// the real barrier: requires a prior 'assigned' row for this exact
		// (instance, student) pair and that the caller is admin or the class's
		// assigned teacher. recorded_by = this teacher, not the student --
		// exactly what distinguishes a teacher's on-behalf-of mark from a
		// student's own self-mark (I/O matrix).
		const { error: insertError } = await supabase.from('homework_status_history').insert({
			instance_id: instance.id,
			student_id: studentId,
			class_id: instance.class_id,
			status: 'done',
			recorded_by: user.id
		});

		if (insertError) {
			return fail(400, { error: m.homework_error_mark_failed(), action: 'markDone' as const });
		}

		return { success: true, action: 'markDone' as const };
	},

	markReviewed: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const formData = await request.formData();
		const instanceId = String(formData.get('instanceId') ?? '');
		const studentId = String(formData.get('studentId') ?? '');

		if (!instanceId || !studentId) {
			return fail(400, { error: m.homework_error_mark_failed(), action: 'markReviewed' as const });
		}

		// Same re-derivation as markDone above -- do not trust params.id.
		const { data: instance, error: instanceError } = await supabase
			.from('homework_instances')
			.select('id, class_id')
			.eq('id', instanceId)
			.single();

		if (instanceError || !instance) {
			return fail(400, { error: m.homework_error_mark_failed(), action: 'markReviewed' as const });
		}

		const { error: insertError } = await supabase.from('homework_status_history').insert({
			instance_id: instance.id,
			student_id: studentId,
			class_id: instance.class_id,
			status: 'reviewed',
			recorded_by: user.id
		});

		if (insertError) {
			return fail(400, { error: m.homework_error_mark_failed(), action: 'markReviewed' as const });
		}

		return { success: true, action: 'markReviewed' as const };
	},

	archiveInstance: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const formData = await request.formData();
		const instanceId = String(formData.get('instanceId') ?? '');

		if (!instanceId) {
			return fail(400, { error: m.homework_archive_error(), action: 'archiveInstance' as const });
		}

		// Intent: archiving is the one explicit action that lets an overdue
		// item stop being shown -- never automatic (Boundaries).
		const { error: updateError } = await supabase
			.from('homework_instances')
			.update({ archived_at: new Date().toISOString(), archived_by: user.id })
			.eq('id', instanceId)
			.eq('class_id', params.id);

		if (updateError) {
			return fail(400, { error: m.homework_archive_error(), action: 'archiveInstance' as const });
		}

		return { success: true, action: 'archiveInstance' as const };
	}
};
