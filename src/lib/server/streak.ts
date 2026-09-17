export type StudentStreak = {
	currentStreak: number;
	lastQualifyingWeek: string | null;
};

export type StudentStreakRow = {
	current_streak: number;
	last_qualifying_week: string | null;
};

/**
 * Shapes a `student_streaks` read into the route's `StudentStreak` view
 * model. `row` is `null` for a student who has never triggered a recompute
 * (Story 4-1: trigger-written only, AD-3) -- a legitimate "no streak yet"
 * state, not a load error, so this returns `null` rather than a zeroed
 * object a caller could confuse with a genuine `current_streak = 0` row.
 */
export function shapeStudentStreak(row: StudentStreakRow | null): StudentStreak | null {
	if (!row) return null;
	return {
		currentStreak: row.current_streak,
		lastQualifyingWeek: row.last_qualifying_week
	};
}
