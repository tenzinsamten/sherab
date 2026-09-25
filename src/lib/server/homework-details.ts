import type { HomeworkReferenceLink } from '$lib/supabase/database.types';

/** Mirrors the check constraints in 0013_homework_details_and_late_joiners.sql. */
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_REFERENCE_LINKS = 10;
export const MAX_LINK_URL_LENGTH = 2000;
export const MAX_LINK_LABEL_LENGTH = 100;

/**
 * Plain-text homework description: trimmed, empty becomes null. Returns
 * `{ ok: false }` when it is longer than the column allows, so the action can
 * show an error instead of letting the insert fail on the constraint.
 */
export function parseDescription(
	raw: FormDataEntryValue | null
): { ok: true; value: string | null } | { ok: false } {
	const value = String(raw ?? '').trim();
	if (value.length > MAX_DESCRIPTION_LENGTH) return { ok: false };
	return { ok: true, value: value || null };
}

/**
 * Reads the paired `linkUrl` / `linkLabel` fields the link rows submit, in
 * order. Rows with an empty URL are dropped (an untouched blank row), so the
 * label on its own never counts. No URL validation: teachers are trusted to
 * link what they want (0004's table comment).
 */
export function parseReferenceLinks(
	formData: FormData
): { ok: true; value: HomeworkReferenceLink[] } | { ok: false } {
	const urls = formData.getAll('linkUrl').map((v) => String(v).trim());
	const labels = formData.getAll('linkLabel').map((v) => String(v).trim());

	const links: HomeworkReferenceLink[] = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		if (!url) continue;
		const label = labels[i] ?? '';
		if (url.length > MAX_LINK_URL_LENGTH || label.length > MAX_LINK_LABEL_LENGTH) {
			return { ok: false };
		}
		links.push({ url, label: label || null });
	}

	if (links.length > MAX_REFERENCE_LINKS) return { ok: false };
	return { ok: true, value: links };
}

/**
 * Normalises a `reference_links` value read from the database. The column is
 * jsonb, so guard against anything that isn't the expected array shape.
 */
export function readReferenceLinks(value: unknown): HomeworkReferenceLink[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== 'object') return [];
		const { url, label } = item as { url?: unknown; label?: unknown };
		if (typeof url !== 'string' || !url) return [];
		return [{ url, label: typeof label === 'string' && label ? label : null }];
	});
}
