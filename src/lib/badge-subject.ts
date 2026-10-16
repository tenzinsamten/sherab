import * as m from '$lib/paraglide/messages.js';
import { num } from '$lib/format';

/**
 * The badge subject a class counts toward (badge detail CAP-1). Song classes
 * use `dance`: song and dance share one count. 0047's check constraint allows
 * exactly these values (AD-2); the column is NULL until the admin sets one.
 */
export const BADGE_SUBJECTS = ['language', 'dance', 'instrument'] as const;
export type BadgeSubject = (typeof BADGE_SUBJECTS)[number];

export function isBadgeSubject(value: unknown): value is BadgeSubject {
	return BADGE_SUBJECTS.includes(value as BadgeSubject);
}

/** The subject's label in the viewer's language ("Dance & song" for dance). */
export function badgeSubjectLabel(subject: BadgeSubject): string {
	if (subject === 'dance') return m.badge_subject_dance();
	if (subject === 'instrument') return m.badge_subject_instrument();
	return m.badge_subject_language();
}

type BadgeText = {
	subject: BadgeSubject;
	badgeType: 'attendance' | 'homework';
	milestone: number;
};

/** Milestones that have an icon in `static/badges/` (badge-catalog.md). */
export const BADGE_ICON_MILESTONES: readonly number[] = [1, 5, 10, 25, 50, 100];

/**
 * The badge's icon (`/badges/{subject}-{type}-{milestone}.svg`), or null for a
 * milestone with no icon -- the caller then shows the trophy pill.
 */
export function badgeIconPath(badge: BadgeText): string | null {
	if (!BADGE_ICON_MILESTONES.includes(badge.milestone)) return null;
	return `/badges/${badge.subject}-${badge.badgeType}-${badge.milestone}.svg`;
}

/** The track's name: "Attendance" or "Homework". */
export function badgeTrackLabel(badgeType: 'attendance' | 'homework'): string {
	return badgeType === 'homework' ? m.badge_track_homework() : m.badge_track_attendance();
}

/** What the badge rewards, e.g. "5 Dance & song homework done" (badge detail CAP-5). */
export function badgeRewardText(badge: BadgeText): string {
	const args = { count: num(badge.milestone), subject: badgeSubjectLabel(badge.subject) };
	return badge.badgeType === 'homework'
		? m.badge_reward_homework(args)
		: m.badge_reward_attendance(args);
}

/** The icon button's accessible name: subject, track and milestone. */
export function badgeIconLabel(badge: BadgeText): string {
	return m.badge_icon_label({
		subject: badgeSubjectLabel(badge.subject),
		track: badgeTrackLabel(badge.badgeType),
		count: num(badge.milestone)
	});
}

/** What unlocks a locked badge, e.g. "Attend 25 Dance & song classes" (badge detail CAP-7). */
export function badgeUnlockText(badge: BadgeText): string {
	// The plain count picks the plural form; num() then localizes its digits.
	const args = { count: badge.milestone, subject: badgeSubjectLabel(badge.subject) };
	return num(
		badge.badgeType === 'homework' ? m.badge_unlock_homework(args) : m.badge_unlock_attendance(args)
	);
}

/** The `limit` most recently earned badges, newest first (a tie keeps the given order). */
export function recentBadges<T extends { earnedAt: string }>(badges: T[], limit: number): T[] {
	return [...badges]
		.sort((a, b) => Date.parse(b.earnedAt) - Date.parse(a.earnedAt))
		.slice(0, limit);
}
