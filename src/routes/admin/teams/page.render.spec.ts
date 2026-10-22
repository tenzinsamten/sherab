import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
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

function renderPage(teams: ReturnType<typeof team>[]) {
	return render(Page, {
		props: { params: {}, data: { teams, loadError: false }, form: null } as never
	}).body;
}

const row = (body: string, id: string) =>
	body.match(new RegExp(`<tr[^>]*data-team-id="${id}"[\\s\\S]*?</tr>`))?.[0] ?? '';

describe('admin teams (+page.svelte)', () => {
	it('renders the new-UI root with the create form and no iX', () => {
		const body = renderPage([team('a')]);
		expect(body).toContain('data-ui="new"');
		expect(body).not.toMatch(/<ix-/);
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
});
