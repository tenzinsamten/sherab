export type TeamRank = {
	teamId: string;
	teamName: string;
	totalStreak: number;
};

export type TeamRankRow = {
	team_id: string;
	team_name: string;
	total_streak: number;
};

/**
 * Shapes a `team_leaderboard()` RPC read into the route's `TeamRank[]` view
 * model, mirroring `shapeStudentStreak`/`shapeStudentBadges`'s exact shape
 * (explicit null/empty handling, not conflated with a load error). `rows` is
 * `null` on an RPC failure (the caller tracks that separately as
 * `loadError`) or `[]` when no teams exist at all (Story 4-3 I/O matrix:
 * "No teams exist at all" -- an empty-state, not an error) -- both resolve
 * to an empty array here, since the route distinguishes them via its own
 * `error` check, not via this function's return value.
 */
export function shapeTeamLeaderboard(rows: TeamRankRow[] | null): TeamRank[] {
	if (!rows) return [];
	return rows.map((row) => ({
		teamId: row.team_id,
		teamName: row.team_name,
		totalStreak: row.total_streak
	}));
}
