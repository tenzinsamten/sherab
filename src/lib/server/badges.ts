import { BADGE_SUBJECTS, isBadgeSubject, type BadgeSubject } from '$lib/badge-subject';

export type BadgeType = 'attendance' | 'homework';

/** Attendance before homework, wherever badges are listed. */
const BADGE_TYPES: readonly BadgeType[] = ['attendance', 'homework'];

/** Milestones that have an icon in `static/badges/` (badge-catalog.md). */
export const BADGE_ICON_MILESTONES: readonly number[] = [1, 5, 10, 25, 50, 100];

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
	// Subject (language, dance, instrument), then attendance before homework,
	// then milestone -- never the alphabetical order the query returns.
	return shaped.sort(
		(a, b) =>
			BADGE_SUBJECTS.indexOf(a.subject) - BADGE_SUBJECTS.indexOf(b.subject) ||
			BADGE_TYPES.indexOf(a.badgeType) - BADGE_TYPES.indexOf(b.badgeType) ||
			a.milestone - b.milestone
	);
}

/**
 * The badge's icon (`/badges/{subject}-{type}-{milestone}.svg`), or null for a
 * milestone with no icon -- the caller then shows the trophy pill.
 */
export function badgeIconPath(badge: {
	subject: BadgeSubject;
	badgeType: BadgeType;
	milestone: number;
}): string | null {
	if (!BADGE_ICON_MILESTONES.includes(badge.milestone)) return null;
	return `/badges/${badge.subject}-${badge.badgeType}-${badge.milestone}.svg`;
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
