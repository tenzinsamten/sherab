import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BADGE_SUBJECTS,
	badgeIconPath,
	isBadgeSubject,
	type BadgeSubject
} from '$lib/badge-subject';
import type { Database } from '$lib/supabase/database.types';

export type BadgeType = 'attendance' | 'homework';

/** Attendance before homework, wherever badges are listed. */
const BADGE_TYPES: readonly BadgeType[] = ['attendance', 'homework'];

// Shared with the browser (the badges tile greys the next badge's icon).
export { BADGE_ICON_MILESTONES, badgeIconPath } from '$lib/badge-subject';

export type StudentBadge = {
	subject: BadgeSubject;
	badgeType: BadgeType;
	milestone: number;
	earnedAt: string;
	/** `/badges/…svg`, or null when the milestone has no icon (trophy pill instead). */
	icon: string | null;
};

export type StudentBadgeRow = {
	badge_subject: string;
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
	const shaped: StudentBadge[] = rows.map((row): StudentBadge => {
		if (row.badge_type !== 'attendance' && row.badge_type !== 'homework') {
			// Never silently guessed -- the DB check constraint already limits
			// badge_type to these two values, so anything else here means the
			// schema and this shaping function have drifted out of sync, which
			// must surface loudly rather than mislabel a row.
			throw new Error(`Unrecognized badge_type: ${row.badge_type}`);
		}
		if (!isBadgeSubject(row.badge_subject)) {
			// Same reasoning: 0048's check constraint limits badge_subject.
			throw new Error(`Unrecognized badge_subject: ${row.badge_subject}`);
		}
		const badge: Pick<StudentBadge, 'subject' | 'badgeType' | 'milestone'> = {
			subject: row.badge_subject,
			badgeType: row.badge_type,
			milestone: row.milestone
		};
		return {
			...badge,
			earnedAt: row.earned_at,
			icon: badgeIconPath(badge)
		};
	});
	return shaped.sort(compareBadges);
}

/**
 * Subject (language, dance, instrument), then attendance before homework,
 * then milestone -- never the alphabetical order the query returns.
 */
function compareBadges(
	a: Pick<StudentBadge, 'subject' | 'badgeType' | 'milestone'>,
	b: Pick<StudentBadge, 'subject' | 'badgeType' | 'milestone'>
): number {
	return (
		BADGE_SUBJECTS.indexOf(a.subject) - BADGE_SUBJECTS.indexOf(b.subject) ||
		BADGE_TYPES.indexOf(a.badgeType) - BADGE_TYPES.indexOf(b.badgeType) ||
		a.milestone - b.milestone
	);
}

/** A badge the student has not seen celebrated yet (badge detail CAP-9). */
export type NewBadge = StudentBadge & { id: string };

/**
 * Shapes the caller's unseen `badges_earned` rows for the "New badge!"
 * dialog: like `shapeStudentBadges` (same order, icons), keeping each row's
 * id so dismissing the dialog can mark exactly these rows seen.
 */
export function shapeNewBadges(rows: (StudentBadgeRow & { id: string })[] | null): NewBadge[] {
	if (!rows) return [];
	return rows
		.map((row): NewBadge => ({ ...shapeStudentBadges([row])[0], id: row.id }))
		.sort(compareBadges);
}

/** One track's progress toward its next badge; `next` is null after the top milestone. */
export type BadgeProgressTrack = { total: number; next: number | null };

export type BadgeProgress = {
	subject: BadgeSubject;
	attendance: BadgeProgressTrack;
	homework: BadgeProgressTrack;
};

export type BadgeProgressRow = {
	subject: string;
	badge_type: string;
	total: number;
	next_milestone: number | null;
};

/**
 * Shapes `badge_progress()` (0049) into one entry per subject, both tracks
 * each, in subject order. Counts are the database's (the same counts the
 * badge recompute uses) -- never derived here from raw rows.
 */
export function shapeBadgeProgress(rows: BadgeProgressRow[] | null): BadgeProgress[] {
	if (!rows) return [];
	const bySubject = new Map<BadgeSubject, BadgeProgress>();
	for (const row of rows) {
		if (row.badge_type !== 'attendance' && row.badge_type !== 'homework') {
			throw new Error(`Unrecognized badge_type: ${row.badge_type}`);
		}
		if (!isBadgeSubject(row.subject)) {
			throw new Error(`Unrecognized badge_subject: ${row.subject}`);
		}
		const entry = bySubject.get(row.subject) ?? {
			subject: row.subject,
			attendance: { total: 0, next: null },
			homework: { total: 0, next: null }
		};
		entry[row.badge_type] = { total: row.total, next: row.next_milestone };
		bySubject.set(row.subject, entry);
	}
	return BADGE_SUBJECTS.flatMap((subject) => bySubject.get(subject) ?? []);
}

