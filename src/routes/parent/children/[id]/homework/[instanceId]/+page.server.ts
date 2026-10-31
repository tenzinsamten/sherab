import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { localizedName } from '$lib/localized-name';
import { todayInBerlin } from '$lib/berlin-date';
import { HOMEWORK_MESSAGES, rowOr404 } from '$lib/server/class-access';
import { loadHomeworkFiles } from '$lib/server/homework-files';
import { buildHomeworkProgress } from '$lib/server/homework-status';
import { loadLinkedChild } from '$lib/server/linked-child';
import { markHomeworkDone, STUDENT_ASSIGNMENT_COLUMNS, toItem } from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * spec-parent-managed-homework story 3 (CAP-3): one homework of a linked
 * child, as the student's own detail page shows it, plus Mark done when the
 * child is parent-managed. Status comes from the child's history rows.
 * RLS also lets a parent read a sibling's instances, so an instance without
 * a history row for *this* child is a 404.
 */
export const load: PageServerLoad = async ({ params, parent, locals: { supabase } }) => {
	const { parentStatus } = await parent();
	const child = await loadLinkedChild(supabase, parentStatus, params.id);
	if (!UUID_PATTERN.test(params.instanceId)) {
		throw error(404, HOMEWORK_MESSAGES.notFound);
	}

	const instance = rowOr404(
		await supabase
			.from('homework_instances')
			.select('id, assignment_id, class_id, due_date, archived_at')
			.eq('id', params.instanceId)
			.maybeSingle(),
		HOMEWORK_MESSAGES
	);

	const [
		assignmentResult,
		{ data: historyRows, error: historyError },
		{ data: cls },
		{ data: profile },
		homeworkFiles
	] = await Promise.all([
		supabase
			.from('homework_assignments')
			.select(STUDENT_ASSIGNMENT_COLUMNS)
			.eq('id', instance.assignment_id)
			.maybeSingle(),
		supabase
			.from('homework_status_history')
			.select('id, instance_id, student_id, status, recorded_by, recorded_at')
			.eq('instance_id', instance.id)
			.eq('student_id', child.id),
		supabase
			.from('classes')
			.select('name, name_bo, name_de')
			.eq('id', instance.class_id)
			.maybeSingle(),
		supabase.from('profiles').select('parent_managed').eq('id', child.id).maybeSingle(),
		loadHomeworkFiles(supabase, [instance.assignment_id])
	]);

	// Without the child's history we cannot tell this item is theirs (and
	// not a sibling's): fail rather than show it under the wrong child.
	if (historyError) {
		console.error(`${HOMEWORK_MESSAGES.failed} ${historyError.message}`);
		throw error(500, HOMEWORK_MESSAGES.failed);
	}
	if (!historyRows || historyRows.length === 0) {
		throw error(404, HOMEWORK_MESSAGES.notFound);
	}
	const assignment = rowOr404(assignmentResult, HOMEWORK_MESSAGES);

	const progress = buildHomeworkProgress(
		historyRows.map((r) => ({
			id: r.id,
			instanceId: r.instance_id,
			studentId: r.student_id,
			status: r.status,
			recordedBy: r.recorded_by,
			recordedAt: r.recorded_at
		}))
	);
	const entry = progress[`${instance.id}:${child.id}`] ?? {
		instanceId: instance.id,
		studentId: child.id,
		assignedAt: null,
		doneAt: null,
		reviewedAt: null
	};
	const today = todayInBerlin();

	return {
		child,
		item: toItem(instance, assignment, entry, today),
		className: cls ? localizedName(cls) : null,
		files: homeworkFiles.files.get(instance.assignment_id) ?? [],
		archived: instance.archived_at !== null,
		parentManaged: profile?.parent_managed === true,
		loadError: Boolean(homeworkFiles.error)
	};
};

export const actions: Actions = {
	/**
	 * The child page's markDone (story 2): the student's markHomeworkDone with
	 * the child's id; RLS refuses it unless the child is parent-managed and
	 * linked to the caller (42501 -> 403).
	 */
	markDone: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/login');
		if (!UUID_PATTERN.test(params.id)) {
			return fail(400, { error: m.student_homework_error_mark_failed() });
		}
		return markHomeworkDone({ request, supabase, user, studentId: params.id });
	}
};
