import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RichTextEditor from './RichTextEditor.svelte';

/**
 * #129 (WCAG 2.5.3, label in name): the heading buttons' accessible names
 * start with the "H1"/"H2" they show, so a voice user can say what they see.
 */
describe('RichTextEditor heading buttons', () => {
	const { body } = render(RichTextEditor, {
		props: { id: 'content', label: 'Content', lang: 'en' }
	});
	const button = (text: string) =>
		body.match(new RegExp(`<button[^>]*>${text}</button>`))?.[0] ?? '';

	it('names H1 and H2 by their visible text first', () => {
		expect(button('H1')).toContain('aria-label="H1, Heading"');
		expect(button('H2')).toContain('aria-label="H2, Subheading"');
	});
});
