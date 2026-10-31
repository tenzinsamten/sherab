import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/parent/children/c1/homework/i1') }
}));

/**
 * spec-parent-managed-homework story 3: Mark done only for a parent-managed
 * child's assigned, not archived item; the class name is plain text.
 */
const CHILD = '11111111-2222-4333-8444-555555555555';

function renderPage(
	over: {
		status?: string;
		archived?: boolean;
		parentManaged?: boolean;
		className?: string | null;
		doneBy?: { self: true } | { self: false; name: string } | null;
	} = {}
) {
	return render(Page, {
		props: {
			params: { id: CHILD, instanceId: 'i1' },
			form: null,
			data: {
				child: { id: CHILD, name: 'Dawa' },
				item: {
					instanceId: 'i1',
					assignmentId: 'a1',
					classId: 'c1',
					title: 'Read page 4',
					contentLanguage: 'en',
					skillArea: 'language',
					dueDate: '2026-10-20',
					status: over.status ?? 'assigned',
					overdue: false,
					isRecurring: false,
					content: null,
					referenceLinks: [{ url: 'https://example.com/book', label: 'Book' }]
				},
				className: over.className === undefined ? 'Alphabet' : over.className,
				files: [{ id: 'f1', name: 'Worksheet.pdf', size: 300 * 1024 }],
				archived: over.archived ?? false,
				parentManaged: over.parentManaged ?? true,
				doneBy: over.doneBy ?? null,
				loadError: false
			}
		} as never
	}).body;
}

const markButton = new RegExp(`<button[^>]*>[\\s\\S]*?${m.student_homework_mark_done()}`);

describe('parent homework detail (+page.svelte)', () => {
	it('flag on + assigned + not archived: Mark done posts to ?/markDone', () => {
		const body = renderPage();
		expect(body).toContain('action="?/markDone"');
		expect(body).toMatch(markButton);
	});

	it.each([
		['flag off', { parentManaged: false }],
		['done', { status: 'done' }],
		['reviewed', { status: 'reviewed' }],
		['archived', { archived: true }]
	])('%s: no Mark done', (_label, over) => {
		const body = renderPage(over);
		expect(body).not.toContain('action="?/markDone"');
		expect(body).not.toMatch(markButton);
	});

	it('shows the status badge from the item', () => {
		const status = (body: string) =>
			body.match(/<p[^>]*data-testid="homework-status"[\s\S]*?<\/p>/)?.[0] ?? '';
		expect(status(renderPage({ status: 'done' }))).toContain(m.student_homework_status_done());
		expect(status(renderPage({ status: 'reviewed' }))).toContain(
			m.student_homework_status_reviewed()
		);
	});

	it('story 5: the status line names who marked it done', () => {
		const status = (body: string) =>
			body.match(/<p[^>]*data-testid="homework-status"[\s\S]*?<\/p>/)?.[0] ?? '';
		expect(status(renderPage({ status: 'done', doneBy: { self: true } }))).toContain(
			m.child_homework_done_by_you()
		);
		expect(
			status(renderPage({ status: 'reviewed', doneBy: { self: false, name: 'Pema' } }))
		).toContain(m.child_homework_done_by({ name: 'Pema' }));
		expect(renderPage({ status: 'done' })).not.toContain('data-testid="homework-done-by"');
	});

	it('the class name is plain text, with no /student link', () => {
		const body = renderPage();
		const kicker = body.match(/<p[^>]*data-testid="homework-class"[\s\S]*?<\/p>/)?.[0] ?? '';
		expect(kicker).toContain('Alphabet');
		expect(kicker).not.toContain('<a');
		expect(body).not.toContain('/student/');
	});

	it('a class the parent cannot read shows "former class"', () => {
		const body = renderPage({ className: null });
		expect(body).toContain(m.student_class_former());
	});

	it('shows links and files, and the breadcrumb back to the Homework tab', () => {
		const body = renderPage();
		expect(body).toContain('https://example.com/book');
		expect(body).toContain('href="/files/homework/f1"');
		expect(body).toContain(`href="/parent/children/${CHILD}?tab=homework"`);
		expect(body).toContain('Dawa');
	});
});
