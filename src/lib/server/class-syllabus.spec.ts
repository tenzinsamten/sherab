import { describe, expect, it } from 'vitest';
import { MAX_CONTENT_BYTES } from '$lib/rich-text';
import { parseSyllabusForm, pickStudentSyllabus } from './class-syllabus';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

/** The syllabus form as posted: the editor's document as JSON, or '' when empty. */
function form(
	content: unknown | null,
	links: [string, string][] = [],
	language: string | null = 'en'
): FormData {
	const fd = new FormData();
	fd.set('content', content === null ? '' : JSON.stringify(content));
	if (language !== null) fd.set('contentLanguage', language);
	for (const [url, label] of links) {
		fd.append('linkUrl', url);
		fd.append('linkLabel', label);
	}
	return fd;
}

describe('parseSyllabusForm', () => {
	it('keeps the text, its language and the links', () => {
		const content = doc(paragraph('སློབ་ཚན་དང་པོ།'), paragraph('Alphabet'));
		expect(parseSyllabusForm(form(content, [['https://a.example', 'Songbook']], 'bo'))).toEqual({
			ok: true,
			value: {
				content,
				language: 'bo',
				links: [{ url: 'https://a.example', label: 'Songbook' }]
			}
		});
	});

	it('turns an empty syllabus into null so it can be cleared: the text is optional', () => {
		const cleared = { ok: true, value: { content: null, language: 'en', links: [] } };
		expect(parseSyllabusForm(form(null))).toEqual(cleared);
		expect(parseSyllabusForm(form(doc({ type: 'paragraph' })))).toEqual(cleared);
	});

	it('has no limit a teacher reaches: far more than the old 5000 characters saves (#75)', () => {
		expect(parseSyllabusForm(form(doc(paragraph('ཀ'.repeat(100_000))))).ok).toBe(true);
	});

	it('refuses a document over the safety cap', () => {
		const huge = doc(paragraph('a'.repeat(MAX_CONTENT_BYTES)));
		expect(parseSyllabusForm(form(huge))).toEqual({ ok: false, problem: 'size' });
	});

	it('refuses what is not a document the editor makes', () => {
		expect(parseSyllabusForm(form(doc({ type: 'image' })))).toEqual({
			ok: false,
			problem: 'content'
		});
		const html = new FormData();
		html.set('content', '<p>hello</p>');
		html.set('contentLanguage', 'en');
		expect(parseSyllabusForm(html)).toEqual({ ok: false, problem: 'content' });
	});

	it('refuses a language the form does not offer', () => {
		for (const language of [null, '', 'fr']) {
			expect(parseSyllabusForm(form(doc(paragraph('a')), [], language))).toEqual({
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
		expect(parseSyllabusForm(form(null, tooMany))).toEqual({ ok: false, problem: 'links' });
	});
});

describe('pickStudentSyllabus', () => {
	const syllabus = (schoolYear: number) => ({
		id: `s${schoolYear}`,
		schoolYear,
		content: null,
		contentLanguage: 'en' as const,
		links: [],
		updatedAt: '2026-09-25T00:00:00Z'
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
