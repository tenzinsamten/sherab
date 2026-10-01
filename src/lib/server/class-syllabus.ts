import { fail, redirect } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import {
	isContentLanguage,
	parseContent,
	readContent,
	readContentLanguage,
	type ContentLanguage,
	type RichTextDoc
} from '$lib/rich-text';
import { currentSchoolYear, formatSchoolYear, selectableSchoolYears } from '$lib/school-year';
import type { Database, HomeworkReferenceLink } from '$lib/supabase/database.types';
import { CLASS_MESSAGES, SYLLABUS_MESSAGES, rowOr404 } from './class-access';
import { UNIQUE_VIOLATION_CODE } from './class-code';
import { parseReferenceLinks, readReferenceLinks } from './homework-details';

/**
 * Class syllabi, one per school year (#37, 0015_class_syllabi.sql). Shared by
 * the teacher routes (/teacher/classes/[id]/syllabus) and the admin routes
 * (/admin/classes/[id]/syllabus); RLS decides who may read or change them.
 * The text is rich text in a chosen language, like homework content (#75,
 * 0035_syllabus_content.sql).
 */

type Client = SupabaseClient<Database>;

export type SyllabusInput = {
	content: RichTextDoc | null;
	language: ContentLanguage;
	links: HomeworkReferenceLink[];
};

export type Syllabus = {
	id: string;
	schoolYear: number;
	content: RichTextDoc | null;
	/** Language the syllabus is written in: selects its font (#75). */
	contentLanguage: ContentLanguage;
	links: HomeworkReferenceLink[];
	updatedAt: string;
};

/**
 * Reads the syllabus form: the editor's `content` document, its
 * `contentLanguage`, and the LinkRows `linkUrl` / `linkLabel` fields. The
 * text is optional (a syllabus may be links only), so an empty editor gives
 * null, which also clears a saved text.
 */
export function parseSyllabusForm(
	formData: FormData
):
	| { ok: true; value: SyllabusInput }
	| { ok: false; problem: 'content' | 'size' | 'language' | 'links' } {
	const content = parseContent(formData.get('content'));
	if (!content.ok && content.reason !== 'required') {
		return { ok: false, problem: content.reason === 'too_large' ? 'size' : 'content' };
	}
	const language = formData.get('contentLanguage');
	if (!isContentLanguage(language)) return { ok: false, problem: 'language' };
	const links = parseReferenceLinks(formData);
	if (!links.ok) return { ok: false, problem: 'links' };
	return {
		ok: true,
		value: { content: content.ok ? content.value : null, language, links: links.value }
	};
}

function toSyllabus(row: {
	id: string;
	school_year: number;
	content_doc: unknown | null;
	content_language: string;
	links: unknown;
	updated_at: string;
}): Syllabus {
	return {
		id: row.id,
		schoolYear: row.school_year,
		content: readContent(row.content_doc),
		contentLanguage: readContentLanguage(row.content_language),
		links: readReferenceLinks(row.links),
		updatedAt: row.updated_at
	};
}

const SYLLABUS_COLUMNS = 'id, school_year, content_doc, content_language, links, updated_at';

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
		const messages = {
			content: m.homework_error_content_invalid,
			size: m.syllabus_error_too_large,
			language: m.syllabus_error_language,
			links: m.homework_error_links_invalid
		};
		return fail(400, { error: messages[parsed.problem]() });
	}

	// .select() + row check: RLS turns a forbidden update into zero rows, not
	// an error, which would otherwise look like a successful save.
	const { data, error } = await supabase
		.from('class_syllabi')
		.update({
			content_doc: parsed.value.content,
			content_language: parsed.value.language,
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
