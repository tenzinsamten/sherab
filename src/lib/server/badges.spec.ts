import { describe, expect, it } from 'vitest';
import {
	BADGE_ICON_MILESTONES,
	badgeIconPath,
	shapeBadgeProgress,
	shapeStudentBadges,
	type StudentBadgeRow
} from './badges';

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
				subject: 'language',
				badgeType: 'homework',
				milestone: 1,
				earnedAt: '2026-09-10T00:00:00.000Z',
				icon: '/badges/language-homework-1.svg'
			},
			{
				subject: 'dance',
				badgeType: 'attendance',
				milestone: 5,
				earnedAt: '2026-09-14T00:00:00.000Z',
				icon: '/badges/dance-attendance-5.svg'
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

	it('orders by subject (language, dance, instrument), then attendance before homework, then milestone', () => {
		const row = (badge_subject: string, badge_type: string, milestone: number) => ({
			badge_subject,
			badge_type,
			milestone,
			earned_at: '2026-10-01T00:00:00Z'
		});
		// The query's alphabetical order: dance, instrument, language.
		const result = shapeStudentBadges([
			row('dance', 'attendance', 5),
			row('dance', 'attendance', 1),
			row('dance', 'homework', 1),
			row('instrument', 'attendance', 1),
			row('language', 'homework', 1),
			row('language', 'attendance', 10)
		]);
		expect(result.map((b) => `${b.subject}-${b.badgeType}-${b.milestone}`)).toEqual([
			'language-attendance-10',
			'language-homework-1',
			'dance-attendance-1',
			'dance-attendance-5',
			'dance-homework-1',
			'instrument-attendance-1'
		]);
	});

	it('matrix: dance attendance 1, 5 and language homework 1 give three icons in order', () => {
		const result = shapeStudentBadges([
			{ badge_subject: 'dance', badge_type: 'attendance', milestone: 1, earned_at: 'x' },
			{ badge_subject: 'dance', badge_type: 'attendance', milestone: 5, earned_at: 'x' },
			{ badge_subject: 'language', badge_type: 'homework', milestone: 1, earned_at: 'x' }
		]);
		expect(result.map((b) => b.icon)).toEqual([
			'/badges/language-homework-1.svg',
			'/badges/dance-attendance-1.svg',
			'/badges/dance-attendance-5.svg'
		]);
	});

	it('a milestone with no icon has icon null (trophy pill)', () => {
		const [badge] = shapeStudentBadges([
			{ badge_subject: 'dance', badge_type: 'homework', milestone: 7, earned_at: 'x' }
		]);
		expect(badge).toEqual({
			subject: 'dance',
			badgeType: 'homework',
			milestone: 7,
			earnedAt: 'x',
			icon: null
		});
	});
});

describe('badgeIconPath', () => {
	it('every subject, type and icon milestone maps to its file (36 icons)', () => {
		const paths = new Set<string>();
		for (const subject of ['language', 'dance', 'instrument'] as const) {
			for (const badgeType of ['attendance', 'homework'] as const) {
				for (const milestone of BADGE_ICON_MILESTONES) {
					const path = badgeIconPath({ subject, badgeType, milestone });
					expect(path).toBe(`/badges/${subject}-${badgeType}-${milestone}.svg`);
					paths.add(path!);
				}
			}
		}
		expect(paths.size).toBe(36);
	});

	it.each([0, 2, 7, 11, 200])('milestone %i has no icon', (milestone) => {
		expect(badgeIconPath({ subject: 'dance', badgeType: 'attendance', milestone })).toBeNull();
	});
});

describe('shapeBadgeProgress', () => {
	it('returns an empty list for null or no rows (no subject set)', () => {
		expect(shapeBadgeProgress(null)).toEqual([]);
		expect(shapeBadgeProgress([])).toEqual([]);
	});

	it('groups both tracks per subject in subject order, keeping zero totals and a null top', () => {
		expect(
			shapeBadgeProgress([
				{ subject: 'dance', badge_type: 'attendance', total: 7, next_milestone: 10 },
				{ subject: 'dance', badge_type: 'homework', total: 0, next_milestone: 1 },
				{ subject: 'language', badge_type: 'attendance', total: 120, next_milestone: null },
				{ subject: 'language', badge_type: 'homework', total: 0, next_milestone: 1 }
			])
		).toEqual([
			{
				subject: 'language',
				attendance: { total: 120, next: null },
				homework: { total: 0, next: 1 }
			},
			{
				subject: 'dance',
				attendance: { total: 7, next: 10 },
				homework: { total: 0, next: 1 }
			}
		]);
	});

	it('throws on an unrecognized subject or type', () => {
		expect(() =>
			shapeBadgeProgress([
				{ subject: 'song', badge_type: 'attendance', total: 1, next_milestone: 5 }
			])
		).toThrow(/Unrecognized badge_subject/);
		expect(() =>
			shapeBadgeProgress([{ subject: 'dance', badge_type: 'skill', total: 1, next_milestone: 5 }])
		).toThrow(/Unrecognized badge_type/);
	});
});
