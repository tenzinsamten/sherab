import { describe, expect, it } from 'vitest';
import {
	MAX_DESCRIPTION_LENGTH,
	MAX_REFERENCE_LINKS,
	parseDescription,
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

describe('parseDescription', () => {
	it('trims and keeps line breaks inside the text', () => {
		expect(parseDescription('  Line one\nLine two  ')).toEqual({
			ok: true,
			value: 'Line one\nLine two'
		});
	});

	it('turns empty or missing into null', () => {
		expect(parseDescription('   ')).toEqual({ ok: true, value: null });
		expect(parseDescription(null)).toEqual({ ok: true, value: null });
	});

	it('accepts exactly the maximum and rejects one more', () => {
		expect(parseDescription('a'.repeat(MAX_DESCRIPTION_LENGTH)).ok).toBe(true);
		expect(parseDescription('a'.repeat(MAX_DESCRIPTION_LENGTH + 1)).ok).toBe(false);
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
