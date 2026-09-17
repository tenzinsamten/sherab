import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import {
	buildHomeworkProgress,
	isOverdue,
	type HomeworkHistoryRow
} from '$lib/server/homework-status';
import { shapeStudentBadges } from '$lib/server/badges';
import { shapeStudentStreak } from '$lib/server/streak';
import type { SkillArea } from '$lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

const DEFAULT_LOOKAHEAD_DAYS = 14;

type HomeworkListItem = {
	instanceId: string;
	assignmentId: string;
	title: string;
	skillArea: SkillArea;
	referenceLink: string | null;
	dueDate: string;
	status: 'assigned' | 'done' | 'reviewed';
	overdue: boolean;
	isRecurring: boolean;
};

function addDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	// This route is student-facing only (Code Map) -- a non-student who
	// somehow lands here (e.g. a stale bookmark) is sent home rather than
	// shown an empty homework list. RLS would return nothing useful to them
	// here regardless (homework_status_history's select policy only exposes
	// rows where student_id = auth.uid()), so this is UX-only, not the real
	// barrier (AD-2).
	if (!profile || profile.role !== 'student') {
		throw redirect(303, '/');
	}

	// Admin-tunable, not hardcoded (Epic 3 context / ARCHITECTURE-SPINE.md
	// Consistency Conventions): "current + next period" defaults to two
	// weeks but is read from app_settings so it can widen later without a
	// structural change.
	const { data: settingRow } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'homework_lookahead_days')
		.maybeSingle();
	const lookaheadDays =
		settingRow && typeof settingRow.value === 'object' && settingRow.value !== null
			? Number((settingRow.value as { days?: unknown }).days)
			: NaN;
	const effectiveLookaheadDays = Number.isFinite(lookaheadDays)
		? lookaheadDays
		: DEFAULT_LOOKAHEAD_DAYS;

	const today = new Date().toISOString().slice(0, 10);
	const cutoffDate = addDays(today, effectiveLookaheadDays);

	// RLS (homework_status_history_select_admin_teacher_or_own) scopes this
	// to the caller's own rows -- the explicit .eq is belt-and-suspenders,
	// matching the pattern already used throughout this codebase.
	const { data: historyRows, error: historyError } = await supabase
		.from('homework_status_history')
		.select('id, instance_id, student_id, status, recorded_by, recorded_at')
		.eq('student_id', user.id);

	const history: HomeworkHistoryRow[] = (historyRows ?? []).map((r) => ({
		id: r.id,
		instanceId: r.instance_id,
		studentId: r.student_id,
		status: r.status,
		recordedBy: r.recorded_by,
		recordedAt: r.recorded_at
	}));

	const progress = buildHomeworkProgress(history);
	const instanceIds = Array.from(new Set(history.map((r) => r.instanceId)));

	let instances: {
		id: string;
		assignment_id: string;
		due_date: string;
		archived_at: string | null;
	}[] = [];
	let instancesError = false;
	if (instanceIds.length > 0) {
		const { data, error: instErr } = await supabase
			.from('homework_instances')
			.select('id, assignment_id, due_date, archived_at')
			.in('id', instanceIds)
			// Overdue items never auto-hide (Boundaries), but they also never
			// need to be shown further out than the look-ahead cutoff -- today
			// is always <= cutoffDate, so this single filter covers both "due
			// soon" and "already overdue" without a separate OR clause.
			.lte('due_date', cutoffDate)
			.is('archived_at', null);
		instances = data ?? [];
		instancesError = Boolean(instErr);
	}

	const assignmentIds = Array.from(new Set(instances.map((i) => i.assignment_id)));

	let assignments: {
		id: string;
		title: string;
		skill_area: SkillArea;
		reference_link: string | null;
		recurrence_rule: unknown | null;
	}[] = [];
	let assignmentsError = false;
	if (assignmentIds.length > 0) {
		const { data, error: assignErr } = await supabase
			.from('homework_assignments')
			.select('id, title, skill_area, reference_link, recurrence_rule')
			.in('id', assignmentIds);
		assignments = data ?? [];
		assignmentsError = Boolean(assignErr);
	}
	const assignmentById = new Map(assignments.map((a) => [a.id, a]));

	const items: HomeworkListItem[] = instances
		.map((instance) => {
			const assignment = assignmentById.get(instance.assignment_id);
			if (!assignment) return null;

			const entry = progress[`${instance.id}:${user.id}`];
			if (!entry) return null;

			const status: HomeworkListItem['status'] = entry.reviewedAt
				? 'reviewed'
				: entry.doneAt
					? 'done'
					: 'assigned';

			return {
				instanceId: instance.id,
				assignmentId: assignment.id,
				title: assignment.title,
				skillArea: assignment.skill_area,
				referenceLink: assignment.reference_link,
				dueDate: instance.due_date,
				status,
				overdue: isOverdue(instance.due_date, entry, today),
				isRecurring: assignment.recurrence_rule !== null
			};
		})
		.filter((item): item is HomeworkListItem => item !== null)
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

	// Story 4-1: student_streaks is trigger-written only (AD-3) -- this is a
	// plain read, scoped by RLS (student_streaks_select_admin_teacher_or_own)
	// to the caller's own row; the explicit .eq is belt-and-suspenders,
	// matching the pattern already used throughout this codebase. A student
	// with no row yet (never triggered a recompute) is a legitimate "no
	// streak yet" state, not a load error.
	const { data: streakRow, error: streakError } = await supabase
		.from('student_streaks')
		.select('current_streak, last_qualifying_week')
		.eq('student_id', user.id)
		.maybeSingle();

	const streak = shapeStudentStreak(streakRow);

	// Story 4-2: badges_earned is trigger-written only (AD-3) -- this is a
	// plain list read (not .maybeSingle(), a student can hold many badge
	// rows), scoped by RLS (badges_earned_select_admin_or_own) to the
	// caller's own rows; the explicit .eq is belt-and-suspenders, matching
	// the pattern already used throughout this codebase. A student who has
	// never crossed a milestone legitimately has zero rows, not a load
	// error.
	const { data: badgeRows, error: badgesError } = await supabase
		.from('badges_earned')
		.select('badge_type, milestone, earned_at')
		.eq('student_id', user.id)
		.order('badge_type')
		.order('milestone', { ascending: true });

	const badges = shapeStudentBadges(badgeRows);

	return {
		items,
		streak,
		badges,
		loadError: Boolean(
			historyError || instancesError || assignmentsError || streakError || badgesError
		)
	};
};

export const actions: Actions = {
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
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
		// caller (i.e. they were targeted by it) before the insert below,
		// mirroring the "read first" shape used elsewhere in this codebase.
		// This also supplies class_id, which the insert needs.
		const { data: instance, error: instanceError } = await supabase
			.from('homework_instances')
			.select('id, class_id')
			.eq('id', instanceId)
			.single();

		if (instanceError || !instance) {
			return fail(400, { error: m.student_homework_error_not_found() });
		}

		// RLS (homework_status_history_insert_admin_teacher_or_self_done) is
		// the real barrier: requires a prior 'assigned' row targeting this
		// exact student for this exact instance -- an untargeted student's
		// attempt is rejected here regardless of how this form was reached
		// (I/O matrix: "Untargeted student attempts Done -> RLS rejects the
		// insert").
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

		return { success: true };
	}
};
