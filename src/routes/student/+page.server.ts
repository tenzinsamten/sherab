import { redirect } from '@sveltejs/kit';
import { shapeStudentBadges } from '$lib/server/badges';
import { shapeTeamLeaderboard } from '$lib/server/leaderboard';
import { shapeStudentStreak } from '$lib/server/streak';
import {
	loadStudentClasses,
	loadStudentHomework,
	markHomeworkDone,
	teamRank
} from '$lib/server/student-homework';
import type { Actions, PageServerLoad } from './$types';

/** How many upcoming homework the dashboard lists. */
const NEXT_DUE_COUNT = 3;

/**
 * Student dashboard (#46): homework tiles, streak and badges, team standing,
 * the next homework due, and a card per class. The student's landing page.
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

	const today = new Date().toISOString().slice(0, 10);
	const { classes, error: classesError } = await loadStudentClasses(supabase, user.id);

	// student_streaks / badges_earned are trigger-written (AD-3), read here
	// scoped by RLS to the caller's own rows; team_leaderboard() is readable
	// by every signed-in role (0009).
	const [
		homework,
		{ data: streakRow, error: streakError },
		{ data: badgeRows, error: badgesError },
		{ data: teamRows, error: teamError }
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
		supabase.rpc('team_leaderboard')
	]);

	const todoByClass = new Map<string, number>();
	for (const item of homework.items) {
		todoByClass.set(item.classId, (todoByClass.get(item.classId) ?? 0) + 1);
	}

	return {
		tiles: {
			todo: homework.counts.todo,
			overdue: homework.items.filter((i) => i.overdue).length,
			doneThisWeek: homework.doneThisWeek
		},
		team: teamRank(shapeTeamLeaderboard(teamRows), profile.team_id),
		streak: shapeStudentStreak(streakRow),
		badges: shapeStudentBadges(badgeRows),
		nextDue: homework.items.slice(0, NEXT_DUE_COUNT),
		classes: classes.map((c) => ({ ...c, todo: todoByClass.get(c.id) ?? 0 })),
		loadError: Boolean(classesError || homework.error || streakError || badgesError || teamError)
	};
};

export const actions: Actions = {
	markDone: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		return markHomeworkDone({ request, supabase, user });
	}
};
