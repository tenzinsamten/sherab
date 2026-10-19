import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

const empty = {
	role: 'teacher' as const,
	pending: [],
	decided: [],
	hasTeams: true,
	parentsPending: [],
	parentsDecided: [],
	sickPending: [],
	sickDecided: [],
	deletionPending: [],
	deletionDecided: [],
	joinPending: [],
	joinLoadError: false,
	upcomingLeave: [],
	upcomingLeaveError: false,
	loadError: false
};

function renderPage(data: Partial<typeof empty> = {}) {
	return render(Page, {
		props: { params: {}, form: null, data: { ...empty, ...data } } as never
	}).body;
}

/** Mobile-first story 5, I/O matrix "Requests, phone — empty" and the load-error lines. */
describe('requests (+page.svelte)', () => {
	it('shows the empty state, each section’s empty line and no count pill when nothing waits', () => {
		const body = renderPage();
		const registrations =
			body.match(/<section[^>]*data-testid="requests-registrations"[\s\S]*?<\/section>/)?.[0] ?? '';
		expect(registrations).toContain('data-testid="empty-state"');
		expect(registrations).toContain(m.requests_empty_heading());
		expect(registrations).not.toContain('<table');
		expect(body).toContain(m.requests_decided_empty());
		expect(body).toContain(m.requests_sick_empty());
		expect(body).toContain(m.requests_sick_decided_empty());
		expect(body).toContain(m.requests_upcoming_leave_empty());
		expect(body).not.toContain('data-testid="requests-count"');
		// No join section while nothing waits; the admin-only sections are the admin's.
		expect(body).not.toContain('data-testid="requests-join"');
		expect(body).not.toContain('data-testid="requests-deletion"');
		expect(body).not.toContain('data-testid="request-row"');
	});

	it('says the join requests and planned leave could not be loaded', () => {
		const body = renderPage({ joinLoadError: true, upcomingLeaveError: true });
		expect(body).toContain('data-testid="requests-join"');
		expect(body).toContain(m.requests_join_load_failed());
		expect(body).toContain(m.requests_upcoming_leave_load_failed());
	});

	it('notes that there is no team yet and keeps Approve disabled', () => {
		const body = renderPage({
			hasTeams: false,
			pending: [
				{
					id: 's1',
					registrationName: 'Pema',
					status: 'pending',
					createdAt: '2026-10-19T10:00:00Z',
					reviewedAt: null,
					class: null
				}
			]
		} as never);
		const note = body.match(/<p[^>]*data-testid="requests-no-teams"[^>]*>([\s\S]*?)<\/p>/);
		expect(note?.[1].trim()).toBe(m.requests_no_teams_note());
		const approve =
			body
				.match(/<form[^>]*action="\?\/approve"[\s\S]*?<button[^>]*>/)?.[0]
				.match(/<button[^>]*>/)?.[0] ?? '';
		expect(approve).toMatch(/\sdisabled(=""|\s|>)/);
	});

	it('shows the admin’s four sections, each with its empty line', () => {
		const body = renderPage({ role: 'admin' } as never);
		for (const text of [
			m.requests_deletion_empty(),
			m.requests_deletion_decided_empty(),
			m.requests_parents_empty(),
			m.requests_parents_decided_empty()
		]) {
			expect(body).toContain(text);
		}
	});
});
