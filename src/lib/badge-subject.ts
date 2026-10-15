import * as m from '$lib/paraglide/messages.js';

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
