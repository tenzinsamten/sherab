import { describe, expect, it, vi } from 'vitest';
import {
	BADGE_ICON_MILESTONES,
	badgeIconPath,
	loadBadgePage,
	parseBadgeMilestones,
	shapeBadgePage,
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

describe('parseBadgeMilestones', () => {
	it('reads the setting as ascending positive integers', () => {
		expect(parseBadgeMilestones([10, 1, 5, 5])).toEqual([1, 5, 10]);
	});

	it.each([[null], [{}], [[]], [['a', -1, 2.5]]])(
		'falls back to the database default for %j',
		(value) => {
			expect(parseBadgeMilestones(value)).toEqual([1, 5, 10, 25, 50, 100]);
		}
	);
});

type Fake = {
	badges?: { data: unknown; error: unknown };
	progress?: { data: unknown; error: unknown };
	setting?: { data: unknown; error: unknown };
};

/** A fake client answering the three reads of loadBadgePage; `calls` records filters. */
function fakeClient(opts: Fake) {
	const calls: { table: string; method: string; args: unknown[] }[] = [];
	const rpc = vi.fn(async () => opts.progress ?? { data: [], error: null });
	const from = (table: string) => {
		const result =
			table === 'badges_earned'
				? (opts.badges ?? { data: [], error: null })
				: (opts.setting ?? { data: { value: [1, 5, 10, 25, 50, 100] }, error: null });
		const c: Record<string, unknown> = {};
		for (const method of ['select', 'eq', 'order']) {
			c[method] = (...args: unknown[]) => {
				calls.push({ table, method, args });
				return c;
			};
		}
		c.maybeSingle = async () => result;
		c.then = (resolve: (value: unknown) => unknown) => resolve(result);
		return c;
	};
	return { calls, rpc, client: { from, rpc } as unknown as Parameters<typeof loadBadgePage>[0] };
}

const progressRow = (subject: string, badge_type: string, total: number, next: number | null) => ({
	subject,
	badge_type,
	total,
	next_milestone: next
});

describe('shapeBadgePage / loadBadgePage', () => {
	const STUDENT = 's1';

	it('lists every milestone of each progress subject, earned with dates and locked with null', async () => {
		const fake = fakeClient({
			badges: {
				data: [
					{
						badge_subject: 'dance',
						badge_type: 'attendance',
						milestone: 5,
						earned_at: '2026-09-20T10:00:00Z'
					},
					{
						badge_subject: 'dance',
						badge_type: 'attendance',
						milestone: 1,
						earned_at: '2026-09-06T10:00:00Z'
					}
				],
				error: null
			},
			progress: {
				data: [
					progressRow('dance', 'attendance', 7, 10),
					progressRow('dance', 'homework', 0, 1),
					progressRow('language', 'attendance', 0, 1),
					progressRow('language', 'homework', 0, 1)
				],
				error: null
			}
		});

		const { sections, loadError } = await loadBadgePage(fake.client, STUDENT);

		expect(loadError).toBe(false);
		expect(fake.rpc).toHaveBeenCalledWith('badge_progress', { p_student_id: STUDENT });
		expect(fake.calls).toContainEqual({
			table: 'badges_earned',
			method: 'eq',
			args: ['student_id', STUDENT]
		});
		expect(fake.calls).toContainEqual({
			table: 'app_settings',
			method: 'eq',
			args: ['key', 'badge_milestone_thresholds']
		});
		// Language before dance, no instrument; attendance before homework.
		expect(sections.map((s) => s.subject)).toEqual(['language', 'dance']);
		expect(sections[1].tracks.map((t) => t.type)).toEqual(['attendance', 'homework']);
		const all = sections.flatMap((s) => s.tracks.flatMap((t) => t.badges));
		expect(all).toHaveLength(24);
		expect(all.filter((b) => b.earnedAt)).toHaveLength(2);

		const danceAttendance = sections[1].tracks[0];
		expect(danceAttendance).toMatchObject({ type: 'attendance', total: 7, next: 10 });
		expect(danceAttendance.badges.map((b) => b.milestone)).toEqual([1, 5, 10, 25, 50, 100]);
		expect(danceAttendance.badges[0]).toEqual({
			milestone: 1,
			icon: '/badges/dance-attendance-1.svg',
			earnedAt: '2026-09-06T10:00:00Z'
		});
		expect(danceAttendance.badges[2]).toEqual({
			milestone: 10,
			icon: '/badges/dance-attendance-10.svg',
			earnedAt: null
		});
	});

	it('keeps a subject the student left when they hold a badge in it, with no known count', () => {
		const sections = shapeBadgePage(
			[
				{
					subject: 'instrument',
					badgeType: 'homework',
					milestone: 1,
					earnedAt: '2026-05-01T00:00:00Z',
					icon: '/badges/instrument-homework-1.svg'
				}
			],
			[
				{
					subject: 'language',
					attendance: { total: 0, next: 1 },
					homework: { total: 0, next: 1 }
				}
			],
			[1, 5, 10, 25, 50, 100]
		);

		expect(sections.map((s) => s.subject)).toEqual(['language', 'instrument']);
		const instrument = sections[1];
		expect(instrument.tracks.flatMap((t) => t.badges)).toHaveLength(12);
		expect(instrument.tracks[1]).toMatchObject({ type: 'homework', total: null, next: null });
		expect(instrument.tracks[1].badges[0].earnedAt).toBe('2026-05-01T00:00:00Z');
	});

	it('uses the configured milestones, keeping an earned one no longer configured; no icon means null', () => {
		const [section] = shapeBadgePage(
			[
				{
					subject: 'dance',
					badgeType: 'homework',
					milestone: 5,
					earnedAt: '2026-05-01T00:00:00Z',
					icon: '/badges/dance-homework-5.svg'
				}
			],
			[{ subject: 'dance', attendance: { total: 0, next: 3 }, homework: { total: 5, next: 7 } }],
			[3, 7]
		);
		expect(section.tracks[0].badges.map((b) => b.milestone)).toEqual([3, 7]);
		expect(section.tracks[1].badges.map((b) => [b.milestone, b.icon])).toEqual([
			[3, null],
			[5, '/badges/dance-homework-5.svg'],
			[7, null]
		]);
	});

	it('shows every badge as locked for a student with no badges yet', () => {
		const sections = shapeBadgePage(
			[],
			[{ subject: 'dance', attendance: { total: 0, next: 1 }, homework: { total: 0, next: 1 } }],
			[1, 5, 10, 25, 50, 100]
		);
		const all = sections.flatMap((s) => s.tracks.flatMap((t) => t.badges));
		expect(all).toHaveLength(12);
		expect(all.every((b) => b.earnedAt === null)).toBe(true);
	});

	it('is empty for a student with no subjects and no badges', async () => {
		const fake = fakeClient({});
		expect(await loadBadgePage(fake.client, STUDENT)).toEqual({ sections: [], loadError: false });
	});

	it('falls back to the default milestones when the setting row is missing', async () => {
		const fake = fakeClient({
			setting: { data: null, error: null },
			progress: { data: [progressRow('language', 'attendance', 0, 1)], error: null }
		});
		const { sections } = await loadBadgePage(fake.client, STUDENT);
		expect(sections[0].tracks[0].badges.map((b) => b.milestone)).toEqual([1, 5, 10, 25, 50, 100]);
	});

	it.each([
		['badges', { badges: { data: null, error: { message: 'x' } } }],
		['progress', { progress: { data: null, error: { message: 'x' } } }],
		['setting', { setting: { data: null, error: { message: 'x' } } }]
	] as [string, Fake][])(
		'a failed %s read is a load error, not an empty page',
		async (_l, opts) => {
			const fake = fakeClient({
				progress: { data: [progressRow('language', 'attendance', 0, 1)], error: null },
				...opts
			});
			expect(await loadBadgePage(fake.client, STUDENT)).toEqual({ sections: [], loadError: true });
		}
	);
});
