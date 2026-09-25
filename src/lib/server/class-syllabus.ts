import { fail, redirect } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import { currentSchoolYear, formatSchoolYear, selectableSchoolYears } from '$lib/school-year';
import type { Database, HomeworkReferenceLink } from '$lib/supabase/database.types';
import { CLASS_MESSAGES, SYLLABUS_MESSAGES, rowOr404 } from './class-access';
import { UNIQUE_VIOLATION_CODE } from './class-code';
import { parseDescription, parseReferenceLinks, readReferenceLinks } from './homework-details';

/**
 * Class syllabi, one per school year (#37, 0015_class_syllabi.sql). Shared by
 * the teacher routes (/teacher/classes/[id]/syllabus) and the admin routes
 * (/admin/classes/[id]/syllabus); RLS decides who may read or change them.
 */

type Client = SupabaseClient<Database>;

/** Mirrors class_syllabi_content_length in 0015. */
export const MAX_SYLLABUS_LENGTH = 5000;

export type SyllabusInput = { syllabus: string | null; links: HomeworkReferenceLink[] };

export type Syllabus = {
	id: string;
	schoolYear: number;
	content: string | null;
	links: HomeworkReferenceLink[];
	updatedAt: string;
};

/**
 * Reads the syllabus form: a `syllabus` textarea plus the LinkRows
 * `linkUrl` / `linkLabel` fields.
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

function toSyllabus(row: {
	id: string;
	school_year: number;
	content: string | null;
	links: unknown;
	updated_at: string;
}): Syllabus {
	return {
		id: row.id,
		schoolYear: row.school_year,
		content: row.content,
		links: readReferenceLinks(row.links),
		updatedAt: row.updated_at
	};
}

const SYLLABUS_COLUMNS = 'id, school_year, content, links, updated_at';

/** A class's syllabi, newest school year first. */
export async function listSyllabi(
	supabase: Client,
	classId: string
): Promise<{ syllabi: Syllabus[]; error: boolean }> {
	const { data, error } = await supabase
		.from('class_syllabi')
		.select(SYLLABUS_COLUMNS)
		.eq('class_id', classId)
		.order('school_year', { ascending: false });
	return { syllabi: (data ?? []).map(toSyllabus), error: Boolean(error) };
}

/**
 * The syllabus a student sees: the current school year's, or the newest one
 * when this year has none yet.
 */
export function pickStudentSyllabus(syllabi: Syllabus[], current: number): Syllabus | null {
	return syllabi.find((s) => s.schoolYear === current) ?? syllabi[0] ?? null;
}

/** Load for a syllabus list page: the class, its syllabi, and the years that can still be added. */
export async function loadSyllabusList(supabase: Client, classId: string) {
	const cls = rowOr404(
		await supabase.from('classes').select('id, name, code').eq('id', classId).maybeSingle(),
		CLASS_MESSAGES
	);
	const { syllabi, error } = await listSyllabi(supabase, classId);
	const current = currentSchoolYear();
	return {
		class: cls,
		syllabi,
		currentYear: current,
		addableYears: selectableSchoolYears(
			current,
			syllabi.map((s) => s.schoolYear)
		),
		loadError: error
	};
}

/** Load for a syllabus detail page. */
export async function loadSyllabusDetail(supabase: Client, classId: string, syllabusId: string) {
	const cls = rowOr404(
		await supabase.from('classes').select('id, name, code').eq('id', classId).maybeSingle(),
		CLASS_MESSAGES
	);
	const syllabus = toSyllabus(
		rowOr404(
			await supabase
				.from('class_syllabi')
				.select(SYLLABUS_COLUMNS)
				.eq('id', syllabusId)
				.eq('class_id', classId)
				.maybeSingle(),
			SYLLABUS_MESSAGES
		)
	);
	return { class: cls, syllabus, currentYear: currentSchoolYear() };
}

type ActionContext = {
	request: Request;
	classId: string;
	/** The route's syllabus list, e.g. `/teacher/classes/<id>/syllabus`. */
	listPath: string;
	supabase: Client;
	user: User | null;
};

export async function createSyllabus({
	request,
	classId,
	listPath,
	supabase,
	user
}: ActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const schoolYear = Number.parseInt(String(formData.get('schoolYear') ?? ''), 10);
	// Only the years the add form offers (the unique constraint also stops a
	// year being added twice, e.g. from two open tabs).
	if (!selectableSchoolYears(currentSchoolYear(), []).includes(schoolYear)) {
		return fail(400, { error: m.syllabus_error_year() });
	}

	const { data, error } = await supabase
		.from('class_syllabi')
		.insert({ class_id: classId, school_year: schoolYear, created_by: user.id })
		.select('id')
		.single();

	if (error || !data) {
		return fail(400, {
			error:
				error?.code === UNIQUE_VIOLATION_CODE
					? m.syllabus_error_duplicate({ year: formatSchoolYear(schoolYear) })
					: m.syllabus_error_failed()
		});
	}

	throw redirect(303, `${listPath}/${data.id}?edit=1`);
}

export async function updateSyllabus({ request, classId, supabase, user }: ActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const syllabusId = String(formData.get('syllabusId') ?? '');
	const parsed = parseSyllabusForm(formData);
	if (!parsed.ok) {
		return fail(400, {
			error:
				parsed.problem === 'length' ? m.syllabus_error_length() : m.homework_error_links_invalid()
		});
	}

	// .select() + row check: RLS turns a forbidden update into zero rows, not
	// an error, which would otherwise look like a successful save.
	const { data, error } = await supabase
		.from('class_syllabi')
		.update({
			content: parsed.value.syllabus,
			links: parsed.value.links,
			updated_at: new Date().toISOString()
		})
		.eq('id', syllabusId)
		.eq('class_id', classId)
		.select('id');

	if (error || !data || data.length === 0) {
		return fail(400, { error: m.syllabus_error_failed() });
	}

	return { success: true, action: 'syllabusSaved' as const };
}

export async function deleteSyllabus({
	request,
	classId,
	listPath,
	supabase,
	user
}: ActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const syllabusId = String(formData.get('syllabusId') ?? '');

	const { data, error } = await supabase
		.from('class_syllabi')
		.delete()
		.eq('id', syllabusId)
		.eq('class_id', classId)
		.select('school_year');

	if (error || !data || data.length === 0) {
		return fail(400, { error: m.syllabus_error_failed() });
	}

	throw redirect(303, `${listPath}?deleted=${data[0].school_year}`);
}
