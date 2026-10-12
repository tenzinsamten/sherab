import { error, redirect } from '@sveltejs/kit';
import { TEAM_MESSAGES } from '$lib/server/class-access';
import { pickLocalized } from '$lib/localized-name';
import type { PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What team_students() raises for a caller who may not see the team (0041). */
const NOT_ALLOWED_CODE = '42501';

/**
 * A team's students, by name (#97). Any signed-in role reaches this route;
 * who gets the list is decided by team_students() (0041): the admin,
 * teachers, approved students, and an approved parent for a team one of
 * their approved children is in. A refusal and an unknown team both answer
 * "not found", so the page does not say which teams exist.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, '/login');
	}

	// A malformed id would be a database cast error, not "no rows".
	if (!UUID.test(params.teamId)) {
		throw error(404, TEAM_MESSAGES.notFound);
	}

	const { data: rows, error: rpcError } = await supabase.rpc('team_students', {
		p_team_id: params.teamId
	});

	if (rpcError?.code === NOT_ALLOWED_CODE) {
		throw error(404, TEAM_MESSAGES.notFound);
	}
	if (rpcError) {
		console.error(`${TEAM_MESSAGES.failed} ${rpcError.message}`);
		throw error(500, TEAM_MESSAGES.failed);
	}
	// No row: no such team (a team without students still gives one row).
	if (!rows?.length) {
		throw error(404, TEAM_MESSAGES.notFound);
	}

	const [team] = rows;
	return {
		team: { name: pickLocalized(team.team_name, team.team_name_bo, team.team_name_de) },
		// Sorted by name in the database; the empty team's one row has no name.
		students: rows.flatMap((row) => (row.student_name === null ? [] : [row.student_name]))
	};
};
