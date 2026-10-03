import { UNIQUE_VIOLATION_CODE } from './class-code';

/**
 * The name fields of the class and team forms (#76), as
 * LocalizedNameFields.svelte posts them: `name` (English), `nameBo`
 * (Tibetan), `nameDe` (German). English and Tibetan are required.
 */
export type NameFields = { name: string; nameBo: string; nameDe: string };

export function readNameFields(formData: FormData): NameFields {
	const read = (key: string) => String(formData.get(key) ?? '').trim();
	return { name: read('name'), nameBo: read('nameBo'), nameDe: read('nameDe') };
}

/** The first required name that is missing, null when both are there. */
export function missingName(fields: NameFields): 'en' | 'bo' | null {
	if (!fields.name) return 'en';
	if (!fields.nameBo) return 'bo';
	return null;
}

/** The columns to write (0036): an empty optional name is stored as NULL. */
export function nameColumns(fields: NameFields) {
	return { name: fields.name, name_bo: fields.nameBo || null, name_de: fields.nameDe || null };
}

/**
 * The name a unique violation is about: names are unique per language
 * (0010, 0012, 0036), and the index in the error message says which one.
 * The English name when the message names no language.
 */
export function duplicateName(error: { code?: string; message: string }, fields: NameFields) {
	if (error.code === UNIQUE_VIOLATION_CODE) {
		if (error.message.includes('name_bo_unique_idx')) return fields.nameBo;
		if (error.message.includes('name_de_unique_idx')) return fields.nameDe;
	}
	return fields.name;
}
