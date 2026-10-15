import { describe, expect, it } from 'vitest';
import { shapeStudentBadges, type StudentBadgeRow } from './badges';

describe('shapeStudentBadges', () => {
	it('returns an empty list for a null rows result (not a load error -- the caller tracks that separately)', () => {
		expect(shapeStudentBadges(null)).toEqual([]);
	});

	it('returns an empty list for a student who has never crossed a milestone -- a legitimate "no badges yet" state', () => {
		expect(shapeStudentBadges([])).toEqual([]);
	});

	it('shapes populated rows, mapping snake_case columns to the camelCase view model', () => {
		const rows: StudentBadgeRow[] = [
			{
				badge_subject: 'dance',
				badge_type: 'attendance',
				milestone: 5,
				earned_at: '2026-09-14T00:00:00.000Z'
			},
			{
				badge_subject: 'language',
				badge_type: 'homework',
				milestone: 1,
				earned_at: '2026-09-10T00:00:00.000Z'
			}
		];

		const result = shapeStudentBadges(rows);

		expect(result).toEqual([
			{
				subject: 'dance',
				badgeType: 'attendance',
				milestone: 5,
				earnedAt: '2026-09-14T00:00:00.000Z'
			},
			{
				subject: 'language',
				badgeType: 'homework',
				milestone: 1,
				earnedAt: '2026-09-10T00:00:00.000Z'
			}
		]);
	});

	it('throws on an unrecognized badge_type instead of silently guessing one', () => {
		const rows: StudentBadgeRow[] = [
			{
				badge_subject: 'dance',
				badge_type: 'not-a-real-type',
				milestone: 1,
				earned_at: '2026-09-10T00:00:00.000Z'
			}
		];

		expect(() => shapeStudentBadges(rows)).toThrow(/Unrecognized badge_type/);
	});

	it('throws on an unrecognized badge_subject instead of silently guessing one', () => {
		const rows: StudentBadgeRow[] = [
			{
				badge_subject: 'song',
				badge_type: 'attendance',
				milestone: 1,
				earned_at: '2026-09-10T00:00:00.000Z'
			}
		];

		expect(() => shapeStudentBadges(rows)).toThrow(/Unrecognized badge_subject/);
	});
});
