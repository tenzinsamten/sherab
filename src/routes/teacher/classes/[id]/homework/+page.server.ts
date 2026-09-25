import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import {
	buildHomeworkProgress,
	isOverdue,
	type HomeworkHistoryRow
} from '$lib/server/homework-status';
import {
	parseDescription,
	parseReferenceLinks,
	readReferenceLinks
} from '$lib/server/homework-details';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { HomeworkReferenceLink, SkillArea } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const SKILL_AREAS: SkillArea[] = ['language', 'song', 'dance'];
const MAX_DUE_OFFSET_DAYS = 365;

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

/** Integer >= 0 (and <= a sanity bound) -- used for due_offset_days. */
function parseNonNegativeInt(value: string): number | null {
	if (!/^\d+$/.test(value)) return null;
	const n = Number(value);
	if (!Number.isSafeInteger(n) || n < 0 || n > MAX_DUE_OFFSET_DAYS) return null;
	return n;
}

type AssignmentStudentView = {
	studentId: string;
	displayName: string;
	assignedAt: string | null;
	doneAt: string | null;
	reviewedAt: string | null;
	overdue: boolean;
};

type AssignmentInstanceView = {
	id: string;
	periodStart: string;
	dueDate: string;
	archivedAt: string | null;
	students: AssignmentStudentView[];
	doneCount: number;
	reviewedCount: number;
};

