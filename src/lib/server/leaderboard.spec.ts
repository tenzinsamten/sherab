import { describe, expect, it } from 'vitest';
import { shapeTeamLeaderboard, type TeamRankRow } from './leaderboard';

describe('shapeTeamLeaderboard', () => {
	it('returns an empty list for a null rows result (RPC failure -- the caller tracks that separately as loadError)', () => {
		expect(shapeTeamLeaderboard(null)).toEqual([]);
	});

	it('returns an empty list when no teams exist at all -- a legitimate empty state, not an error', () => {
		expect(shapeTeamLeaderboard([])).toEqual([]);
	});

	it('shapes populated rows, mapping snake_case columns to the camelCase view model, including a zero-total team', () => {
		const rows: TeamRankRow[] = [
			{ team_id: 'team-1', team_name: 'Snow Lions', total_streak: 8 },
			{ team_id: 'team-2', team_name: 'Yaks', total_streak: 0 }
		];

		const result = shapeTeamLeaderboard(rows);

		expect(result).toEqual([
			{ teamId: 'team-1', teamName: 'Snow Lions', totalStreak: 8 },
			{ teamId: 'team-2', teamName: 'Yaks', totalStreak: 0 }
		]);
	});
});
