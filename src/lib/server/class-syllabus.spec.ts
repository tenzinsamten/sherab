import type { SupabaseClient, User } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';
import type { Database } from '$lib/supabase/database.types';
import {
	createSection,
	deleteSection,
	listSyllabi,
	moveSection,
	parseSectionForm,
	pickStudentSyllabus,
	updateSection
} from './class-syllabus';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

/** The section form as posted: the editor's document as JSON, or '' when empty. */
function form(
	content: unknown | null,
	links: [string, string][] = [],
	language: string | null = 'en',
	title: string | null = 'Song 1'
): FormData {
	const fd = new FormData();
	if (title !== null) fd.set('title', title);
	fd.set('content', content === null ? '' : JSON.stringify(content));
	if (language !== null) fd.set('contentLanguage', language);
	for (const [url, label] of links) {
		fd.append('linkUrl', url);
		fd.append('linkLabel', label);
	}
	return fd;
}

describe('parseSectionForm', () => {
	it('keeps the title, the text, its language and the links', () => {
		const content = doc(paragraph('སློབ་ཚན་དང་པོ།'), paragraph('Alphabet'));
		expect(
			parseSectionForm(form(content, [['https://a.example', 'Songbook']], 'bo', '  གཞས་དང་པོ།  '))
		).toEqual({
			ok: true,
			value: {
				title: 'གཞས་དང་པོ།',
				content,
				language: 'bo',
				links: [{ url: 'https://a.example', label: 'Songbook' }]
			}
		});
	});

	it('needs a title of 1 to 200 characters', () => {
		for (const title of [null, '', '   ', 'a'.repeat(201), 'ཀ'.repeat(201)]) {
			expect(parseSectionForm(form(doc(paragraph('a')), [], 'en', title))).toEqual({
				ok: false,
				problem: 'title'
			});
		}
		for (const title of ['a', 'a'.repeat(200), 'ཀ'.repeat(200), `  ${'a'.repeat(200)}  `]) {
			expect(parseSectionForm(form(null, [], 'en', title)).ok).toBe(true);
		}
	});

	it('turns an empty description into null so it can be cleared: the text is optional', () => {
		const cleared = {
			ok: true,
			value: { title: 'Song 1', content: null, language: 'en', links: [] }
		};
		expect(parseSectionForm(form(null))).toEqual(cleared);
		expect(parseSectionForm(form(doc({ type: 'paragraph' })))).toEqual(cleared);
	});

	it('has no limit a teacher reaches: far more than the old 5000 characters saves (#75)', () => {
		expect(parseSectionForm(form(doc(paragraph('ཀ'.repeat(100_000))))).ok).toBe(true);
	});

	it('refuses a document over the safety cap', () => {
		const huge = doc(paragraph('a'.repeat(MAX_CONTENT_BYTES)));
		expect(parseSectionForm(form(huge))).toEqual({ ok: false, problem: 'size' });
	});

	it('refuses what is not a document the editor makes', () => {
		expect(parseSectionForm(form(doc({ type: 'image' })))).toEqual({
			ok: false,
			problem: 'content'
		});
		const html = new FormData();
		html.set('title', 'Song 1');
		html.set('content', '<p>hello</p>');
		html.set('contentLanguage', 'en');
		expect(parseSectionForm(html)).toEqual({ ok: false, problem: 'content' });
	});

	it('refuses a language the form does not offer', () => {
		for (const language of [null, '', 'fr']) {
			expect(parseSectionForm(form(doc(paragraph('a')), [], language))).toEqual({
				ok: false,
				problem: 'language'
			});
		}
	});

	it('reports invalid links', () => {
		const tooMany = Array.from(
			{ length: 11 },
			(_, i) => [`https://x.example/${i}`, ''] as [string, string]
		);
		expect(parseSectionForm(form(null, tooMany))).toEqual({ ok: false, problem: 'links' });
	});
});

describe('pickStudentSyllabus', () => {
	const syllabus = (schoolYear: number) => ({
		id: `s${schoolYear}`,
		schoolYear,
		sections: []
	});

	it("prefers the current school year's syllabus", () => {
		expect(pickStudentSyllabus([syllabus(2026), syllabus(2025), syllabus(2024)], 2025)?.id).toBe(
			's2025'
		);
	});

	it('falls back to the newest one when this year has none', () => {
		expect(pickStudentSyllabus([syllabus(2024), syllabus(2023)], 2025)?.id).toBe('s2024');
	});

	it('is null when the class has no syllabus', () => {
		expect(pickStudentSyllabus([], 2025)).toBeNull();
	});
});

