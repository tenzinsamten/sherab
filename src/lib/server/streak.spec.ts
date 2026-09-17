import { describe, expect, it } from 'vitest';
import { shapeStudentStreak, type StudentStreakRow } from './streak';

describe('shapeStudentStreak', () => {
	it('returns null for a null row (student has never triggered a recompute -- not a load error)', () => {
		expect(shapeStudentStreak(null)).toBeNull();
	});

	it('shapes a zero-streak row into a non-null object -- distinct from "no row yet"', () => {
		const row: StudentStreakRow = { current_streak: 0, last_qualifying_week: null };

		const result = shapeStudentStreak(row);

		expect(result).not.toBeNull();
		expect(result).toEqual({ currentStreak: 0, lastQualifyingWeek: null });
	});

	it('shapes a positive-streak row, mapping snake_case columns to the camelCase view model', () => {
		const row: StudentStreakRow = { current_streak: 4, last_qualifying_week: '2026-09-14' };

		const result = shapeStudentStreak(row);

		expect(result).toEqual({ currentStreak: 4, lastQualifyingWeek: '2026-09-14' });
	});
});
