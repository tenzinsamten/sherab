/**
 * Homework content (#72-#74): the rich-text editor's document, stored as JSON
 * in `homework_assignments.content` (0034). Nothing here or in
 * `RichText.svelte` treats it as HTML: a document is only ever a tree of the
 * node and mark types below, checked on the way in and on the way out.
 */

export type RichTextMark =
	{ type: 'bold' | 'italic' | 'underline' } | { type: 'link'; attrs: { href: string } };

export type RichTextInline =
	{ type: 'text'; text: string; marks?: RichTextMark[] } | { type: 'hardBreak' };

export type RichTextBlock =
	| { type: 'paragraph'; content?: RichTextInline[] }
	| { type: 'heading'; attrs: { level: 2 | 3 }; content?: RichTextInline[] }
	| { type: 'bulletList' | 'orderedList'; content: RichTextListItem[] };

export type RichTextListItem = { type: 'listItem'; content: RichTextBlock[] };

export type RichTextDoc = { type: 'doc'; content: RichTextBlock[] };

/** The languages homework can be written in; selects the font (#74). */
export const CONTENT_LANGUAGES = ['bo', 'en', 'de'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];
export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = 'en';

/**
 * No limit a teacher can reach (#73): 1 MB of JSON is several hundred pages.
 * It only stops a broken or hostile request from storing unbounded data.
 * 0034's check constraint is the backstop behind it.
 */
export const MAX_CONTENT_BYTES = 1_000_000;

/** Lists inside lists: deeper than this is not something the editor makes. */
const MAX_DEPTH = 12;

const SIMPLE_MARKS = ['bold', 'italic', 'underline'] as const;

/** Links may only leave the app over these schemes (no `javascript:` etc.). */
export function isSafeHref(href: string): boolean {
	return /^(https?:\/\/|mailto:)\S+$/i.test(href);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanMarks(raw: unknown): RichTextMark[] | null {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) return null;
	const marks: RichTextMark[] = [];
	for (const mark of raw) {
		if (!isRecord(mark)) return null;
		if (SIMPLE_MARKS.includes(mark.type as (typeof SIMPLE_MARKS)[number])) {
			marks.push({ type: mark.type as (typeof SIMPLE_MARKS)[number] });
		} else if (mark.type === 'link') {
			const href = isRecord(mark.attrs) ? mark.attrs.href : undefined;
			if (typeof href !== 'string' || !isSafeHref(href)) return null;
			marks.push({ type: 'link', attrs: { href } });
		} else {
			return null;
		}
	}
	return marks;
}

function cleanInline(raw: unknown): RichTextInline[] | null {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) return null;
	const nodes: RichTextInline[] = [];
	for (const node of raw) {
		if (!isRecord(node)) return null;
		if (node.type === 'hardBreak') {
			nodes.push({ type: 'hardBreak' });
		} else if (node.type === 'text') {
			if (typeof node.text !== 'string' || node.text === '') return null;
			const marks = cleanMarks(node.marks);
			if (!marks) return null;
			nodes.push(
				marks.length > 0
					? { type: 'text', text: node.text, marks }
					: { type: 'text', text: node.text }
			);
		} else {
			return null;
		}
	}
	return nodes;
}

function cleanBlocks(raw: unknown, depth: number): RichTextBlock[] | null {
	if (!Array.isArray(raw) || depth > MAX_DEPTH) return null;
	const blocks: RichTextBlock[] = [];
	for (const node of raw) {
		if (!isRecord(node)) return null;
		if (node.type === 'paragraph' || node.type === 'heading') {
			const content = cleanInline(node.content);
			if (!content) return null;
			const inline = content.length > 0 ? { content } : {};
			if (node.type === 'paragraph') {
				blocks.push({ type: 'paragraph', ...inline });
			} else {
				const level = isRecord(node.attrs) ? node.attrs.level : undefined;
				if (level !== 2 && level !== 3) return null;
				blocks.push({ type: 'heading', attrs: { level }, ...inline });
			}
		} else if (node.type === 'bulletList' || node.type === 'orderedList') {
			if (!Array.isArray(node.content) || node.content.length === 0) return null;
			const items: RichTextListItem[] = [];
			for (const item of node.content) {
				if (!isRecord(item) || item.type !== 'listItem') return null;
				const content = cleanBlocks(item.content, depth + 1);
				if (!content || content.length === 0) return null;
				items.push({ type: 'listItem', content });
			}
			blocks.push({ type: node.type, content: items });
		} else {
			return null;
		}
	}
	return blocks;
}

/**
 * A clean copy of `value` if it is a document made only of the allowed node
 * and mark types, else null. Attributes the editor adds that the app doesn't
 * use (link target, list start, ...) are dropped, and so are empty paragraphs
 * at the end: the editor keeps one after a closing list or heading so the
 * cursor has somewhere to go, which would show as a blank last line.
 */
export function cleanDoc(value: unknown): RichTextDoc | null {
	if (!isRecord(value) || value.type !== 'doc') return null;
	const content = cleanBlocks(value.content, 0);
	if (!content) return null;
	let end = content.length;
	while (end > 0) {
		const last = content[end - 1];
		if (last.type !== 'paragraph' || last.content) break;
		end -= 1;
	}
	return { type: 'doc', content: content.slice(0, end) };
}

function blockHasText(block: RichTextBlock): boolean {
	if (block.type === 'bulletList' || block.type === 'orderedList') {
		return block.content.some((item) => item.content.some(blockHasText));
	}
	return (block.content ?? []).some((node) => node.type === 'text' && node.text.trim() !== '');
}

/** False for a document of only empty paragraphs, line breaks or spaces. */
export function hasText(doc: RichTextDoc): boolean {
	return doc.content.some(blockHasText);
}

export type ParsedContent =
	{ ok: true; value: RichTextDoc } | { ok: false; reason: 'required' | 'too_large' | 'invalid' };

/**
 * The `content` form field (the editor's document as a JSON string). Content
 * is required (#72), so an empty field or a document with no text fails.
 */
export function parseContent(raw: FormDataEntryValue | null): ParsedContent {
	const text = typeof raw === 'string' ? raw.trim() : '';
	if (!text) return { ok: false, reason: 'required' };
	if (new TextEncoder().encode(text).length > MAX_CONTENT_BYTES) {
		return { ok: false, reason: 'too_large' };
	}

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	const doc = cleanDoc(json);
	if (!doc) return { ok: false, reason: 'invalid' };
	if (!hasText(doc)) return { ok: false, reason: 'required' };
	return { ok: true, value: doc };
}

/**
 * Normalises a `content` value read from the database. The column is jsonb,
 * so anything that isn't a valid document (or has no text) reads as none.
 */
export function readContent(value: unknown): RichTextDoc | null {
	const doc = cleanDoc(value);
	return doc && hasText(doc) ? doc : null;
}

export function isContentLanguage(value: unknown): value is ContentLanguage {
	return CONTENT_LANGUAGES.includes(value as ContentLanguage);
}

/** A `content_language` value read from the database, or a locale tag. */
export function readContentLanguage(value: unknown): ContentLanguage {
	return isContentLanguage(value) ? value : DEFAULT_CONTENT_LANGUAGE;
}
