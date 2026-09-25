import { fail, redirect } from '@sveltejs/kit';
import { CLASS_MESSAGES, rowOr404 } from '$lib/server/class-access';
import { loadClassRoster } from '$lib/server/enrollments';
import * as m from '$lib/paraglide/messages.js';
import {
	isValidDate,
	parseDescription,
	parseNonNegativeInt,
	parseReferenceLinks
} from '$lib/server/homework-details';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { SkillArea } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const SKILL_AREAS: SkillArea[] = ['language', 'song', 'dance'];

/** Create-homework page (#33). On success it redirects back to the list. */
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { session } = await safeGetSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	// RLS (classes_select_admin_or_assigned_teacher) is the real barrier (AD-2).
	const cls = rowOr404(
		await supabase.from('classes').select('id, name, code').eq('id', params.id).maybeSingle(),
		CLASS_MESSAGES
	);

	const roster = await loadClassRoster(supabase, params.id);

	return {
		class: cls,
		students: roster.students,
		loadError: roster.error
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

			throw redirect(303, `/teacher/classes/${classId}/homework?created=weekly`);
		}

		// One-off case (Story 3-1).
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
		const roster = await loadClassRoster(supabase, classId);

		if (roster.error) {
			return fail(400, {
				error: m.homework_error_create_failed(),
				action: 'createAssignment' as const
			});
		}

		const approvedIds = new Set(roster.students.map((s) => s.id));
		const targetIds =
			targetMode === 'subset'
				? selectedStudentIds.filter((id) => approvedIds.has(id))
				: Array.from(approvedIds);

		// A whole-class assignment may start with no students: students
		// approved or added to the class later get it from the
		// class_enrollments_assign_open_homework trigger (0013, 0016). An
		// empty *subset* is a mistake, so that still fails.
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

		const created = targetIds.length - failedStudentIds.length;
		const failed = failedStudentIds.length > 0 ? `&failed=${failedStudentIds.length}` : '';
		throw redirect(303, `/teacher/classes/${classId}/homework?created=${created}${failed}`);
	}
};
