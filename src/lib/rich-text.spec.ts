import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RichText from './components/RichText.svelte';
import {
	MAX_CONTENT_BYTES,
	cleanDoc,
	firstLine,
	hasText,
	isSafeHref,
	parseContent,
	readContent,
	readContentLanguage,
	type RichTextDoc
} from './rich-text';

const text = (value: string, marks?: unknown[]) =>
	marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const paragraph = (...content: unknown[]) =>
	content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: unknown[]) => ({ type: 'doc', content });

/** Everything the editor's toolbar can produce, as Tiptap serialises it. */
const FULL = doc(
	{ type: 'heading', attrs: { level: 2 }, content: [text('Week 3')] },
	paragraph(
		text('Read '),
		text('page 4', [{ type: 'bold' }, { type: 'italic' }]),
		{ type: 'hardBreak' },
		text('aloud', [{ type: 'underline' }])
	),
	{
		type: 'bulletList',
		content: [
			{ type: 'listItem', content: [paragraph(text('ཀ'))] },
			{
				type: 'listItem',
				content: [
					paragraph(text('ཁ')),
					{
						type: 'orderedList',
						attrs: { start: 1, type: null },
						content: [{ type: 'listItem', content: [paragraph(text('one'))] }]
					}
				]
			}
		]
	},
	{ type: 'heading', attrs: { level: 3 }, content: [text('More')] },
	paragraph(
		text('song', [
			{
				type: 'link',
				attrs: {
					href: 'https://example.org/song',
					target: '_blank',
					rel: 'noopener noreferrer nofollow',
					class: null
				}
			}
		])
	)
);

describe('cleanDoc', () => {
	it('keeps every node and mark the editor makes, dropping unused attributes', () => {
		const clean = cleanDoc(FULL);
		expect(clean).not.toBeNull();
		const blocks = clean!.content;
		expect(blocks.map((b) => b.type)).toEqual([
			'heading',
			'paragraph',
			'bulletList',
			'heading',
			'paragraph'
		]);
		// Link target / rel / class and the list's start are not stored.
		expect(blocks[4]).toEqual({
			type: 'paragraph',
			content: [
				{
					type: 'text',
					text: 'song',
					marks: [{ type: 'link', attrs: { href: 'https://example.org/song' } }]
				}
			]
		});
		expect(JSON.stringify(clean)).not.toContain('start');
	});

	it('is stable: cleaning a clean document changes nothing', () => {
		const clean = cleanDoc(FULL);
		expect(cleanDoc(clean)).toEqual(clean);
	});

	it.each([
		['not an object', 'text'],
		['not a doc', paragraph(text('a'))],
		['an unknown block', doc({ type: 'image', attrs: { src: 'https://example.org/x.png' } })],
		['a code block', doc({ type: 'codeBlock', content: [text('x')] })],
		['an unknown inline node', doc(paragraph({ type: 'mention', attrs: { id: '1' } }))],
		['an unknown mark', doc(paragraph(text('a', [{ type: 'strike' }])))],
		['a heading level the editor does not offer', doc({ type: 'heading', attrs: { level: 1 } })],
		['an empty text node', doc(paragraph(text('')))],
		['a list without items', doc({ type: 'bulletList', content: [] })],
		['a list item outside a list', doc({ type: 'listItem', content: [paragraph(text('a'))] })],
		['a block inside a paragraph', doc(paragraph(paragraph(text('a'))))]
	])('refuses %s', (_name, value) => {
		expect(cleanDoc(value)).toBeNull();
	});

	it.each(['javascript:alert(1)', 'data:text/html,<script>1</script>', '/relative', 'ftp://x.org'])(
		'refuses a link to %s',
		(href) => {
			expect(cleanDoc(doc(paragraph(text('a', [{ type: 'link', attrs: { href } }]))))).toBeNull();
		}
	);

	it('refuses lists nested deeper than the editor makes', () => {
		let nested: unknown = paragraph(text('deep'));
		for (let i = 0; i < 20; i++) {
			nested = { type: 'bulletList', content: [{ type: 'listItem', content: [nested] }] };
		}
		expect(cleanDoc(doc(nested))).toBeNull();
	});
});

describe('isSafeHref', () => {
	it('allows http, https and mailto only', () => {
		expect(isSafeHref('https://example.org')).toBe(true);
		expect(isSafeHref('http://example.org/a?b=c')).toBe(true);
		expect(isSafeHref('mailto:teacher@example.org')).toBe(true);
		expect(isSafeHref('JavaScript:alert(1)')).toBe(false);
		expect(isSafeHref('https://')).toBe(false);
		expect(isSafeHref('example.org')).toBe(false);
	});
});

