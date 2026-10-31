import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { formatInstant } from '$lib/format';
import { formatFileSize } from '$lib/pdf-files';
import Page from './+page.svelte';

/** /board (spec-parent-message-board story 3): what the page draws from its data. */
type Data = {
	canPost: boolean;
	canModerate: boolean;
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
				canModerate: false,
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
	createdAt,
	updatedAt: createdAt,
	mine: false,
	files: [] as { id: string; name: string; size: number }[]
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

	it('the form is multipart with a PDF file input and its hint (story 4)', () => {
		const body = draw({ canPost: true });
		expect(body).toContain('enctype="multipart/form-data"');
		expect(body).toMatch(/<input[^>]*type="file"[^>]*>/);
		const input = body.match(/<input[^>]*type="file"[^>]*>/)![0];
		expect(input).toContain('name="files"');
		expect(input).toContain('multiple');
		expect(input).toContain('accept="application/pdf,.pdf"');
		expect(body).toContain(m.board_file_label());
		expect(body).toContain('board-files-hint');
	});

	it("lists a post's files with open and download links (story 4)", () => {
		const fileId = '44444444-4444-4444-8444-444444444444';
		const body = draw({
			posts: [
				{ ...post('p1', 'Pema', 'Picnic'), files: [{ id: fileId, name: 'Flyer.pdf', size: 2048 }] },
				{ ...post('p2', 'Dolma', 'No files'), files: [] }
			]
		});
		expect(body.match(/data-testid="board-files"/g)).toHaveLength(1);
		expect(body).toContain(`href="/files/board/${fileId}"`);
		expect(body).toContain(`href="/files/board/${fileId}?download"`);
		expect(body).toContain('download="Flyer.pdf"');
		expect(body).toContain('Flyer.pdf');
		expect(body).toContain(formatFileSize(2048));
		expect(body).toContain(m.homework_file_download_label({ name: 'Flyer.pdf' }));
		expect(body).toContain(`aria-label="${m.board_file_list_label({ author: 'Pema' })}"`);
	});

	describe('edit and delete controls (story 5)', () => {
		const controls = (body: string) => ({
			edit: body.includes('data-testid="board-post-edit"'),
			del: body.includes('data-testid="board-post-delete"')
		});
		const own = { ...post('p1', 'Pema', 'Mine'), mine: true };
		const other = post('p2', 'Dolma', 'Theirs');

		it('the author who is still a poster: Edit and Delete', () => {
			expect(controls(draw({ canPost: true, posts: [own] }))).toEqual({ edit: true, del: true });
		});

		it('the author whose grant was revoked: Delete only', () => {
			expect(controls(draw({ canPost: false, posts: [own] }))).toEqual({ edit: false, del: true });
		});

		it("an admin or a teacher on someone else's post: Delete only", () => {
			expect(controls(draw({ canPost: true, canModerate: true, posts: [other] }))).toEqual({
				edit: false,
				del: true
			});
		});

		it("a student or another parent on someone else's post: no controls", () => {
			for (const canPost of [false, true]) {
				const body = draw({ canPost, posts: [other] });
				expect(controls(body)).toEqual({ edit: false, del: false });
				expect(body).not.toContain('data-testid="board-post-actions"');
			}
		});

		it('the buttons name the author; Delete posts the id to ?/delete', () => {
			const body = draw({ canPost: true, posts: [own] });
			expect(body).toContain(`aria-label="${m.board_edit_label({ author: 'Pema' })}"`);
			expect(body).toContain(`aria-label="${m.board_delete_label({ author: 'Pema' })}"`);
			expect(body).toContain('action="?/delete"');
			expect(body).toContain('name="postId" value="p1"');
			// The edit form only appears after Edit is pressed.
			expect(body).not.toContain('data-testid="board-edit-form"');
		});
	});

	describe('the "Edited" marker (story 5)', () => {
		const at = (updatedAt: string) => draw({ posts: [{ ...post('p1', 'Pema', 'Hi'), updatedAt }] });

		it('shows when updatedAt is over a minute after createdAt', () => {
			const body = at('2026-10-30T09:16:01.000000+00:00');
			expect(body).toContain('data-testid="board-post-edited"');
			expect(body).toContain(m.board_edit_marker());
		});

		it('not when it is the same or within a minute', () => {
			for (const updatedAt of [createdAt, '2026-10-30T09:16:00.000000+00:00']) {
				expect(at(updatedAt)).not.toContain('data-testid="board-post-edited"');
			}
		});
	});
});
