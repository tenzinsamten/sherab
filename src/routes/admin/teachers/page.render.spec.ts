import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

/**
 * Mobile-first story 9b: the admin teachers page as the server renders it.
 * The create form keeps its posted fields (native email, name and class
 * checkboxes); each row keeps Edit classes, Reset password (?/resetPassword)
 * and a red Remove (?/remove), each posting the row's teacherId; a teacher
 * who is also a parent carries the outline badge. No iX is left.
 */
type Teacher = {
	id: string;
	email: string;
	display_name: string | null;
	created_at: string;
	classes: { id: string; name: string; code: string }[];
	alsoParent: boolean;
};

const classes = [
	{ id: 'c1', name: 'Class One', name_bo: null, name_de: null, code: 'ONE' },
	{ id: 'c2', name: 'Class Two', name_bo: null, name_de: null, code: 'TWO' }
];

function teacher(id: string, overrides: Partial<Teacher> = {}): Teacher {
	return {
		id,
		email: `${id}@example.test`,
		display_name: `Teacher ${id}`,
		created_at: '2026-10-01T10:00:00Z',
		classes: [],
		alsoParent: false,
		...overrides
	};
}

function renderPage(data: { teachers?: Teacher[]; classes?: typeof classes }) {
	return render(Page, {
		props: {
			params: {},
			data: { teachers: [], classes, loadError: false, ...data },
			form: null
		} as never
	}).body.replace(/<!--[\s\S]*?-->/g, ''); // without Svelte's hydration markers
}

/** The markup of one teacher's row (its `<tr>` up to the row's end). */
const row = (body: string, id: string) =>
	body.match(new RegExp(`<tr[^>]*data-teacher-id="${id}"[\\s\\S]*?</tr>`))?.[0] ?? '';

describe('admin teachers (+page.svelte)', () => {
	it('renders the new-UI root with the native create form and no iX', () => {
		const body = renderPage({ teachers: [teacher('a')] });
		expect(body).toContain('data-ui="new"');
		expect(body).not.toMatch(/<ix-/);
		expect(body).toContain('data-testid="page-counter"');
		expect(body).toMatch(/<form[^>]*action="\?\/create"/);
		expect(body).toMatch(/<input[^>]*type="email"[^>]*id="email"[^>]*name="email"[^>]*required/);
		expect(body).toMatch(/<input[^>]*id="displayName"[^>]*name="displayName"/);
		const create = body.match(/<form[^>]*action="\?\/create"[\s\S]*?<\/form>/)?.[0] ?? '';
		expect(create).toMatch(/<input[^>]*type="checkbox"[^>]*name="classIds"[^>]*value="c1"/);
		expect(create).toMatch(/<input[^>]*type="checkbox"[^>]*name="classIds"[^>]*value="c2"/);
		expect(create).toContain('Class One (ONE)');
		expect(create).not.toMatch(/name="promote"/);
		expect(create).toContain(m.teachers_create_submit());
	});

	it('gives each row Edit classes, Reset password and a red Remove posting its teacherId', () => {
		const body = renderPage({
			teachers: [teacher('a', { classes: [{ id: 'c1', name: 'Class One', code: 'ONE' }] })]
		});
		const a = row(body, 'a');
		expect(a).toContain('Teacher a');
		expect(a).toContain('a@example.test');
		expect(a).toContain('Class One (ONE)');
		expect(a).toContain(m.teachers_edit_classes());
		const reset = a.match(/<form[^>]*action="\?\/resetPassword"[\s\S]*?<\/form>/)?.[0] ?? '';
		expect(reset).toMatch(/name="teacherId" value="a"/);
		expect(reset).toContain(m.teachers_reset_password());
		expect(reset).not.toMatch(/<button[^>]*bg-destructive/);
		const remove = a.match(/<form[^>]*action="\?\/remove"[\s\S]*?<\/form>/)?.[0] ?? '';
		expect(remove).toMatch(/name="teacherId" value="a"/);
		expect(remove).toMatch(/<button[^>]*text-destructive/);
		expect(remove).toContain(m.teachers_remove());
	});

	it('marks a teacher who is also a parent, and shows None without classes', () => {
		const body = renderPage({ teachers: [teacher('p', { alsoParent: true }), teacher('t')] });
		const p = row(body, 'p');
		expect(p).toContain('data-slot="badge"');
		// The outline variant: a border, no fill.
		expect(p).toContain(`border-border text-foreground`);
		expect(p).toContain(`>${m.teachers_also_parent()}</span>`);
		expect(row(body, 't')).not.toContain(m.teachers_also_parent());
		expect(row(body, 't')).toContain(m.teachers_none());
	});

	it('shows the "add a class first" text instead of the form when there is no class', () => {
		const body = renderPage({ classes: [], teachers: [teacher('a')] });
		expect(body).toContain(m.teachers_need_class_first());
		expect(body).not.toContain('action="?/create"');
	});

	it('shows the empty line without a table when there is no teacher', () => {
		const body = renderPage({});
		expect(body).toContain(m.teachers_empty());
		expect(body).not.toContain('<table');
	});
});