/** The milestone list when `app_settings.badge_milestone_thresholds` is missing or malformed (0048/0049). */
export const DEFAULT_BADGE_MILESTONES: readonly number[] = [1, 5, 10, 25, 50, 100];

/**
 * `app_settings.badge_milestone_thresholds` as ascending positive integers,
 * or the same fallback the database uses (0048, 0049) when it is missing,
 * not an array, or empty.
 */
export function parseBadgeMilestones(value: unknown): number[] {
	if (!Array.isArray(value)) return [...DEFAULT_BADGE_MILESTONES];
	const milestones = value.filter(
		(v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
	);
	if (milestones.length === 0) return [...DEFAULT_BADGE_MILESTONES];
	return Array.from(new Set(milestones)).sort((a, b) => a - b);
}

/** One badge on the badge page; `earnedAt` null means locked. */
export type BadgePageBadge = { milestone: number; icon: string | null; earnedAt: string | null };

export type BadgePageTrack = {
	type: BadgeType;
	/** The track's real count, or null when the student has no progress row for it (a subject they left). */
	total: number | null;
	/** The next target from badge_progress; null at the top or when `total` is unknown. */
	next: number | null;
	badges: BadgePageBadge[];
};

export type BadgePageSection = { subject: BadgeSubject; tracks: BadgePageTrack[] };

/**
 * Shapes the badge page (badge detail CAP-7): one section per subject the
 * student has progress in (an enrolled class with that subject) or already
 * holds a badge in, so an earned badge never disappears. Each subject has
 * the attendance then the homework track, listing every configured milestone
 * (plus any earned one no longer configured) in ascending order.
 */
export function shapeBadgePage(
	badges: StudentBadge[],
	progress: BadgeProgress[],
	milestones: number[]
): BadgePageSection[] {
	const subjects = BADGE_SUBJECTS.filter(
		(subject) =>
			progress.some((row) => row.subject === subject) ||
			badges.some((badge) => badge.subject === subject)
	);
	return subjects.map((subject) => {
		const row = progress.find((p) => p.subject === subject);
		return {
			subject,
			tracks: BADGE_TYPES.map((type): BadgePageTrack => {
				const earned = new Map(
					badges
						.filter((b) => b.subject === subject && b.badgeType === type)
						.map((b) => [b.milestone, b.earnedAt])
				);
				const all = Array.from(new Set([...milestones, ...earned.keys()])).sort((a, b) => a - b);
				return {
					type,
					total: row ? row[type].total : null,
					next: row ? row[type].next : null,
					badges: all.map((milestone) => ({
						milestone,
						icon: badgeIconPath({ subject, badgeType: type, milestone }),
						earnedAt: earned.get(milestone) ?? null
					}))
				};
			})
		};
	});
}

type Client = SupabaseClient<Database>;

/**
 * Reads everything the badge page shows for one student: their earned
 * badges, badge_progress() (0049) and the milestone setting, in parallel.
 * RLS and badge_progress decide who may read them (the student, linked
 * parents, teachers of the student's classes, admin); the routes check
 * access first. A failed read is `loadError`, never an empty page.
 */
export async function loadBadgePage(
	supabase: Client,
	studentId: string
): Promise<{ sections: BadgePageSection[]; loadError: boolean }> {
	const [
		{ data: badgeRows, error: badgesError },
		{ data: progressRows, error: progressError },
		{ data: setting, error: settingError }
	] = await Promise.all([
		supabase
			.from('badges_earned')
			.select('badge_subject, badge_type, milestone, earned_at')
			.eq('student_id', studentId),
		supabase.rpc('badge_progress', { p_student_id: studentId }),
		supabase
			.from('app_settings')
			.select('value')
			.eq('key', 'badge_milestone_thresholds')
			.maybeSingle()
	]);
	const failure = badgesError ?? progressError ?? settingError;
	if (failure) {
		console.error(`Could not load the badge page. ${failure.message}`);
		return { sections: [], loadError: true };
	}
	return {
		sections: shapeBadgePage(
			shapeStudentBadges(badgeRows),
			shapeBadgeProgress(progressRows),
			parseBadgeMilestones(setting?.value ?? null)
		),
		loadError: false
	};
}
