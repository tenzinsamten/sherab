import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import {
	MAX_REFERENCE_LINKS,
	parseHomeworkContent,
	parseReferenceLinks,
	readReferenceLinks
} from './homework-details';

function linkForm(rows: [string, string][]): FormData {
	const fd = new FormData();
	for (const [url, label] of rows) {
		fd.append('linkUrl', url);
		fd.append('linkLabel', label);
	}
	return fd;
}

function contentForm(content: string | null, language: string | null): FormData {
	const fd = new FormData();
	if (content !== null) fd.set('content', content);
	if (language !== null) fd.set('contentLanguage', language);
	return fd;
}

const DOC = {
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read page 4' }] }]
};

describe('parseHomeworkContent', () => {
	it('returns the document and its language', () => {
		expect(parseHomeworkContent(contentForm(JSON.stringify(DOC), 'bo'))).toEqual({
			ok: true,
			content: DOC,
			language: 'bo'
		});
	});

	it('requires content', () => {
		const missing = parseHomeworkContent(contentForm(null, 'en'));
		const empty = parseHomeworkContent(
			contentForm(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }), 'en')
		);
		expect(missing).toEqual({ ok: false, error: m.homework_error_content_required() });
		expect(empty).toEqual({ ok: false, error: m.homework_error_content_required() });
	});

	it('refuses a document that is not one the editor makes', () => {
		expect(parseHomeworkContent(contentForm('<p>hello</p>', 'en'))).toEqual({
			ok: false,
			error: m.homework_error_content_invalid()
		});
	});

	it('refuses a language the form does not offer', () => {
		for (const language of [null, '', 'fr']) {
			expect(parseHomeworkContent(contentForm(JSON.stringify(DOC), language))).toEqual({
				ok: false,
				error: m.homework_error_content_language()
			});
		}
	});
});

describe('parseReferenceLinks', () => {
	it('pairs urls with labels in order and nulls empty labels', () => {
		expect(
			parseReferenceLinks(
				linkForm([
					['https://a.example', 'Song'],
					[' https://b.example ', '  ']
				])
			)
		).toEqual({
			ok: true,
			value: [
				{ url: 'https://a.example', label: 'Song' },
				{ url: 'https://b.example', label: null }
			]
		});
	});

	it('drops rows without a url, even when they have a label', () => {
		expect(parseReferenceLinks(linkForm([['', 'Lonely label']]))).toEqual({ ok: true, value: [] });
	});

	it('returns an empty list when no link fields are sent', () => {
		expect(parseReferenceLinks(new FormData())).toEqual({ ok: true, value: [] });
	});

	it('rejects more than the maximum number of links', () => {
		const rows = Array.from(
			{ length: MAX_REFERENCE_LINKS + 1 },
			(_, i) => [`https://x.example/${i}`, ''] as [string, string]
		);
		expect(parseReferenceLinks(linkForm(rows)).ok).toBe(false);
		expect(parseReferenceLinks(linkForm(rows.slice(0, MAX_REFERENCE_LINKS))).ok).toBe(true);
	});

	it('rejects an over-long label', () => {
		expect(parseReferenceLinks(linkForm([['https://a.example', 'x'.repeat(101)]])).ok).toBe(false);
	});
});

describe('readReferenceLinks', () => {
	it('keeps well-formed entries and drops the rest', () => {
		expect(
			readReferenceLinks([
				{ url: 'https://a.example', label: 'A' },
				{ url: 'https://b.example', label: null },
				{ label: 'no url' },
				'junk',
				null
			])
		).toEqual([
			{ url: 'https://a.example', label: 'A' },
			{ url: 'https://b.example', label: null }
		]);
	});

	it('returns an empty list for a non-array value', () => {
		expect(readReferenceLinks(null)).toEqual([]);
		expect(readReferenceLinks({})).toEqual([]);
	});
});
