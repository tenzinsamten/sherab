import { redirect } from '@sveltejs/kit';
import { shapeTeamLeaderboard } from '$lib/server/leaderboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	// No role gate beyond being signed in (Code Map) -- unlike student/
	// +page.server.ts's student-only redirect, this route is reachable by
	// any authenticated role (student/teacher/admin), matching the Always
	// boundary: "no team-scoped restriction, since the leaderboard is meant
	// to be visible to every authenticated role within the school." Unlike
	// most other routes in this codebase, the `safeGetSession()` redirect
	// above is the real barrier here, not UX-only scaffolding in front of a
	// DB-enforced one: this project's default privileges grant EXECUTE on
	// team_leaderboard() to anon too regardless of its explicit `grant ...
	// to authenticated` (see 0009_leaderboard.sql's comment), so an
	// unauthenticated caller is kept out by this redirect alone.
	const { data: rows, error: rpcError } = await supabase.rpc('team_leaderboard');

	const teams = shapeTeamLeaderboard(rows);

	return {
		teams,
		loadError: Boolean(rpcError)
	};
};
