import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages.js';
import { badgeSubjectLabel, badgeUnlockText, isBadgeSubject, recentBadges } from './badge-subject';

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

describe('badgeUnlockText (badge detail CAP-7)', () => {
	const original = getLocale;
	afterEach(() => overwriteGetLocale(original));
	const dance = (badgeType: 'attendance' | 'homework', milestone: number) => ({
		subject: 'dance' as const,
		badgeType,
		milestone
	});

	it('reads correctly for 1 and for many in English', () => {
		overwriteGetLocale(() => 'en');
		expect(badgeUnlockText(dance('attendance', 1))).toBe('Attend 1 Dance & song class');
		expect(badgeUnlockText(dance('attendance', 25))).toBe('Attend 25 Dance & song classes');
		expect(badgeUnlockText(dance('homework', 1))).toBe('Finish 1 Dance & song homework');
		expect(badgeUnlockText(dance('homework', 5))).toBe('Finish 5 Dance & song homework');
	});

	it('reads correctly for 1 and for many in German', () => {
		overwriteGetLocale(() => 'de');
		expect(badgeUnlockText(dance('attendance', 1))).toBe(
			'Besuche 1 Unterrichtstag in Tanz & Gesang'
		);
		expect(badgeUnlockText(dance('homework', 1))).toBe('Erledige 1 Hausaufgabe in Tanz & Gesang');
		expect(badgeUnlockText(dance('homework', 5))).toBe('Erledige 5 Hausaufgaben in Tanz & Gesang');
	});

	it('uses Tibetan digits in Tibetan', () => {
		overwriteGetLocale(() => 'bo');
		expect(badgeUnlockText(dance('homework', 25))).toContain('༢༥');
	});
});

describe('recentBadges', () => {
	it('keeps the 6 most recently earned of 8, newest first', () => {
		const badges = [3, 7, 1, 5, 8, 2, 6, 4].map((day) => ({
			id: day,
			earnedAt: `2026-09-0${day}T10:00:00Z`
		}));
		const shown = recentBadges(badges, 6);
		expect(shown.map((b) => b.id)).toEqual([8, 7, 6, 5, 4, 3]);
		expect(shown.some((b) => b.id === 1 || b.id === 2)).toBe(false);
		// The input is left as it was.
		expect(badges.map((b) => b.id)).toEqual([3, 7, 1, 5, 8, 2, 6, 4]);
	});
});