describe('firstLine', () => {
	it('is the first line with text, without its formatting', () => {
		const formatted = cleanDoc(
			doc(
				paragraph(),
				paragraph(
					text('  Term '),
					text('one', [{ type: 'bold' }]),
					{ type: 'hardBreak' },
					text('x')
				),
				paragraph(text('later'))
			)
		)!;
		expect(firstLine(formatted)).toBe('Term one');
	});

	it('skips a leading line break and looks inside lists', () => {
		const broken = cleanDoc(doc(paragraph({ type: 'hardBreak' }, text('after the break'))))!;
		expect(firstLine(broken)).toBe('after the break');
		const list = cleanDoc(
			doc({
				type: 'bulletList',
				content: [
					{ type: 'listItem', content: [paragraph()] },
					{ type: 'listItem', content: [paragraph(text('ཀ'))] }
				]
			})
		)!;
		expect(firstLine(list)).toBe('ཀ');
	});

	it('is empty for a document without text', () => {
		expect(firstLine(cleanDoc(doc(paragraph(text('  '))))!)).toBe('');
	});
});

describe('hasText', () => {
	it('is false for empty paragraphs, line breaks and spaces', () => {
		const empty = cleanDoc(
			doc(paragraph(), paragraph({ type: 'hardBreak' }), paragraph(text('  ')))
		);
		expect(empty && hasText(empty)).toBe(false);
	});

	it('finds text inside a list', () => {
		const list = cleanDoc(
			doc({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('a'))] }] })
		);
		expect(list && hasText(list)).toBe(true);
	});
});

describe('parseContent', () => {
	it('returns the clean document', () => {
		const parsed = parseContent(JSON.stringify(FULL));
		expect(parsed).toEqual({ ok: true, value: cleanDoc(FULL) });
	});

	it('requires content', () => {
		expect(parseContent(null)).toEqual({ ok: false, reason: 'required' });
		expect(parseContent('   ')).toEqual({ ok: false, reason: 'required' });
		expect(parseContent(JSON.stringify(doc(paragraph())))).toEqual({
			ok: false,
			reason: 'required'
		});
	});

	it('refuses what is not a document', () => {
		expect(parseContent('<p>hello</p>')).toEqual({ ok: false, reason: 'invalid' });
		expect(parseContent(JSON.stringify(doc({ type: 'image' })))).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('has no limit a teacher reaches: far more than the old 2000 characters saves (#73)', () => {
		const long = doc(paragraph(text('ཀ'.repeat(100_000))));
		expect(parseContent(JSON.stringify(long)).ok).toBe(true);
	});

	it('refuses a document over the safety cap, counted in bytes', () => {
		// Tibetan letters are three bytes each in UTF-8.
		const huge = doc(paragraph(text('ཀ'.repeat(Math.ceil(MAX_CONTENT_BYTES / 3)))));
		expect(parseContent(JSON.stringify(huge))).toEqual({ ok: false, reason: 'too_large' });
	});
});

describe('readContent / readContentLanguage', () => {
	it('reads a stored document and treats anything else as none', () => {
		expect(readContent(FULL)).toEqual(cleanDoc(FULL));
		expect(readContent(null)).toBeNull();
		expect(readContent({ type: 'doc', content: [{ type: 'script' }] })).toBeNull();
		expect(readContent(doc(paragraph()))).toBeNull();
	});

	it('falls back to English for an unknown language', () => {
		expect(readContentLanguage('bo')).toBe('bo');
		expect(readContentLanguage('de')).toBe('de');
		expect(readContentLanguage('fr')).toBe('en');
		expect(readContentLanguage(null)).toBe('en');
	});
});

describe('RichText', () => {
	/**
	 * Rendered HTML without Svelte's hydration comments and scoping classes.
	 * Whitespace is left exactly as rendered: a paragraph is shown with
	 * `white-space: pre-wrap`, so any the template added would be visible.
	 */
	function html(content: RichTextDoc, lang: 'bo' | 'en' | 'de' = 'en'): string {
		return render(RichText, { props: { content, lang } })
			.body.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/ class="[^"]*svelte-[^"]*"/g, '')
			.trim();
	}

	it('draws the document in its language, with no whitespace added inside a line', () => {
		expect(html(cleanDoc(FULL)!, 'bo')).toBe(
			'<div lang="bo">' +
				'<h2>Week 3</h2>' +
				'<p>Read <strong><em>page 4</em></strong><br/><u>aloud</u></p>' +
				'<ul><li><p>ཀ</p></li><li><p>ཁ</p><ol><li><p>one</p></li></ol></li></ul>' +
				'<h3>More</h3>' +
				'<p><a href="https://example.org/song" target="_blank" rel="noopener noreferrer">song</a></p>' +
				'</div>'
		);
	});

	it('keeps a run of marked text touching its neighbours', () => {
		const tight = cleanDoc(doc(paragraph(text('b'), text('ol', [{ type: 'bold' }]), text('d'))))!;
		expect(html(tight)).toBe('<div lang="en"><p>b<strong>ol</strong>d</p></div>');
	});

	it('shows an empty paragraph as a blank line', () => {
		const spaced = cleanDoc(doc(paragraph(text('a')), paragraph(), paragraph(text('b'))))!;
		expect(html(spaced)).toBe('<div lang="en"><p>a</p><p><br/></p><p>b</p></div>');
	});

	it('escapes text: typed markup stays text', () => {
		const typed = cleanDoc(doc(paragraph(text('<img src=x onerror=alert(1)>'))))!;
		expect(html(typed)).toBe('<div lang="en"><p>&lt;img src=x onerror=alert(1)></p></div>');
	});
});
