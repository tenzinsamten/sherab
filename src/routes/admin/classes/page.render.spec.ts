import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
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

function renderPage(
	classes: ReturnType<typeof cls>[],
	form: Record<string, unknown> | null = null
) {
	return render(Page, {
		props: {
			params: {},
			data: { classes, today: '2026-10-21', loadError: false },
			form
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

	describe('form errors (#117b)', () => {
		const names = { name: 'Basics', nameBo: 'གཞི་རྩ', nameDe: 'Grundlagen' };
		const createForm = (error: string, values = names) => ({
			error,
			...values,
			badgeSubject: 'language',
			schedule: {
				weekdays: ['7'],
				startTime: '10:00',
				durationMinutes: '60',
				startsOn: '2026-10-21',
				endsOn: '',
				intervalWeeks: '1'
			}
		});
		/** The text of the message with `id`, or undefined. */
		const message = (html: string, id: string) =>
			html.match(new RegExp(`<p id="${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1].trim();
		const input = (html: string, id: string) =>
			html.match(new RegExp(`<input[^>]*\\sid="${id}"[^>]*>`))?.[0] ?? '';
		const marked = (html: string, id: string) => {
			expect(input(html, id)).toContain('aria-invalid="true"');
			expect(input(html, id)).toContain(`aria-describedby="${id}-error"`);
		};
		const unmarked = (html: string, ...ids: string[]) => {
			for (const id of ids) expect(input(html, id)).not.toMatch(/\saria-invalid=/);
		};
		/** The create form's markup. */
		const create = (html: string) =>
			html.match(/<section[^>]*data-testid="class-create"[\s\S]*?<\/section>/)?.[0] ?? '';
		const withoutAlert = (html: string) => {
			// The toast announces the error; the inline message has no live role.
			expect(html).not.toContain('role="alert"');
			return html;
		};

		it('create: a missing English or Tibetan name under its field', () => {
			for (const [error, id] of [
				[m.classes_error_name_required(), 'name'],
				[m.classes_error_name_bo_required(), 'name-bo']
			] as const) {
				const html = withoutAlert(renderPage([cls('a')], createForm(error)));
				expect(message(create(html), `${id}-error`)).toBe(error);
				marked(html, id);
				expect(html).not.toContain('id="form-error"');
			}
		});

		it('create: a duplicate under the field whose value it names', () => {
			for (const [field, id] of [
				['name', 'name'],
				['nameBo', 'name-bo'],
				['nameDe', 'name-de']
			] as const) {
				const error = m.classes_error_duplicate_name({ name: names[field] });
				const html = withoutAlert(renderPage([cls('a')], createForm(error)));
				expect(message(html, `${id}-error`)).toBe(error);
				marked(html, id);
				unmarked(html, ...['name', 'name-bo', 'name-de'].filter((other) => other !== id));
			}
		});

		it('create: code generation, a raw message and the 401 above the button, no field marked', () => {
			for (const form of [
				createForm(m.classes_code_generation_failed()),
				createForm('duplicate key violates something'),
				{ error: 'Not signed in.' }
			]) {
				const html = withoutAlert(renderPage([cls('a')], form));
				expect(message(create(html), 'form-error')).toBe(form.error);
				unmarked(html, 'name', 'name-bo', 'name-de');
			}
		});

		it('a delete failure stays toast-only', () => {
			const html = renderPage([cls('a')], { error: m.classes_error_delete_failed() });
			expect(html).not.toContain(m.classes_error_delete_failed());
		});

		it('rename: the error in its row only, with that row’s ids', () => {
			const error = m.classes_error_duplicate_name({ name: 'Taken' });
			const html = withoutAlert(
				renderPage([cls('a'), cls('b')], {
					error,
					renameId: 'b',
					renameValues: { name: 'Class b', nameBo: 'Taken', nameDe: '', badgeSubject: 'language' }
				})
			);
			expect(message(html, 'edit-b-name-bo-error')).toBe(error);
			marked(html, 'edit-b-name-bo');
			unmarked(html, 'edit-b-name', 'name', 'name-bo');
			expect(html).not.toContain('edit-a-');
			expect(create(html)).not.toContain(error);

			const failed = withoutAlert(
				renderPage([cls('a'), cls('b')], {
					error: m.classes_error_save_failed(),
					renameId: 'b',
					renameValues: { name: 'Class b', nameBo: 'x', nameDe: '', badgeSubject: 'language' }
				})
			);
			expect(message(failed, 'edit-b-form-error')).toBe(m.classes_error_save_failed());
			expect(failed).not.toContain('id="form-error"');
		});

		it('a create failure shows in the create form and in no class row', () => {
			const html = renderPage([cls('a')], createForm(m.classes_error_name_required()));
			expect(html).not.toContain('edit-a-');
			expect(message(create(html), 'name-error')).toBe(m.classes_error_name_required());
		});

		describe('under Tibetan', () => {
			const original = getLocale;
			afterEach(() => overwriteGetLocale(original));

			it('places the Tibetan text', () => {
				overwriteGetLocale(() => 'bo');
				const error = m.classes_error_name_bo_required();
				const html = renderPage([cls('a')], createForm(error));
				expect(message(html, 'name-bo-error')).toBe(error);
				expect(error).not.toBe(m.classes_error_name_bo_required({}, { locale: 'en' }));
			});
		});
	});
});
