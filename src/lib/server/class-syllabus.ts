import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, HomeworkReferenceLink } from '$lib/supabase/database.types';
import { parseDescription, parseReferenceLinks } from './homework-details';

/** Mirrors classes_syllabus_length in 0014_class_syllabus.sql. */
export const MAX_SYLLABUS_LENGTH = 5000;

export type SyllabusInput = { syllabus: string | null; links: HomeworkReferenceLink[] };

/**
 * Reads the syllabus form (#32): a `syllabus` textarea plus the LinkRows
 * `linkUrl` / `linkLabel` fields. Shared by the teacher class page and
 * /admin/classes.
 */
export function parseSyllabusForm(
	formData: FormData
): { ok: true; value: SyllabusInput } | { ok: false; problem: 'length' | 'links' } {
	const syllabus = parseDescription(formData.get('syllabus'), MAX_SYLLABUS_LENGTH);
	if (!syllabus.ok) return { ok: false, problem: 'length' };
	const links = parseReferenceLinks(formData);
	if (!links.ok) return { ok: false, problem: 'links' };
	return { ok: true, value: { syllabus: syllabus.value, links: links.value } };
}

/**
 * Saves through set_class_syllabus(), which checks that the caller is the
 * admin or a teacher of this class and writes only the syllabus columns.
 */
export async function saveSyllabus(
	supabase: SupabaseClient<Database>,
	classId: string,
	input: SyllabusInput
): Promise<{ error: boolean }> {
	const { error } = await supabase.rpc('set_class_syllabus', {
		p_class_id: classId,
		p_syllabus: input.syllabus ?? '',
		p_links: input.links
	});
	return { error: Boolean(error) };
}
