import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { todayInBerlin } from '$lib/berlin-date';
import { shapeStudentBadges } from '$lib/server/badges';
import { shapeTeamLeaderboard } from '$lib/server/leaderboard';
import { shapeStudentStreak } from '$lib/server/streak';
import {
	loadStudentClasses,
	loadStudentHomework,
	markHomeworkDone,
	teamRank
} from '$lib/server/student-homework';
import {
	MAX_JOIN_CODE_LENGTH,
	classJoinDismissErrorMessage,
	classJoinErrorMessage,
	type StudentJoinRequest
} from '$lib/server/class-join';
import type { Actions, PageServerLoad } from './$types';

/** How many upcoming homework the dashboard lists. */
const NEXT_DUE_COUNT = 3;

/**
 * Student dashboard (#46): homework tiles, streak and badges, team standing,
 * the next homework due, a card per class, and (#67) the "Join another
 * class" card with the student's pending / rejected join requests. The
 * student's landing page.
 */
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	const { data: profile } = await supabase
		.from('profiles')
		.select('role, team_id')
		.eq('id', user.id)
		.single();

	// Student-facing only (Code Map) -- UX, not the real barrier (AD-2).
	if (!profile || profile.role !== 'student') {
		throw redirect(303, '/');
	}

	const today = todayInBerlin();
	const { classes, error: classesError } = await loadStudentClasses(supabase, user.id);

	// student_streaks / badges_earned are trigger-written (AD-3), read here
	// scoped by RLS to the caller's own rows; team_leaderboard() is readable
	// by every signed-in role (0009).
	const [
		homework,
		{ data: streakRow, error: streakError },
		{ data: badgeRows, error: badgesError },
		{ data: teamRows, error: teamError },
		{ data: countRows, error: countsError },
		{ data: joinRows, error: joinError }
	] = await Promise.all([
		loadStudentHomework(supabase, user.id, {
			filter: 'todo',
			page: 1,
			enrolledClassIds: new Set(classes.map((c) => c.id)),
			today
		}),
		supabase
			.from('student_streaks')
			.select('current_streak, last_qualifying_week')
			.eq('student_id', user.id)
			.maybeSingle(),
		supabase
			.from('badges_earned')
			.select('badge_type, milestone, earned_at')
			.eq('student_id', user.id)
			.order('badge_type')
			.order('milestone', { ascending: true }),
		supabase.rpc('team_leaderboard'),
		// The one Open/Overdue count (Story 7-3), shared with the parent cards.
		supabase.rpc('homework_counts', { p_student_id: user.id }),
		// Pending and not-dismissed rejected requests, newest first (0031).
		supabase.rpc('my_class_join_requests')
	]);
	const counts = countRows?.[0];

	const todoByClass = new Map<string, number>();
	for (const item of homework.items) {
		todoByClass.set(item.classId, (todoByClass.get(item.classId) ?? 0) + 1);
	}

	return {
		tiles: {
			todo: counts?.open_count ?? 0,
			overdue: counts?.overdue_count ?? 0,
			doneThisWeek: homework.doneThisWeek
		},
		team: teamRank(shapeTeamLeaderboard(teamRows), profile.team_id),
		streak: shapeStudentStreak(streakRow),
		badges: shapeStudentBadges(badgeRows),
		nextDue: homework.items.slice(0, NEXT_DUE_COUNT),
		classes: classes.map((c) => ({ ...c, todo: todoByClass.get(c.id) ?? 0 })),
		joinRequests: (joinRows ?? []).map((r): StudentJoinRequest => ({
			id: r.id,
			className: r.class_name,
			status: r.status
		})),
		joinLoadError: Boolean(joinError),
		loadError: Boolean(
			classesError || homework.error || streakError || badgesError || teamError || countsError
		)
	};
};

export const actions: Actions = {
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return markHomeworkDone({ request, supabase, user });
	},

	/** #67: ask to join another class by its code (request_class_join, 0031). */
	requestJoin: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { joinError: m.student_homework_error_not_signed_in() });
		}
		const formData = await request.formData();
		const code = String(formData.get('code') ?? '')
			.trim()
			.toUpperCase();

		if (!code) {
			return fail(400, { joinError: m.student_join_error_code_required(), code });
		}
		// Far longer than any class code: the same answer as an unknown one.
		if (code.length > MAX_JOIN_CODE_LENGTH) {
			return fail(400, { joinError: m.student_join_error_invalid(), code });
		}

		const { data: className, error } = await supabase.rpc('request_class_join', { p_code: code });
		if (error) {
			return fail(400, { joinError: classJoinErrorMessage(error), code });
		}
		return { joinSent: className ?? code };
	},

	/** #67: hide a rejected request (dismiss_class_join, 0031). */
	dismissJoin: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { joinError: m.student_homework_error_not_signed_in() });
		}
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		if (!id) {
			return fail(400, { joinError: m.student_join_error_dismiss_failed() });
		}

		const { error } = await supabase.rpc('dismiss_class_join', { p_request_id: id });
		if (error) {
			return fail(400, { joinError: classJoinDismissErrorMessage(error) });
		}
		return { joinDismissed: true };
	}
};
