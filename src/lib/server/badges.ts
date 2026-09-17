export type StudentBadge = {
	badgeType: 'attendance' | 'homework';
	milestone: number;
	earnedAt: string;
};

export type StudentBadgeRow = {
	badge_type: string;
	milestone: number;
	earned_at: string;
};

/**
 * Shapes a `badges_earned` read into the route's `StudentBadge[]` view
 * model, mirroring `shapeStudentStreak`'s exact shape. `rows` is `[]` (never
 * `null`) for a student who has never crossed a milestone (Story 4-2:
 * trigger-written only, AD-3) -- a legitimate "no badges yet" state, not a
 * load error, so this always returns an array rather than something a
 * caller could confuse with a genuine failed fetch.
 */
export function shapeStudentBadges(rows: StudentBadgeRow[] | null): StudentBadge[] {
	if (!rows) return [];
	return rows.map((row) => {
		if (row.badge_type !== 'attendance' && row.badge_type !== 'homework') {
			// Never silently guessed -- the DB check constraint already limits
			// badge_type to these two values, so anything else here means the
			// schema and this shaping function have drifted out of sync, which
			// must surface loudly rather than mislabel a row.
			throw new Error(`Unrecognized badge_type: ${row.badge_type}`);
		}
		return {
			badgeType: row.badge_type,
			milestone: row.milestone,
			earnedAt: row.earned_at
		};
	});
}
