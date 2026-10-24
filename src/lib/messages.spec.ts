import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * #128: no interface text is left in English under Tibetan by accident (Tibetan
 * only; German loanwords such as "Teams" are not checked). A Tibetan text equal
 * to its English one, with two Latin letters in a row outside its {placeholders},
 * must be on this list: the logo, the tagline and units (KB, MB, PIN) read the
 * same in Tibetan (texts that are only placeholders are never flagged). Variant messages (plurals) are
 * compared variant by variant.
 */
const SAME_ON_PURPOSE = [
	'nav_logo_alt', // the logo: "Sherab – ཤེས་རབ་"
	'home_poster_hero', // "Class Tracker", the product tagline (user, 2026-10-24)
	'syllabus_file_size_kb',
	'syllabus_file_size_mb',
	'credential_pin' // PIN
];

const read = (locale: string): Record<string, unknown> =>
	JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));

/** Every text of a message as `key` or `key.path` → string (variants walked into). */
function texts(value: unknown, key: string, out: Map<string, string> = new Map()) {
	if (typeof value === 'string') out.set(key, value);
	else if (value && typeof value === 'object')
		for (const [part, inner] of Object.entries(value))
			// A variant's `declarations` and `selectors` are code, not text.
			if (part !== 'declarations' && part !== 'selectors') texts(inner, `${key}.${part}`, out);
	return out;
}
const flatten = (messages: Record<string, unknown>) => {
	const out = new Map<string, string>();
	for (const [key, value] of Object.entries(messages))
		if (!key.startsWith('$')) texts(value, key, out);
	return out;
};
const latin = (text: string) => /[A-Za-z]{2}/.test(text.replace(/\{[^}]*\}/g, ''));

describe('messages (#128)', () => {
	const en = flatten(read('en'));
	const bo = flatten(read('bo'));
	const same = [...en].filter(([key, text]) => bo.get(key) === text && latin(text));
	const keyOf = (path: string) => path.split('.')[0];

	it('every Tibetan text equal to the English one is meant to be', () => {
		expect(
			same.map(([path]) => path).filter((path) => !SAME_ON_PURPOSE.includes(keyOf(path)))
		).toEqual([]);
	});

	it('the list has no stale entries: each key exists and is still the same', () => {
		const sameKeys = new Set(same.map(([path]) => keyOf(path)));
		expect(SAME_ON_PURPOSE.filter((key) => !sameKeys.has(key))).toEqual([]);
	});

	it('the roster’s upcoming leave reads like the Requests page’s', () => {
		expect(bo.get('roster_upcoming_leave_heading')).toBe(bo.get('requests_upcoming_leave_heading'));
		expect(bo.get('roster_upcoming_leave_empty')).toBe(bo.get('requests_upcoming_leave_empty'));
	});
});