type Result = { data: unknown; error: { message: string } | null };
type Call = {
	table: string;
	op: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
	values?: unknown;
	filters: Record<string, unknown>;
};

/**
 * A Supabase client that answers each `table:operation` (or `rpc:name`) from
 * `answers` and records what was asked. An operation without an answer
 * throws, so a test also proves what was never sent.
 */
function fakeSupabase(answers: Record<string, Result>) {
	const calls: Call[] = [];
	const answer = (key: string): Result => {
		if (!(key in answers)) throw new Error(`unexpected database call: ${key}`);
		return answers[key];
	};
	const client = {
		from(table: string) {
			const call: Call = { table, op: 'select', filters: {} };
			calls.push(call);
			const chain = {
				select: () => chain,
				insert: (values: unknown) => ((call.op = 'insert'), (call.values = values), chain),
				update: (values: unknown) => ((call.op = 'update'), (call.values = values), chain),
				delete: () => ((call.op = 'delete'), chain),
				eq: (column: string, value: unknown) => ((call.filters[column] = value), chain),
				order: () => chain,
				limit: () => chain,
				maybeSingle: () => chain,
				then: (resolve: (value: Result) => unknown) => resolve(answer(`${table}:${call.op}`))
			};
			return chain;
		},
		rpc(name: string, args: Record<string, unknown>) {
			calls.push({ table: name, op: 'rpc', filters: args });
			return Promise.resolve(answer(`rpc:${name}`));
		}
	};
	return { supabase: client as unknown as SupabaseClient<Database>, calls };
}

const user = { id: 'teacher-1' } as User;
const ok = (data: unknown): Result => ({ data, error: null });
const SYLLABUS_FOUND = ok({ id: 'syl-1' });
const SYLLABUS_MISSING = ok(null);

function context(answers: Record<string, Result>, fields: Record<string, string> | FormData) {
	const body = fields instanceof FormData ? fields : new FormData();
	if (!(fields instanceof FormData)) {
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
	}
	const { supabase, calls } = fakeSupabase(answers);
	return {
		calls,
		ctx: {
			request: new Request('http://localhost/x', { method: 'POST', body }),
			classId: 'class-1',
			syllabusId: 'syl-1',
			supabase,
			user: user as User | null
		}
	};
}

const writes = (calls: Call[]) => calls.filter((c) => c.op !== 'select');
const genericFailure = () => ({ status: 400, data: { error: m.syllabus_error_failed() } });

describe('createSection', () => {
	const originalGetLocale = getLocale;
	afterEach(() => overwriteGetLocale(originalGetLocale));

	it('adds the section last in order and returns it to open for editing', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabi:select': SYLLABUS_FOUND,
				'class_syllabus_sections:select': ok([{ position: 4 }]),
				'class_syllabus_sections:insert': ok([{ id: 'sec-9' }])
			},
			{ title: '  Song 1 ' }
		);
		expect(await createSection(ctx)).toEqual({
			success: true,
			action: 'sectionAdded',
			sectionId: 'sec-9'
		});
		expect(calls[0]).toMatchObject({
			table: 'class_syllabi',
			filters: { id: 'syl-1', class_id: 'class-1' }
		});
		expect(writes(calls)).toEqual([
			{
				table: 'class_syllabus_sections',
				op: 'insert',
				values: {
					syllabus_id: 'syl-1',
					position: 5,
					title: 'Song 1',
					content_language: 'en',
					created_by: 'teacher-1'
				},
				filters: {}
			}
		]);
	});

	it('stores the interface language of the request, so the title gets its font at once', async () => {
		for (const locale of ['bo', 'de'] as const) {
			overwriteGetLocale(() => locale);
			const { ctx, calls } = context(
				{
					'class_syllabi:select': SYLLABUS_FOUND,
					'class_syllabus_sections:select': ok([]),
					'class_syllabus_sections:insert': ok([{ id: 'sec-1' }])
				},
				{ title: 'གཞས་དང་པོ།' }
			);
			await createSection(ctx);
			expect(writes(calls)[0].values).toMatchObject({ content_language: locale });
		}
	});

	it('gives the first section of a syllabus position 1', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabi:select': SYLLABUS_FOUND,
				'class_syllabus_sections:select': ok([]),
				'class_syllabus_sections:insert': ok([{ id: 'sec-1' }])
			},
			{ title: 'Song 1' }
		);
		await createSection(ctx);
		expect(writes(calls)[0].values).toMatchObject({ position: 1 });
	});

	it('empty title: a field error, and nothing is read or saved', async () => {
		for (const title of ['', '   ', 'a'.repeat(201)]) {
			const { ctx, calls } = context({}, { title });
			expect(await createSection(ctx)).toMatchObject({
				status: 400,
				data: { titleError: m.syllabus_section_error_title(), sectionId: null }
			});
			expect(calls).toEqual([]);
		}
	});

	it("wrong class: a syllabus that is not this class's gets nothing, 400", async () => {
		const { ctx, calls } = context({ 'class_syllabi:select': SYLLABUS_MISSING }, { title: 'x' });
		expect(await createSection(ctx)).toMatchObject(genericFailure());
		expect(writes(calls)).toEqual([]);
	});

	it('zero rows from the insert (refused by RLS) is a failure, not a save', async () => {
		const { ctx } = context(
			{
				'class_syllabi:select': SYLLABUS_FOUND,
				'class_syllabus_sections:select': ok([]),
				'class_syllabus_sections:insert': ok([])
			},
			{ title: 'x' }
		);
		expect(await createSection(ctx)).toMatchObject(genericFailure());
	});

	it('signed out: 401 and no database call', async () => {
		const { ctx, calls } = context({}, { title: 'x' });
		expect(await createSection({ ...ctx, user: null })).toMatchObject({ status: 401 });
		expect(calls).toEqual([]);
	});
});

