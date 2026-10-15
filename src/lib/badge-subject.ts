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