type AssignmentView = {
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
		.select(
			'id, title, skill_area, description, reference_links, whole_class, recurrence_rule, due_offset_days, ends_on, paused_at, created_at'
		)
		.eq('class_id', classId)
		.order('created_at', { ascending: false });

	const assignmentIds = (assignmentRows ?? []).map((a) => a.id);

	// A recurring assignment (Story 3-2) can have many instances -- unlike
	// Story 3-1, which had exactly one per assignment -- so this is grouped
	// as assignment_id -> instance[], not assignment_id -> instance.
	let instanceRows: {
		id: string;
		assignment_id: string;
		period_start: string;
		due_date: string;
		archived_at: string | null;
	}[] = [];
	let instancesError = false;

	if (assignmentIds.length > 0) {
		const { data, error: instErr } = await supabase
			.from('homework_instances')
			.select('id, assignment_id, period_start, due_date, archived_at')
			.in('assignment_id', assignmentIds);
		instanceRows = data ?? [];
		instancesError = Boolean(instErr);
	}

	const instancesByAssignmentId = new Map<string, typeof instanceRows>();
	for (const inst of instanceRows) {
		const list = instancesByAssignmentId.get(inst.assignment_id) ?? [];
		list.push(inst);
		instancesByAssignmentId.set(inst.assignment_id, list);
	}
	const instanceIds = instanceRows.map((i) => i.id);

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
	// subset-targeted one-off assignment must only list its actual targets;
	// a whole-class one-off, or any recurring instance -- which is always
	// whole-class, generated fresh against the then-current approved roster
	// -- ends up listing every student who had an 'assigned' row at that
	// instance's generation time).
	const targetedStudentIdsByInstance = new Map<string, Set<string>>();
	for (const row of history) {
		if (row.status !== 'assigned') continue;
		const set = targetedStudentIdsByInstance.get(row.instanceId) ?? new Set<string>();
		set.add(row.studentId);
		targetedStudentIdsByInstance.set(row.instanceId, set);
	}

	const today = new Date().toISOString().slice(0, 10);

	const assignments: AssignmentView[] = (assignmentRows ?? []).map((a) => {
		const instances: AssignmentInstanceView[] = (instancesByAssignmentId.get(a.id) ?? [])
			.map((instance) => {
				const targetedIds = Array.from(targetedStudentIdsByInstance.get(instance.id) ?? []);

				const studentViews: AssignmentStudentView[] = targetedIds
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
					students: studentViews,
					doneCount: studentViews.filter((s) => s.doneAt !== null).length,
					reviewedCount: studentViews.filter((s) => s.reviewedAt !== null).length
				};
			})
			// Most recently started period first -- a recurring assignment's
			// newest instance is almost always the one a teacher wants to act
			// on first.
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
		const mode = String(formData.get('mode') ?? 'once');
		const title = String(formData.get('title') ?? '').trim();
		const skillArea = String(formData.get('skillArea') ?? '');
		const description = parseDescription(formData.get('description'));
		const referenceLinks = parseReferenceLinks(formData);

		if (!title) {
			return fail(400, {
				error: m.homework_error_title_required(),
				action: 'createAssignment' as const
			});
		}
		if (!description.ok) {
			return fail(400, {
				error: m.homework_error_description_too_long(),
				action: 'createAssignment' as const
			});
		}
		if (!referenceLinks.ok) {
			return fail(400, {
				error: m.homework_error_links_invalid(),
				action: 'createAssignment' as const
			});
		}
		if (!SKILL_AREAS.includes(skillArea as SkillArea)) {
			return fail(400, {
				error: m.homework_error_invalid_skill(),
				action: 'createAssignment' as const
			});
		}
		if (mode !== 'once' && mode !== 'weekly') {
			return fail(400, {
				error: m.homework_error_invalid_mode(),
				action: 'createAssignment' as const
			});
		}

		// Recurring case (Story 3-2): Intent -- "no instance created yet (the
		// generator creates the first on its next run, not synchronously)".
		// Always whole-class (Code Map: the generator targets "the
		// then-current approved roster" fresh at every run, so a
		// creation-time subset choice would go stale the moment the roster
		// changes) -- there is deliberately no target-mode field on this
		// path.
		if (mode === 'weekly') {
			const startDate = String(formData.get('startDate') ?? '');
			const dueOffsetDaysRaw = String(formData.get('dueOffsetDays') ?? '');

			if (!startDate || !isValidDate(startDate)) {
				return fail(400, {
					error: m.homework_error_invalid_start_date(),
					action: 'createAssignment' as const
				});
			}
			const dueOffsetDays = parseNonNegativeInt(dueOffsetDaysRaw);
			if (dueOffsetDays === null) {
				return fail(400, {
					error: m.homework_error_invalid_due_offset(),
					action: 'createAssignment' as const
				});
			}

			const { error: assignmentError } = await supabase.from('homework_assignments').insert({
				class_id: classId,
				title,
				skill_area: skillArea as SkillArea,
				description: description.value,
				reference_links: referenceLinks.value,
				whole_class: true,
				created_by: user.id,
				recurrence_rule: { frequency: 'weekly' },
				recurrence_start_date: startDate,
				due_offset_days: dueOffsetDays
			});

			if (assignmentError) {
				return fail(400, {
					error: m.homework_error_create_failed(),
					action: 'createAssignment' as const
				});
			}

			return {
				success: true,
				action: 'createAssignment' as const,
				recurring: true as const,
				title,
				targetCount: 0,
				failedStudentIds: [] as string[]
			};
		}

		// One-off case (Story 3-1, unchanged).
		const dueDate = String(formData.get('dueDate') ?? '');
		const targetMode = String(formData.get('targetMode') ?? 'all');
		const selectedStudentIds = formData.getAll('studentIds').map(String);

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

		// A whole-class assignment may start with no students: students
		// approved later get it from the profiles_assign_open_homework trigger
		// (0013). An empty *subset* is a mistake, so that still fails.
		if (targetMode === 'subset' && targetIds.length === 0) {
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
				description: description.value,
				reference_links: referenceLinks.value,
				whole_class: targetMode === 'all',
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
		// (recurring assignments give period_start its real recurring-period
		// meaning -- see the migration comment).
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

		if (targetIds.length > 0 && failedStudentIds.length === targetIds.length) {
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
			recurring: false as const,
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
	},

	// Edits an assignment's text and links, one-off or series (#26/#27). Never
	// touches homework_instances or status history (Story 3-2's Always
	// boundary), so existing Done/Reviewed marks are untouched. The due-date
	// offset only exists on a series; a one-off's due date and targets stay
	// fixed after creation.
	editAssignment: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const formData = await request.formData();
		const assignmentId = String(formData.get('assignmentId') ?? '');
		const title = String(formData.get('title') ?? '').trim();
		const description = parseDescription(formData.get('description'));
		const referenceLinks = parseReferenceLinks(formData);

		if (!assignmentId || !title) {
			return fail(400, {
				error: m.homework_error_title_required(),
				action: 'editAssignment' as const
			});
		}
		if (!description.ok) {
			return fail(400, {
				error: m.homework_error_description_too_long(),
				action: 'editAssignment' as const
			});
		}
		if (!referenceLinks.ok) {
			return fail(400, {
				error: m.homework_error_links_invalid(),
				action: 'editAssignment' as const
			});
		}

		// RLS-gated read first: confirms the assignment belongs to THIS class,
		// and tells a series (which has a due offset) from a one-off.
		const { data: assignment, error: readError } = await supabase
			.from('homework_assignments')
			.select('id, recurrence_rule')
			.eq('id', assignmentId)
			.eq('class_id', params.id)
			.single();

		if (readError || !assignment) {
			return fail(400, {
				error: m.homework_edit_error_save_failed(),
				action: 'editAssignment' as const
			});
		}

		const updates: {
			title: string;
			description: string | null;
			reference_links: HomeworkReferenceLink[];
			due_offset_days?: number;
		} = {
			title,
			description: description.value,
			reference_links: referenceLinks.value
		};

		if (assignment.recurrence_rule !== null) {
			const dueOffsetDays = parseNonNegativeInt(String(formData.get('dueOffsetDays') ?? ''));
			if (dueOffsetDays === null) {
				return fail(400, {
					error: m.homework_error_invalid_due_offset(),
					action: 'editAssignment' as const
				});
			}
			updates.due_offset_days = dueOffsetDays;
		}

		const { error: updateError } = await supabase
			.from('homework_assignments')
			.update(updates)
			.eq('id', assignmentId);

		if (updateError) {
			return fail(400, {
				error: m.homework_edit_error_save_failed(),
				action: 'editAssignment' as const
			});
		}

		return { success: true, action: 'editAssignment' as const };
	},

	pauseSeries: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const formData = await request.formData();
		const assignmentId = String(formData.get('assignmentId') ?? '');
		if (!assignmentId) {
			return fail(400, {
				error: m.homework_series_error_pause_failed(),
				action: 'pauseSeries' as const
			});
		}

		// Boundaries: pausing only ever changes homework_assignments -- the
		// generator's own "not paused" check (migration) is what actually
		// stops future instance creation; already-generated instances are
		// never touched here.
		// .select('id') + a row-count check (review finding #5) -- without
		// this, a stale assignmentId or scope mismatch (wrong class, or an
		// assignment that isn't actually recurring) returns error:null with
		// zero rows affected, and this action would report a false success.
		const { data: updatedRows, error: updateError } = await supabase
			.from('homework_assignments')
			.update({ paused_at: new Date().toISOString() })
			.eq('id', assignmentId)
			.eq('class_id', params.id)
			.not('recurrence_rule', 'is', null)
			.select('id');

		if (updateError || !updatedRows || updatedRows.length === 0) {
			return fail(400, {
				error: m.homework_series_error_pause_failed(),
				action: 'pauseSeries' as const
			});
		}

		return { success: true, action: 'pauseSeries' as const };
	},

	endSeries: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { error: m.homework_error_not_signed_in() });
		}

		const formData = await request.formData();
		const assignmentId = String(formData.get('assignmentId') ?? '');
		if (!assignmentId) {
			return fail(400, {
				error: m.homework_series_error_end_failed(),
				action: 'endSeries' as const
			});
		}

		const today = new Date().toISOString().slice(0, 10);

		// Boundaries: ending only ever changes homework_assignments -- the
		// generator's own "not past ends_on" check (migration) is what
		// actually stops future instance creation; already-generated
		// instances are never touched here.
		// .or('ends_on.is.null,ends_on.gt.<today>') (review finding #6) --
		// without this, a second ?/endSeries submission for an already-ended
		// series moves ends_on forward, re-opening the window for periods
		// between the old and new ends_on to generate on the next run,
		// reviving a series the teacher believed was permanently ended.
		// .select('id') + a row-count check (review finding #5, same as
		// pauseSeries) -- catches a stale assignmentId or scope mismatch
		// that would otherwise report a false success.
		const { data: updatedRows, error: updateError } = await supabase
			.from('homework_assignments')
			.update({ ends_on: today })
			.eq('id', assignmentId)
			.eq('class_id', params.id)
			.not('recurrence_rule', 'is', null)
			.or(`ends_on.is.null,ends_on.gt.${today}`)
			.select('id');

		if (updateError || !updatedRows || updatedRows.length === 0) {
			return fail(400, {
				error: m.homework_series_error_end_failed(),
				action: 'endSeries' as const
			});
		}

		return { success: true, action: 'endSeries' as const };
	}
};
