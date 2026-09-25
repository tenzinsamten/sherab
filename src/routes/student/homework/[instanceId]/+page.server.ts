import { redirect } from '@sveltejs/kit';
import { HOMEWORK_MESSAGES, rowOr404 } from '$lib/server/class-access';
import { buildHomeworkProgress } from '$lib/server/homework-status';
import { markHomeworkDone, toItem } from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

/** One homework for the student (#43): description, links and the Done action. */
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	// RLS (homework_instances_select_admin_teacher_or_targeted_student) only
	// returns an instance the student was given, so anything else is a 404.
	const instance = rowOr404(
		await supabase
			.from('homework_instances')
			.select('id, assignment_id, class_id, due_date, archived_at')
			.eq('id', params.instanceId)
			.maybeSingle(),
		HOMEWORK_MESSAGES
	);

	const [assignmentResult, { data: historyRows, error: historyError }, { data: cls }] =
		await Promise.all([
			supabase
				.from('homework_assignments')
				.select('id, title, skill_area, description, reference_links, recurrence_rule')
				.eq('id', instance.assignment_id)
				.maybeSingle(),
			supabase
				.from('homework_status_history')
				.select('id, instance_id, student_id, status, recorded_by, recorded_at')
				.eq('instance_id', instance.id)
				.eq('student_id', user.id),
			// Hidden by RLS once the student has left the class (#42).
			supabase.from('classes').select('name').eq('id', instance.class_id).maybeSingle()
		]);
	const assignment = rowOr404(assignmentResult, HOMEWORK_MESSAGES);

	const progress = buildHomeworkProgress(
		(historyRows ?? []).map((r) => ({
			id: r.id,
			instanceId: r.instance_id,
			studentId: r.student_id,
			status: r.status,
			recordedBy: r.recorded_by,
			recordedAt: r.recorded_at
		}))
	);
	const entry = progress[`${instance.id}:${user.id}`] ?? {
		instanceId: instance.id,
		studentId: user.id,
		assignedAt: null,
		doneAt: null,
		reviewedAt: null
	};
	const today = new Date().toISOString().slice(0, 10);

	return {
		item: toItem(instance, assignment, entry, today),
		className: cls?.name ?? null,
		archived: instance.archived_at !== null,
		loadError: Boolean(historyError)
	};
};

export const actions: Actions = {
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return markHomeworkDone({ request, supabase, user });
	}
};
