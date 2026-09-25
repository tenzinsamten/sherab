import { fail, redirect } from '@sveltejs/kit';
import { CLASS_MESSAGES, HOMEWORK_MESSAGES, rowOr404 } from '$lib/server/class-access';
import * as m from '$lib/paraglide/messages.js';
import {
	parseDescription,
	parseNonNegativeInt,
	parseReferenceLinks
} from '$lib/server/homework-details';
import {
	ASSIGNMENT_COLUMNS,
	buildAssignmentViews,
	fetchInstancesAndHistory,
	type AssignmentRow
} from '$lib/server/homework-view';
import type { HomeworkReferenceLink } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

/** One homework assignment with its instances and student statuses (#33). */
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

	const assignmentRow = rowOr404(
		await supabase
			.from('homework_assignments')
			.select(ASSIGNMENT_COLUMNS)
			.eq('id', params.assignmentId)
			.eq('class_id', params.id)
			.maybeSingle(),
		HOMEWORK_MESSAGES
	);

	const [{ data: studentRows, error: studentsError }, details] = await Promise.all([
		supabase
			.from('profiles')
			.select('id, display_name, registration_name')
			.eq('class_id', params.id)
			.eq('role', 'student')
			.eq('status', 'approved'),
		fetchInstancesAndHistory(supabase, [assignmentRow.id])
	]);

	const studentNameById = new Map(
		(studentRows ?? []).map((s) => [s.id, s.display_name ?? s.registration_name ?? s.id])
	);
	const today = new Date().toISOString().slice(0, 10);
	const [assignment] = buildAssignmentViews(
		[assignmentRow as AssignmentRow],
		details.instances,
		details.history,
		studentNameById,
		today
	);

	return {
		class: cls,
		assignment,
		today,
		loadError: Boolean(studentsError || details.error)
	};
};

export const actions: Actions = {
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
