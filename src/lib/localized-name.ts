import { getLocale } from '$lib/paraglide/runtime';

/**
 * A class's or team's names (#76, 0036): `name` is the English name and the
 * fallback; `name_bo` (Tibetan) and `name_de` (German) may be missing.
 */
export type LocalizedNames = { name: string; name_bo?: string | null; name_de?: string | null };

/**
 * The name to show in `locale` (the viewer's language by default): that
 * language's name, else the English one.
 */
export function pickLocalized(
	en: string,
	bo?: string | null,
	de?: string | null,
	locale: string = getLocale()
): string {
	const own = locale === 'bo' ? bo : locale === 'de' ? de : null;
	return own?.trim() ? own : en;
}

export function localizedName(names: LocalizedNames, locale?: string): string {
	return pickLocalized(names.name, names.name_bo, names.name_de, locale);
}

/**
 * The names in the other languages, for the admin lists: each language that
 * has a name different from the one shown.
 */
export function otherNames(
	names: LocalizedNames,
	locale?: string
): { lang: 'en' | 'bo' | 'de'; name: string }[] {
	const shown = localizedName(names, locale);
	const all = [
		{ lang: 'en' as const, name: names.name },
		{ lang: 'bo' as const, name: names.name_bo ?? '' },
		{ lang: 'de' as const, name: names.name_de ?? '' }
	];
	return all.filter((n) => n.name.trim() !== '' && n.name !== shown);
}

/** `row` with `name` in the viewer's language and the other names dropped. */
export function localizeName<T extends LocalizedNames>(
	row: T,
	locale?: string
): Omit<T, 'name' | 'name_bo' | 'name_de'> & { name: string } {
	const { name, name_bo, name_de, ...rest } = row;
	return { ...rest, name: pickLocalized(name, name_bo, name_de, locale) };
}
