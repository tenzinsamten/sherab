import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { formatInstant } from '$lib/format';
import Page from './+page.svelte';

/** /board (spec-parent-message-board story 3): what the page draws from its data. */
type Data = {
	canPost: boolean;
	posts: unknown[];
	olderBefore: string | null;
	paged: boolean;
	loadError: boolean;
};

function draw(data: Partial<Data>) {
	return render(Page, {
		props: {
			params: {},
			data: {
				canPost: false,
				posts: [],
				olderBefore: null,
				paged: false,
				loadError: false,
				...data
			},
			form: null
		} as never
	}).body;
}

const createdAt = '2026-10-30T09:15:00.000000+00:00';
const post = (id: string, authorName: string, text: string) => ({
	id,
	authorName,
	content: {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	},
	contentLanguage: 'bo',
	createdAt
});

describe('board (+page.svelte)', () => {
	it('shows the post form only with canPost', () => {
		expect(draw({ canPost: false })).not.toContain('data-testid="board-form"');
		const body = draw({ canPost: true });
		expect(body).toContain('data-testid="board-form"');
		expect(body).toContain('action="?/post"');
		expect(body).toContain(m.board_post_submit());
	});

	it('draws each post with its author, time and body in its language', () => {
		const body = draw({ posts: [post('p1', 'Pema', 'Picnic on Saturday')] });
		expect(body).toContain('Pema');
		expect(body).toContain(`datetime="${createdAt}"`);
		expect(body).toContain(formatInstant(createdAt, true));
		expect(body).toContain('Picnic on Saturday');
		expect(body).toMatch(/class="rich-text[^"]*"[^>]*lang="bo"/);
	});

	it('shows "Former member" when the load gave that name', () => {
		const body = draw({ posts: [post('p1', m.board_former_member(), 'Hello')] });
		expect(body).toContain(m.board_former_member());
	});

	it('shows the empty state with no posts', () => {
		const body = draw({ posts: [] });
		expect(body).toContain('data-testid="empty-state"');
		expect(body).toContain(m.board_empty());
		expect(body).not.toContain('data-testid="board-posts"');
	});

	it('shows the load error instead of the list', () => {
		const body = draw({ loadError: true });
		expect(body).toContain('data-testid="board-load-error"');
		expect(body).toContain(m.board_load_error());
	});

	it('shows the "Older posts" link with the encoded cursor', () => {
		const body = draw({ posts: [post('p1', 'Pema', 'Hi')], olderBefore: createdAt });
		expect(body).toContain(m.board_older_posts());
		expect(body).toContain(`href="/board?before=${encodeURIComponent(createdAt)}"`);
		expect(draw({ posts: [post('p1', 'Pema', 'Hi')] })).not.toContain('data-testid="board-older"');
	});

	it('an older page links back to the newest posts; the first page does not', () => {
		const paged = draw({ posts: [post('p1', 'Pema', 'Hi')], paged: true });
		expect(paged).toContain(m.board_newest_posts());
		expect(paged).toContain('href="/board"');
		expect(draw({ posts: [], paged: true })).toContain('data-testid="board-newest"');
		expect(draw({ posts: [post('p1', 'Pema', 'Hi')] })).not.toContain('data-testid="board-newest"');
	});
});
