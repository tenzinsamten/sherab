/**
 * Up to two initials for the header avatar (#64): the first letter of the
 * first and last word of the display name. Letters are whole graphemes (an
 * accented letter or a joined emoji stays one character), upper-cased
 * without the runtime locale so server and browser agree; a letter whose
 * upper case would grow (ß → SS) is kept as is. Empty when there is no name,
 * so iX falls back to its generic person icon.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function firstLetter(word: string): string {
	const first = segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? '';
	const upper = first.toUpperCase();
	return Array.from(upper).length > Array.from(first).length ? first : upper;
}

export function initials(name: string | null | undefined): string {
	const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '';
	if (words.length === 1) return firstLetter(words[0]);
	return firstLetter(words[0]) + firstLetter(words[words.length - 1]);
}
