import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import Page from './+page.svelte';

/**
 * Mobile-first story 9: the admin teams page as the server renders it.
 * Each row keeps its actions (open the team, edit names), Delete is a red
 * button posting ?/delete, and it is absent while the team has members.
 * No iX is left.
 */
function team(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name: `Team ${id}`,
		name_bo: `སྡེ ${id}`,
		name_de: null,
		created_at: '2026-10-01T10:00:00Z',
		label: `Team ${id}`,
		memberCount: 0,
		...overrides
	};
}

function renderPage(teams: ReturnType<typeof team>[], form: Record<string, unknown> | null = null) {
	return render(Page, {
		props: { params: {}, data: { teams, loadError: false }, form } as never
	}).body;
}

const row = (body: string, id: string) =>
	body.match(new RegExp(`<tr[^>]*data-team-id="${id}"[\\s\\S]*?</tr>`))?.[0] ?? '';

describe('admin teams (+page.svelte)', () => {
	it('renders the new-UI root with the create form', () => {
		const body = renderPage([team('a')]);
		expect(body).toContain('data-ui="new"');
		expect(body).toMatch(/<input[^>]*id="name"[^>]*name="name"/);
		expect(body).toMatch(/<input[^>]*id="name-bo"[^>]*name="nameBo"/);
		expect(body).toContain(m.teams_create_submit());
	});

	it('gives each row its team link (with its title), Edit names and a red Delete', () => {
		const body = renderPage([team('a')]);
		const a = row(body, 'a');
		expect(a).toMatch(
			new RegExp(
				`<a[^>]*href="/teams/a"[^>]*title="${m.team_students_link_label({ team: 'Team a' })}"`
			)
		);
		expect(a).toContain(m.names_edit());
		const del = a.match(/<form[^>]*action="\?\/delete"[\s\S]*?<\/form>/)?.[0] ?? '';
		expect(del).toMatch(/name="teamId" value="a"/);
		expect(del).toMatch(/name="teamName" value="Team a"/);
		expect(del).toMatch(/<button[^>]*text-destructive/);
		expect(del).toContain(m.teams_delete());
	});

	it('has no Delete while the team has members', () => {
		const body = renderPage([team('full', { memberCount: 3 }), team('empty')]);
		expect(row(body, 'full')).not.toContain('action="?/delete"');
		expect(row(body, 'full')).toContain(m.names_edit());
		expect(row(body, 'empty')).toContain('action="?/delete"');
	});

	it('shows the empty line without a table when there is no team', () => {
		const body = renderPage([]);
		expect(body).toContain(m.teams_empty());
		expect(body).not.toContain('<table');
	});

	describe('form errors (#117b)', () => {
		const names = { name: 'Lions', nameBo: 'སེང་གེ', nameDe: 'Löwen' };
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
		const create = (html: string) =>
			html.match(/<section[^>]*data-testid="team-create"[\s\S]*?<\/section>/)?.[0] ?? '';
		const page = (form: Record<string, unknown>) => {
			const html = renderPage([team('a'), team('b')], form);
			// The toast announces the error; the inline message has no live role.
			expect(html).not.toContain('role="alert"');
			return html;
		};

		it('create: a missing English or Tibetan name under its field', () => {
			for (const [error, id] of [
				[m.teams_error_name_required(), 'name'],
				[m.teams_error_name_bo_required(), 'name-bo']
			] as const) {
				const html = page({ error, ...names });
				expect(message(create(html), `${id}-error`)).toBe(error);
				marked(html, id);
			}
		});

		it('create: a duplicate under the field that collided', () => {
			const error = m.teams_error_duplicate_name({ name: names.nameBo });
			const html = page({ error, ...names });
			expect(message(html, 'name-bo-error')).toBe(error);
			marked(html, 'name-bo');
			unmarked(html, 'name', 'name-de');
		});

		it('create: a failed create above the button, no field marked', () => {
			const html = page({ error: m.teams_error_create_failed(), ...names });
			expect(message(create(html), 'form-error')).toBe(m.teams_error_create_failed());
			unmarked(html, 'name', 'name-bo', 'name-de');
		});

		it('a delete failure stays toast-only', () => {
			const html = page({ error: m.teams_error_delete_failed() });
			expect(html).not.toContain(m.teams_error_delete_failed());
		});

		it('rename: the error in its row only, with that row’s ids', () => {
			const error = m.teams_error_name_required();
			const html = page({
				error,
				renameId: 'b',
				renameValues: { name: '', nameBo: 'x', nameDe: '' }
			});
			expect(message(html, 'edit-b-name-error')).toBe(error);
			marked(html, 'edit-b-name');
			unmarked(html, 'name');
			expect(html).not.toContain('edit-a-');
			expect(create(html)).not.toContain(error);

			const failed = page({
				error: m.teams_error_rename_failed(),
				renameId: 'b',
				renameValues: names
			});
			expect(message(failed, 'edit-b-form-error')).toBe(m.teams_error_rename_failed());
			expect(failed).not.toContain('id="form-error"');
		});

		describe('under Tibetan', () => {
			const original = getLocale;
			afterEach(() => overwriteGetLocale(original));

			it('places the Tibetan text', () => {
				overwriteGetLocale(() => 'bo');
				const error = m.teams_error_duplicate_name({ name: names.name });
				const html = page({ error, ...names });
				expect(message(html, 'name-error')).toBe(error);
				expect(error).not.toBe(
					m.teams_error_duplicate_name({ name: names.name }, { locale: 'en' })
				);
			});
		});
	});
});
