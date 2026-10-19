import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TextWithLinks from './TextWithLinks.svelte';

/** Mobile-first story 4: the reference links, or the caller's empty text. */
describe('TextWithLinks', () => {
	it('shows the empty text when there are no links', () => {
		const { body } = render(TextWithLinks, {
			props: { links: [], empty: 'No details yet.' }
		});
		expect(body).toContain('No details yet.');
		expect(body).not.toContain('<a');
	});

	it('shows a link, opening in a new tab, and no empty text', () => {
		const { body } = render(TextWithLinks, {
			props: {
				links: [{ url: 'https://example.org/sheet', label: 'Sheet' }],
				empty: 'No details yet.'
			}
		});
		expect(body).toMatch(
			/<a href="https:\/\/example\.org\/sheet" target="_blank" rel="noopener noreferrer"[^>]*>[\s\S]*Sheet[\s\S]*<\/a>/
		);
		expect(body).not.toContain('No details yet.');
	});

	it('renders nothing with no links and no empty text', () => {
		const { body } = render(TextWithLinks, { props: { links: [] } });
		expect(body.replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
	});
});
