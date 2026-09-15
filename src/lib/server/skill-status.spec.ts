import { describe, expect, it } from 'vitest';
import { pickCurrentSkillStatuses, type SkillHistoryRow } from './skill-status';

function row(overrides: Partial<SkillHistoryRow> & Pick<SkillHistoryRow, 'id'>): SkillHistoryRow {
	return {
		studentId: 'student-1',
		skillArea: 'language',
		level: 'not_started',
		notes: null,
		recordedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('pickCurrentSkillStatuses', () => {
	it('picks the newest entry per (student_id, skill_area) from a newest-first fixture', () => {
		// Same (student, skill_area) as three history rows, newest-first --
		// exactly the shape +page.server.ts's load() passes in after ordering
		// by recorded_at desc.
		const rows: SkillHistoryRow[] = [
			row({ id: 'c', level: 'confident', recordedAt: '2026-09-15T10:00:00.000Z' }),
			row({ id: 'b', level: 'learning', recordedAt: '2026-09-08T10:00:00.000Z' }),
			row({ id: 'a', level: 'not_started', recordedAt: '2026-09-01T10:00:00.000Z' })
		];

		const current = pickCurrentSkillStatuses(rows);

		expect(current['student-1:language'].id).toBe('c');
		expect(current['student-1:language'].level).toBe('confident');
	});

	it('keeps every (student, skill_area) pair independent -- multiple students and skill areas each get their own current entry', () => {
		const rows: SkillHistoryRow[] = [
			row({ id: 's1-lang-new', studentId: 'student-1', skillArea: 'language', level: 'confident' }),
			row({ id: 's1-lang-old', studentId: 'student-1', skillArea: 'language', level: 'learning' }),
			row({ id: 's1-song-new', studentId: 'student-1', skillArea: 'song', level: 'learning' }),
			row({
				id: 's2-lang-new',
				studentId: 'student-2',
				skillArea: 'language',
				level: 'not_started'
			})
		];

		const current = pickCurrentSkillStatuses(rows);

		expect(Object.keys(current).sort()).toEqual(
			['student-1:language', 'student-1:song', 'student-2:language'].sort()
		);
		expect(current['student-1:language'].id).toBe('s1-lang-new');
		expect(current['student-1:song'].id).toBe('s1-song-new');
		expect(current['student-2:language'].id).toBe('s2-lang-new');
	});

	it('a last-wins (inverted) dedup guard would fail this: the first row per key in the fixture must win, not the last', () => {
		// Regression guard for the exact bug class this was extracted to catch
		// -- if `pickCurrentSkillStatuses` were changed to always overwrite
		// (i.e. last-occurrence-wins instead of first-occurrence-wins), this
		// assertion flips and fails, because the fixture's *oldest* row (id
		// 'oldest') is listed last.
		const rows: SkillHistoryRow[] = [
			row({ id: 'newest', level: 'confident', recordedAt: '2026-09-15T00:00:00.000Z' }),
			row({ id: 'oldest', level: 'not_started', recordedAt: '2026-01-01T00:00:00.000Z' })
		];

		const current = pickCurrentSkillStatuses(rows);

		expect(current['student-1:language'].id).toBe('newest');
		expect(current['student-1:language'].id).not.toBe('oldest');
	});

	it('returns an empty object for no rows', () => {
		expect(pickCurrentSkillStatuses([])).toEqual({});
	});
});
