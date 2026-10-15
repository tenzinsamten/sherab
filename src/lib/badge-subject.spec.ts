import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { badgeSubjectLabel, isBadgeSubject } from './badge-subject';

describe('badge subject (badge detail CAP-1)', () => {
	it('only the three subjects are known; NULL (unset) and song are not', () => {
		expect(['language', 'dance', 'instrument'].every(isBadgeSubject)).toBe(true);
		expect([null, undefined, '', 'song'].some(isBadgeSubject)).toBe(false);
	});

	it('labels each subject, dance as "Dance & song"', () => {
		expect(badgeSubjectLabel('language')).toBe(m.badge_subject_language());
		expect(badgeSubjectLabel('dance')).toBe(m.badge_subject_dance());
		expect(badgeSubjectLabel('instrument')).toBe(m.badge_subject_instrument());
	});
});
