import { describe, expect, it } from 'vitest';
import { MAX_SYLLABUS_LENGTH, parseSyllabusForm } from './class-syllabus';

function form(syllabus: string, links: [string, string][] = []): FormData {
	const fd = new FormData();
	fd.set('syllabus', syllabus);
	for (const [url, label] of links) {
		fd.append('linkUrl', url);
		fd.append('linkLabel', label);
	}
	return fd;
}

describe('parseSyllabusForm', () => {
	it('keeps the text and the links', () => {
		expect(
			parseSyllabusForm(form('Term 1:\nAlphabet', [['https://a.example', 'Songbook']]))
		).toEqual({
			ok: true,
			value: {
				syllabus: 'Term 1:\nAlphabet',
				links: [{ url: 'https://a.example', label: 'Songbook' }]
			}
		});
	});

	it('turns an empty syllabus into null so it can be cleared', () => {
		expect(parseSyllabusForm(form('   '))).toEqual({
			ok: true,
			value: { syllabus: null, links: [] }
		});
	});

	it('allows up to the syllabus limit, which is longer than a homework description', () => {
		expect(parseSyllabusForm(form('a'.repeat(MAX_SYLLABUS_LENGTH))).ok).toBe(true);
		expect(parseSyllabusForm(form('a'.repeat(MAX_SYLLABUS_LENGTH + 1)))).toEqual({
			ok: false,
			problem: 'length'
		});
	});

	it('reports invalid links', () => {
		const tooMany = Array.from(
			{ length: 11 },
			(_, i) => [`https://x.example/${i}`, ''] as [string, string]
		);
		expect(parseSyllabusForm(form('', tooMany))).toEqual({ ok: false, problem: 'links' });
	});
});
