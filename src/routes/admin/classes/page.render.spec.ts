import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/**
 * Mobile-first story 9: the admin classes page as the server renders it.
 * Each row keeps its actions (edit, students, syllabi, copy code), Delete
 * is a red button posting ?/delete, and it is absent while the class has
 * approved or pending students. No iX is left.
 */
function cls(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name: `Class ${id}`,
		name_bo: `བོད ${id}`,
		name_de: null,
		code: `CODE${id}`,
		created_at: '2026-10-01T10:00:00Z',
		badge_subject: 'language',
		label: `Class ${id}`,
		syllabusCount: 0,
		approvedCount: 0,
		pendingCount: 0,
		...overrides
	};
}

function renderPage(classes: ReturnType<typeof cls>[]) {
	return render(Page, {
		props: {
			params: {},
			data: { classes, today: '2026-10-21', loadError: false },
			form: null
		} as never
	}).body;
}

/** The markup of one class's row (its `<tr>` up to the next row or the body's end). */
const row = (body: string, id: string) =>
	body.match(new RegExp(`<tr[^>]*data-class-id="${id}"[\\s\\S]*?</tr>`))?.[0] ?? '';

describe('admin classes (+page.svelte)', () => {
	it('renders the new-UI root with the create form', () => {
		const body = renderPage([cls('a')]);
		expect(body).toContain('data-ui="new"');
		expect(body).toContain('data-testid="page-counter"');
		// The name and subject fields keep their ids and posted names.
		expect(body).toMatch(/<input[^>]*id="name"[^>]*name="name"/);
		expect(body).toMatch(/<input[^>]*id="name-bo"[^>]*name="nameBo"/);
		expect(body).toMatch(/<input[^>]*id="name-de"[^>]*name="nameDe"/);
		expect(body).toMatch(/<select[^>]*id="new-class-subject"[^>]*name="badgeSubject"/);
		expect(body).toContain('id="new-class-from"');
	});

	it('gives each row its actions: edit, students, syllabi, copy code and a red Delete', () => {
		const body = renderPage([cls('a', { syllabusCount: 2 })]);
		const a = row(body, 'a');
		expect(a).toContain(m.classes_edit());
		expect(a).toContain('href="/admin/classes/a/students"');
		expect(a).toContain('href="/admin/classes/a/syllabus"');
		expect(a).toContain('CODEa');
		const del = a.match(/<form[^>]*action="\?\/delete"[\s\S]*?<\/form>/)?.[0] ?? '';
		expect(del).toMatch(/name="classId" value="a"/);
		expect(del).toMatch(/name="className" value="Class a"/);
		expect(del).toMatch(/<button[^>]*text-destructive/);
		expect(del).toContain(m.common_delete());
	});

	it('has no Delete while the class has approved or pending students', () => {
		const body = renderPage([
			cls('enrolled', { approvedCount: 1 }),
			cls('waiting', { pendingCount: 2 }),
			cls('empty')
		]);
		expect(row(body, 'enrolled')).not.toContain('action="?/delete"');
		expect(row(body, 'waiting')).not.toContain('action="?/delete"');
		expect(row(body, 'waiting')).toContain(m.classes_pending_summary({ pending: '2' }));
		expect(row(body, 'empty')).toContain('action="?/delete"');
		// Edit stays on every row.
		expect(row(body, 'enrolled')).toContain(m.classes_edit());
	});

	it('marks a class without a badge subject, and keeps the other names under the name', () => {
		const body = renderPage([cls('a', { badge_subject: null })]);
		expect(row(body, 'a')).toContain(m.badge_subject_not_set());
		expect(row(body, 'a')).toMatch(/<span[^>]*lang="bo"[^>]*>བོད a<\/span>/);
	});

	it('shows the empty line without a table when there is no class', () => {
		const body = renderPage([]);
		expect(body).toContain(m.classes_empty());
		expect(body).not.toContain('<table');
	});
});
