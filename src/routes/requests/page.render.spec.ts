import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
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

const sick = {
	sessionId: 'sess1',
	studentId: 'st1',
	studentName: 'Dawa',
	className: 'Class A',
	day: '2026-10-26',
	startTime: '10:00',
	ownChild: false
};
const decidedSick = { ...sick, studentId: 'st2', decision: 'approved', decidedBySystem: false };
const registration = {
	id: 's1',
	registrationName: 'Pema',
	status: 'pending',
	createdAt: '2026-10-19T10:00:00Z',
	reviewedAt: null,
	class: null
};
const parent = {
	id: 'p1',
	name: 'Lhamo',
	email: 'lhamo@example.test',
	createdAt: '2026-10-19T10:00:00Z',
	emailConfirmedAt: '2026-10-19T10:05:00Z',
	staffRole: null,
	ownRequest: false
};

const emptyStateMark = 'data-testid="empty-state"';
/** Where a section starts in the markup, or -1. */
const at = (body: string, testid: string) => body.indexOf(`data-testid="${testid}"`);
/** The History group: a `<details>` and all it holds. */
const history = (body: string) =>
	body.match(/<details[^>]*data-testid="requests-history"[\s\S]*?<\/details>/)?.[0] ?? '';

/** Mobile-first story 5 and #116: what waits first, one empty state, History below. */
describe('requests (+page.svelte)', () => {
	it('shows one empty state, no pending cards and no count pill when nothing waits', () => {
		const body = renderPage();
		expect(body.split(emptyStateMark)).toHaveLength(2);
		expect(body).toContain(m.requests_empty_heading());
		expect(body).toContain(m.requests_empty_body());
		for (const testid of [
			'requests-registrations',
			'requests-sick',
			'requests-join',
			'requests-deletion',
			'requests-parents'
		]) {
			expect(body).not.toContain(`data-testid="${testid}"`);
		}
		// The empty state, then Upcoming leave, then the History.
		expect(at(body, 'requests-empty')).toBeGreaterThan(-1);
		expect(at(body, 'requests-empty')).toBeLessThan(at(body, 'requests-upcoming-leave'));
		expect(at(body, 'requests-upcoming-leave')).toBeLessThan(at(body, 'requests-history'));
		expect(body).toContain(m.requests_upcoming_leave_empty());
		expect(body).not.toContain('data-testid="requests-count"');
		expect(body).not.toContain('data-testid="request-row"');
		// The hidden join form is there even without its card.
		expect(body).toContain('action="?/approveJoin"');
	});

	it('keeps the decided lists in a closed History group at the bottom', () => {
		const body = renderPage();
		const group = history(body);
		expect(group).not.toBe('');
		expect(group.match(/<details[^>]*>/)?.[0]).not.toMatch(/\sopen/);
		const summary = group.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
		expect(summary.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1].trim()).toBe(
			m.requests_history_heading()
		);
		expect(group).toContain('data-testid="requests-decided"');
		expect(group).toContain('data-testid="requests-sick-decided"');
		expect(group).toContain(m.requests_decided_empty());
		expect(group).toContain(m.requests_sick_decided_empty());
		// The admin's decided lists are the admin's.
		expect(group).not.toContain('data-testid="requests-deletion-decided"');
		expect(group).not.toContain('data-testid="requests-upcoming-leave"');
	});

	it('shows the join card first and no empty state when only a class join request waits', () => {
		const join = {
			id: 'j1',
			studentName: 'Norbu',
			className: 'Class B',
			currentClasses: 'Class A',
			requestedAt: '2026-10-19T10:00:00Z',
			ownChild: false
		};
		const body = renderPage({ joinPending: [join] } as never);
		expect(body).not.toContain(m.requests_empty_heading());
		expect(body).not.toContain('data-testid="requests-registrations"');
		const first = body.indexOf('<section');
		expect(body.slice(first, at(body, 'requests-join'))).not.toContain('</section>');
		expect(body).toContain('Norbu');
	});

	it('shows the Sick leave card first and no empty state when only Sick leave waits', () => {
		const body = renderPage({ sickPending: [sick], sickDecided: [decidedSick] } as never);
		expect(body).not.toContain(emptyStateMark);
		expect(body).not.toContain(m.requests_empty_heading());
		expect(body).not.toContain('data-testid="requests-registrations"');
		const first = body.indexOf('<section');
		expect(body.indexOf('data-testid="requests-sick"')).toBeGreaterThan(first);
		expect(body.slice(first, body.indexOf('data-testid="requests-sick"'))).not.toContain(
			'</section>'
		);
		expect(at(body, 'requests-sick')).toBeLessThan(at(body, 'requests-upcoming-leave'));
		expect(history(body)).toContain('data-testid="request-row"');
	});

	it('shows the Sick card without the empty state or count pill for the viewer’s own child', () => {
		const body = renderPage({ sickPending: [{ ...sick, ownChild: true }] } as never);
		expect(body).not.toContain(emptyStateMark);
		expect(body).toContain(m.requests_sick_own_child());
		expect(body).not.toContain('data-testid="requests-count"');
	});

	it('says the join requests and planned leave could not be loaded, with no empty state', () => {
		const body = renderPage({ joinLoadError: true, upcomingLeaveError: true });
		expect(body).toContain('data-testid="requests-join"');
		expect(body).toContain(m.requests_join_load_failed());
		expect(body).toContain(m.requests_upcoming_leave_load_failed());
		expect(body).not.toContain(emptyStateMark);
	});

	it('gives the registrations card its own heading and notes that there is no team yet', () => {
		const body = renderPage({ hasTeams: false, pending: [registration] } as never);
		expect(body).not.toContain(emptyStateMark);
		const card =
			body.match(/<section[^>]*data-testid="requests-registrations"[\s\S]*?<\/section>/)?.[0] ?? '';
		expect(card.match(/<h2[^>]*data-section-heading[^>]*>([\s\S]*?)<\/h2>/)?.[1].trim()).toBe(
			m.requests_registrations_heading()
		);
		const note = body.match(/<p[^>]*data-testid="requests-no-teams"[^>]*>([\s\S]*?)<\/p>/);
		expect(note?.[1].trim()).toBe(m.requests_no_teams_note());
		const approve =
			body
				.match(/<form[^>]*action="\?\/approve"[\s\S]*?<button[^>]*>/)?.[0]
				.match(/<button[^>]*>/)?.[0] ?? '';
		expect(approve).toMatch(/\sdisabled(=""|\s|>)/);
	});

	it('shows no empty state when a pending list failed to load', () => {
		const body = renderPage({ loadError: true });
		expect(body).not.toContain(emptyStateMark);
		expect(body).not.toContain(m.requests_empty_heading());
	});

	it('shows no empty state for the admin while only a deletion request waits', () => {
		const body = renderPage({
			role: 'admin',
			deletionPending: [
				{
					id: 'd1',
					studentName: 'Tenzin',
					requesterName: 'Lhamo',
					requestedAt: '2026-10-19T10:00:00Z',
					ownChild: false
				}
			]
		} as never);
		expect(body).not.toContain(emptyStateMark);
		expect(body).toContain('data-testid="requests-deletion"');
	});

	it('keeps the admin’s hidden deletion form while no deletion request waits', () => {
		const body = renderPage({ role: 'admin' } as never);
		expect(body).not.toContain('data-testid="requests-deletion"');
		expect(body).toContain('action="?/approveDeletion"');
	});

	it('#124: every Reject is a neutral outline; only approving a deletion is red', () => {
		const body = renderPage({
			role: 'admin',
			pending: [registration],
			sickPending: [sick],
			joinPending: [
				{
					id: 'j1',
					studentName: 'Norbu',
					className: 'Class B',
					currentClasses: 'Class A',
					requestedAt: '2026-10-19T10:00:00Z',
					ownChild: false
				}
			],
			parentsPending: [parent],
			deletionPending: [
				{
					id: 'd1',
					studentName: 'Tenzin',
					requesterName: 'Lhamo',
					requestedAt: '2026-10-19T10:00:00Z',
					ownChild: false
				}
			]
		} as never);
		/** The opening tags of the buttons whose whole label is `label`. */
		const buttons = (label: string) =>
			[...body.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
				.filter((match) => match[1].replace(/<[^>]*>/g, '').trim() === label)
				.map((match) => match[0].match(/<button[^>]*>/)![0]);
		// Registration, Sick leave, class join, parent account, deletion request.
		const rejects = buttons(m.requests_reject());
		expect(rejects).toHaveLength(5);
		for (const tag of rejects) {
			expect(tag).not.toContain('bg-destructive');
			expect(tag).toContain('border-border');
		}
		// Approving a deletion erases the child's data: it stays red.
		const deletion =
			body.match(/<section[^>]*data-testid="requests-deletion"[\s\S]*?<\/section>/)?.[0] ?? '';
		const approve = [...deletion.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].find(
			(match) => match[1].replace(/<[^>]*>/g, '').trim() === m.requests_approve()
		);
		expect(approve?.[0]).toContain('bg-destructive');
	});

	it('shows no empty state for the admin while only parent requests wait', () => {
		const body = renderPage({ role: 'admin', parentsPending: [parent] } as never);
		expect(body).not.toContain(emptyStateMark);
		expect(body).toContain('data-testid="requests-parents"');
		expect(body).not.toContain('data-testid="requests-deletion"');
		expect(at(body, 'requests-parents')).toBeLessThan(at(body, 'requests-upcoming-leave'));
	});

	it('puts every pending card before Upcoming leave and the History for the admin', () => {
		const body = renderPage({
			role: 'admin',
			pending: [registration],
			sickPending: [sick],
			joinLoadError: true,
			deletionPending: [
				{
					id: 'd1',
					studentName: 'Tenzin',
					requesterName: 'Lhamo',
					requestedAt: '2026-10-19T10:00:00Z',
					ownChild: false
				}
			],
			parentsPending: [parent]
		} as never);
		expect(body).not.toContain(emptyStateMark);
		const order = [
			'requests-registrations',
			'requests-sick',
			'requests-join',
			'requests-deletion',
			'requests-parents',
			'requests-upcoming-leave',
			'requests-history'
		].map((testid) => at(body, testid));
		expect(order.every((i) => i > -1)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		// The admin's decided lists are in the History, each with its empty line.
		const group = history(body);
		for (const testid of ['requests-deletion-decided', 'requests-parents-decided']) {
			expect(group).toContain(`data-testid="${testid}"`);
		}
		expect(group).toContain(m.requests_deletion_decided_empty());
		expect(group).toContain(m.requests_parents_decided_empty());
	});

	describe('under Tibetan', () => {
		const original = getLocale;
		afterEach(() => overwriteGetLocale(original));

		it('shows the new headings and the empty line in Tibetan', () => {
			overwriteGetLocale(() => 'bo');
			const idle = renderPage();
			expect(idle).toContain('སྒུག་བཞིན་པ་གང་ཡང་མེད།');
			expect(idle).toContain(m.requests_empty_body());
			expect(history(idle)).toContain(m.requests_history_heading());
			expect(renderPage({ pending: [registration] } as never)).toContain(
				m.requests_registrations_heading()
			);
			expect(m.requests_registrations_heading()).not.toBe('Registrations');
			expect(m.requests_history_heading()).not.toBe('History');
			expect(m.requests_empty_body()).not.toMatch(/[A-Za-z]/);
		});
	});

	it('CAP-6: the Sick queue, its history and Upcoming leave say which parent set each answer', () => {
		const body = renderPage({
			sickPending: [{ ...sick, setByName: 'Parent B' }],
			sickDecided: [{ ...decidedSick, setByName: 'Parent A' }],
			upcomingLeave: [
				{
					sessionId: 'sess2',
					studentId: 'st3',
					studentName: 'Tashi',
					className: 'Class A',
					day: '2026-11-02',
					startTime: null,
					classification: 'planned',
					setByName: 'Parent B'
				}
			]
		} as never);
		const sickCard = body.slice(at(body, 'requests-sick'), at(body, 'requests-upcoming-leave'));
		expect(sickCard).toContain(m.leave_set_by({ name: 'Parent B' }));
		const upcoming = body.slice(at(body, 'requests-upcoming-leave'), at(body, 'requests-history'));
		expect(upcoming).toContain(m.leave_set_by({ name: 'Parent B' }));
		expect(history(body)).toContain(m.leave_set_by({ name: 'Parent A' }));
	});

	it('CAP-6: an answer whose setter is unknown shows no label', () => {
		const body = renderPage({ sickPending: [{ ...sick, setByName: null }] } as never);
		expect(body).not.toContain('data-testid="leave-set-by"');
	});
});
