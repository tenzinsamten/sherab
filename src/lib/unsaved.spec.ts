import { describe, expect, it, vi } from 'vitest';

// The guard's module registers navigation hooks; only the pure check is tested here.
vi.mock('$app/navigation', () => ({
	afterNavigate: () => {},
	beforeNavigate: () => {},
	goto: async () => {}
}));

const { formSignature, isChanged } = await import('./unsaved.svelte');

function form(entries: [string, string | File][]): FormData {
	const data = new FormData();
	for (const [name, value] of entries) data.append(name, value);
	return data;
}

const doc = (text: string) =>
	JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});

describe('isChanged', () => {
	const base: [string, string | File][] = [
		['title', 'Read page 3'],
		['skillArea', 'language'],
		['content', doc('Read it aloud')],
		['files', new File([], '')]
	];
	const snapshot = formSignature(form(base));

	it('is not changed when nothing was touched (no snapshot)', () => {
		expect(isChanged(null, form([['title', 'anything']]))).toBe(false);
	});

	it('is not changed for the same values', () => {
		expect(isChanged(snapshot, form(base))).toBe(false);
	});

	it('is changed when a field differs', () => {
		const typed = form(base.map(([k, v]) => [k, k === 'title' ? 'Read page 4' : v]));
		expect(isChanged(snapshot, typed)).toBe(true);
	});

	it("is changed when the editor's hidden JSON differs", () => {
		const typed = form(base.map(([k, v]) => [k, k === 'content' ? doc('Read it twice') : v]));
		expect(isChanged(snapshot, typed)).toBe(true);
	});

	it('is changed when a file is chosen, by name and size', () => {
		const pdf = new File(['%PDF-1'], 'sheet.pdf', { type: 'application/pdf' });
		const chosen = form(base.map(([k, v]) => [k, k === 'files' ? pdf : v]));
		expect(isChanged(snapshot, chosen)).toBe(true);

		const withPdf = formSignature(chosen);
		const samePdf = new File(['%PDF-2'], 'sheet.pdf', { type: 'application/pdf' });
		const biggerPdf = new File(['%PDF-1.7'], 'sheet.pdf', { type: 'application/pdf' });
		const again = (file: File) => form(base.map(([k, v]) => [k, k === 'files' ? file : v]));
		expect(isChanged(withPdf, again(samePdf))).toBe(false);
		expect(isChanged(withPdf, again(biggerPdf))).toBe(true);
	});

	it('is changed when a checkbox is ticked (a new entry)', () => {
		expect(isChanged(snapshot, form([...base, ['studentIds', 's1']]))).toBe(true);
	});

	it('is not changed when typed and then undone', () => {
		const typed = form(base.map(([k, v]) => [k, k === 'title' ? 'Read page 3!' : v]));
		expect(isChanged(snapshot, typed)).toBe(true);
		expect(isChanged(snapshot, form(base))).toBe(false);
	});
});