describe('updateSection', () => {
	const posted = (title = 'Song 1', language = 'de') => {
		const fd = form(doc(paragraph('Text')), [['https://a.example', 'A']], language, title);
		fd.set('sectionId', 'sec-1');
		return fd;
	};

	it('saves title, description, language and links on that section of that syllabus', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabi:select': SYLLABUS_FOUND,
				'class_syllabus_sections:update': ok([{ id: 'sec-1' }])
			},
			posted()
		);
		expect(await updateSection(ctx)).toEqual({
			success: true,
			action: 'sectionSaved',
			sectionId: 'sec-1'
		});
		const [write] = writes(calls);
		expect(write.filters).toEqual({ id: 'sec-1', syllabus_id: 'syl-1' });
		expect(write.values).toMatchObject({
			title: 'Song 1',
			content_doc: doc(paragraph('Text')),
			content_language: 'de',
			links: [{ url: 'https://a.example', label: 'A' }]
		});
	});

	it('empty title: a field error for that section, and nothing is saved', async () => {
		const { ctx, calls } = context({}, posted('  '));
		expect(await updateSection(ctx)).toMatchObject({
			status: 400,
			data: { titleError: m.syllabus_section_error_title(), sectionId: 'sec-1' }
		});
		expect(calls).toEqual([]);
	});

	it('invalid document, language or links: the same messages as before, nothing saved', async () => {
		const badDoc = form(doc({ type: 'image' }));
		const tooLarge = form(doc(paragraph('a'.repeat(MAX_CONTENT_BYTES))));
		const badLanguage = form(null, [], 'fr');
		const badLinks = form(
			null,
			Array.from({ length: 11 }, (_, i) => [`https://x.example/${i}`, ''] as [string, string])
		);
		const cases: [FormData, string][] = [
			[badDoc, m.homework_error_content_invalid()],
			[tooLarge, m.syllabus_error_too_large()],
			[badLanguage, m.syllabus_error_language()],
			[badLinks, m.homework_error_links_invalid()]
		];
		for (const [fd, message] of cases) {
			const { ctx, calls } = context({}, fd);
			expect(await updateSection(ctx)).toMatchObject({ status: 400, data: { error: message } });
			expect(calls).toEqual([]);
		}
	});

	it("wrong class: the syllabus is not this class's, so nothing is changed, 400", async () => {
		const { ctx, calls } = context({ 'class_syllabi:select': SYLLABUS_MISSING }, posted());
		expect(await updateSection(ctx)).toMatchObject(genericFailure());
		expect(writes(calls)).toEqual([]);
	});

	it('wrong syllabus: a section id that matches no row is a failure, 400', async () => {
		const { ctx } = context(
			{ 'class_syllabi:select': SYLLABUS_FOUND, 'class_syllabus_sections:update': ok([]) },
			posted()
		);
		expect(await updateSection(ctx)).toMatchObject(genericFailure());
	});

	it('a database error is a failure', async () => {
		const { ctx } = context(
			{
				'class_syllabi:select': SYLLABUS_FOUND,
				'class_syllabus_sections:update': { data: null, error: { message: 'boom' } }
			},
			posted()
		);
		expect(await updateSection(ctx)).toMatchObject(genericFailure());
	});
});

