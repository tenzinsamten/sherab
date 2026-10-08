import { localizeName } from '$lib/localized-name';
import { fail, redirect } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import * as m from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime';
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
 * Class syllabi, one per school year (#37, 0015_class_syllabi.sql), each made
 * of titled sections (0038_syllabus_sections.sql). Shared by the teacher
 * routes (/teacher/classes/[id]/syllabus) and the admin routes
 * (/admin/classes/[id]/syllabus); RLS decides who may read or change them.
 * A section's description is rich text in a chosen language, like homework
 * content (#75), and it has its own links.
 */

type Client = SupabaseClient<Database>;

export const MAX_SECTION_TITLE_LENGTH = 200;

export type SectionInput = {
	title: string;
	content: RichTextDoc | null;
	language: ContentLanguage;
	links: HomeworkReferenceLink[];
};

export type SyllabusSection = {
	id: string;
	title: string;
	content: RichTextDoc | null;
	/** Language the section is written in: selects its font (#75). */
	contentLanguage: ContentLanguage;
	links: HomeworkReferenceLink[];
};

export type Syllabus = {
	id: string;
	schoolYear: number;
	/** In the order shown: by position, then by when they were added. */
	sections: SyllabusSection[];
};

/** A section title as posted: trimmed, or null when empty or over 200 characters. */
export function parseSectionTitle(raw: FormDataEntryValue | null): string | null {
	const title = typeof raw === 'string' ? raw.trim() : '';
	// Counted as the database does (characters, not UTF-16 units).
	const length = [...title].length;
	return length >= 1 && length <= MAX_SECTION_TITLE_LENGTH ? title : null;
}

/**
 * Reads the section form: `title`, the editor's `content` document, its
 * `contentLanguage`, and the LinkRows `linkUrl` / `linkLabel` fields. The
 * title is required; the text is optional (a section may be links only, or
 * a title only), so an empty editor gives null, which also clears a saved
 * text.
 */
export function parseSectionForm(
	formData: FormData
):
	| { ok: true; value: SectionInput }
	| { ok: false; problem: 'title' | 'content' | 'size' | 'language' | 'links' } {
	const title = parseSectionTitle(formData.get('title'));
	if (title === null) return { ok: false, problem: 'title' };
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
		value: { title, content: content.ok ? content.value : null, language, links: links.value }
	};
}

type SectionRow = {
	id: string;
	position: number;
	title: string;
	content_doc: unknown | null;
	content_language: string;
	links: unknown;
	created_at: string;
};

function toSyllabus(row: {
	id: string;
	school_year: number;
	class_syllabus_sections: SectionRow[] | null;
}): Syllabus {
	const sections = [...(row.class_syllabus_sections ?? [])].sort(
		(a, b) =>
			a.position - b.position ||
			a.created_at.localeCompare(b.created_at) ||
			a.id.localeCompare(b.id)
	);
	return {
		id: row.id,
		schoolYear: row.school_year,
		sections: sections.map((section) => ({
			id: section.id,
			title: section.title,
			content: readContent(section.content_doc),
			contentLanguage: readContentLanguage(section.content_language),
			links: readReferenceLinks(section.links)
		}))
	};
}

// class_syllabi's own content_doc / content_language / links are no longer
// read (0038): the sections hold the text and links.
const SYLLABUS_COLUMNS =
	'id, school_year, class_syllabus_sections(id, position, title, content_doc, content_language, links, created_at)';

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
	const cls = localizeName(
		rowOr404(
			await supabase
				.from('classes')
				.select('id, name, name_bo, name_de, code')
				.eq('id', classId)
				.maybeSingle(),
			CLASS_MESSAGES
		)
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
	const cls = localizeName(
		rowOr404(
			await supabase
				.from('classes')
				.select('id, name, name_bo, name_de, code')
				.eq('id', classId)
				.maybeSingle(),
			CLASS_MESSAGES
		)
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

	throw redirect(303, `${listPath}/${data.id}`);
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

type SectionActionContext = {
	request: Request;
	classId: string;
	syllabusId: string;
	supabase: Client;
	user: User | null;
};

/**
 * True when the syllabus is one of the class's and the caller can read it.
 * Every section action checks it first: a section is tied to its syllabus by
 * the query, and the syllabus to the route's class here.
 */
async function syllabusInClass(
	supabase: Client,
	classId: string,
	syllabusId: string
): Promise<boolean> {
	const { data, error } = await supabase
		.from('class_syllabi')
		.select('id')
		.eq('id', syllabusId)
		.eq('class_id', classId)
		.maybeSingle();
	return !error && Boolean(data);
}

const sectionFailed = () => fail(400, { error: m.syllabus_error_failed() });

/** A wrong title is shown under its field, not as the toast `error` gives. */
const titleProblem = (sectionId: string | null) =>
	fail(400, { titleError: m.syllabus_section_error_title(), sectionId });

/** Adds a section, last in order, from the add form's `title`. */
export async function createSection({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: SectionActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const title = parseSectionTitle(formData.get('title'));
	if (title === null) return titleProblem(null);

	if (!(await syllabusInClass(supabase, classId, syllabusId))) return sectionFailed();

	const { data: last, error: lastError } = await supabase
		.from('class_syllabus_sections')
		.select('position')
		.eq('syllabus_id', syllabusId)
		.order('position', { ascending: false })
		.limit(1);
	if (lastError) return sectionFailed();

	const { data, error } = await supabase
		.from('class_syllabus_sections')
		.insert({
			syllabus_id: syllabusId,
			position: (last?.[0]?.position ?? 0) + 1,
			title,
			// The language the teacher is working in, so the title is drawn in
			// its font from the start; the edit form can change it.
			content_language: readContentLanguage(getLocale()),
			created_by: user.id
		})
		.select('id');

	if (error || !data || data.length === 0) return sectionFailed();

	return { success: true, action: 'sectionAdded' as const, sectionId: data[0].id };
}

export async function updateSection({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: SectionActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const sectionId = String(formData.get('sectionId') ?? '');
	const parsed = parseSectionForm(formData);
	if (!parsed.ok) {
		if (parsed.problem === 'title') return titleProblem(sectionId);
		const messages = {
			content: m.homework_error_content_invalid,
			size: m.syllabus_error_too_large,
			language: m.syllabus_error_language,
			links: m.homework_error_links_invalid
		};
		return fail(400, { error: messages[parsed.problem](), sectionId });
	}

	if (!(await syllabusInClass(supabase, classId, syllabusId))) return sectionFailed();

	// .select() + row check: RLS turns a forbidden update into zero rows, not
	// an error, which would otherwise look like a successful save.
	const { data, error } = await supabase
		.from('class_syllabus_sections')
		.update({
			title: parsed.value.title,
			content_doc: parsed.value.content,
			content_language: parsed.value.language,
			links: parsed.value.links,
			updated_at: new Date().toISOString()
		})
		.eq('id', sectionId)
		.eq('syllabus_id', syllabusId)
		.select('id');

	if (error || !data || data.length === 0) return sectionFailed();

	return { success: true, action: 'sectionSaved' as const, sectionId };
}

/**
 * Moves a section one place up or down (`direction`). The first one moved
 * up and the last one moved down stay where they are, without an error.
 */
export async function moveSection({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: SectionActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const sectionId = String(formData.get('sectionId') ?? '');
	const direction = formData.get('direction');
	if (direction !== 'up' && direction !== 'down') return sectionFailed();

	// The function checks section, syllabus and class together and swaps in
	// one statement; null means they don't belong together or RLS refused.
	const { data, error } = await supabase.rpc('move_syllabus_section', {
		p_section_id: sectionId,
		p_syllabus_id: syllabusId,
		p_class_id: classId,
		p_direction: direction
	});

	if (error || (data !== 'moved' && data !== 'unchanged')) return sectionFailed();

	return { success: true, action: 'sectionMoved' as const, sectionId };
}

export async function deleteSection({
	request,
	classId,
	syllabusId,
	supabase,
	user
}: SectionActionContext) {
	if (!user) return fail(401, { error: m.syllabus_error_failed() });

	const formData = await request.formData();
	const sectionId = String(formData.get('sectionId') ?? '');

	if (!(await syllabusInClass(supabase, classId, syllabusId))) return sectionFailed();

	const { data, error } = await supabase
		.from('class_syllabus_sections')
		.delete()
		.eq('id', sectionId)
		.eq('syllabus_id', syllabusId)
		.select('id');

	if (error || !data || data.length === 0) return sectionFailed();

	return { success: true, action: 'sectionDeleted' as const, sectionId };
}