describe('moveSection', () => {
	const move = (answer: unknown, direction = 'up') =>
		context({ 'rpc:move_syllabus_section': ok(answer) }, { sectionId: 'sec-2', direction });

	it('asks the database to move the section within this syllabus and class', async () => {
		const { ctx, calls } = move('moved', 'down');
		expect(await moveSection(ctx)).toEqual({
			success: true,
			action: 'sectionMoved',
			sectionId: 'sec-2'
		});
		expect(calls).toEqual([
			{
				table: 'move_syllabus_section',
				op: 'rpc',
				filters: {
					p_section_id: 'sec-2',
					p_syllabus_id: 'syl-1',
					p_class_id: 'class-1',
					p_direction: 'down'
				}
			}
		]);
	});

	it('first moved up / last moved down: no change and no error', async () => {
		const { ctx } = move('unchanged');
		expect(await moveSection(ctx)).toMatchObject({ success: true });
	});

	it('wrong class or syllabus (the database answers null): 400', async () => {
		const { ctx } = move(null);
		expect(await moveSection(ctx)).toMatchObject(genericFailure());
	});

	it('a direction other than up / down is refused without asking the database', async () => {
		const { ctx, calls } = context({}, { sectionId: 'sec-2', direction: 'sideways' });
		expect(await moveSection(ctx)).toMatchObject(genericFailure());
		expect(calls).toEqual([]);
	});
});

describe('deleteSection', () => {
	it('deletes that section of that syllabus', async () => {
		const { ctx, calls } = context(
			{
				'class_syllabi:select': SYLLABUS_FOUND,
				'class_syllabus_sections:delete': ok([{ id: 'sec-1' }])
			},
			{ sectionId: 'sec-1' }
		);
		expect(await deleteSection(ctx)).toEqual({
			success: true,
			action: 'sectionDeleted',
			sectionId: 'sec-1'
		});
		expect(writes(calls)).toEqual([
			{
				table: 'class_syllabus_sections',
				op: 'delete',
				filters: { id: 'sec-1', syllabus_id: 'syl-1' }
			}
		]);
	});

	it('wrong class: nothing is deleted, 400', async () => {
		const { ctx, calls } = context(
			{ 'class_syllabi:select': SYLLABUS_MISSING },
			{ sectionId: 'sec-1' }
		);
		expect(await deleteSection(ctx)).toMatchObject(genericFailure());
		expect(writes(calls)).toEqual([]);
	});

	it("zero rows deleted (another syllabus's section, or refused by RLS) is a failure", async () => {
		const { ctx } = context(
			{ 'class_syllabi:select': SYLLABUS_FOUND, 'class_syllabus_sections:delete': ok([]) },
			{ sectionId: 'sec-1' }
		);
		expect(await deleteSection(ctx)).toMatchObject(genericFailure());
	});
});

describe('listSyllabi', () => {
	const section = (id: string, position: number, created_at: string) => ({
		id,
		position,
		title: id,
		content_doc: null,
		content_language: 'bo',
		links: [{ url: 'https://a.example', label: null }],
		created_at
	});

	it('gives each syllabus its sections in position order, ties by when they were added', async () => {
		const { supabase } = fakeSupabase({
			'class_syllabi:select': ok([
				{
					id: 'syl-1',
					school_year: 2026,
					class_syllabus_sections: [
						section('c', 3, '2026-09-01T00:00:00Z'),
						section('b', 1, '2026-09-03T00:00:00Z'),
						section('a', 1, '2026-09-02T00:00:00Z')
					]
				},
				{
					id: 'syl-0',
					school_year: 2025,
					class_syllabus_sections: []
				}
			])
		});
		const { syllabi, error } = await listSyllabi(supabase, 'class-1');
		expect(error).toBe(false);
		expect(syllabi.map((s) => s.sections.map((x) => x.id))).toEqual([['a', 'b', 'c'], []]);
		expect(syllabi[0].sections[0]).toEqual({
			id: 'a',
			title: 'a',
			content: null,
			contentLanguage: 'bo',
			links: [{ url: 'https://a.example', label: null }]
		});
	});
});
