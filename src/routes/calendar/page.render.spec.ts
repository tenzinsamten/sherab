import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

const base = {
	role: 'teacher' as const,
	canEdit: true,
	isAdmin: false,
	month: '3000-10',
	currentMonth: '3000-10',
	prevMonth: '3000-09',
	nextMonth: '3000-11',
	today: '3000-10-02',
	days: [],
	classSchedules: [],
	leaveAnswers: {},
	children: [],
	selectedChild: null,
	childAnswers: {},
	loadError: false
};

function renderPage(data: Partial<Record<keyof typeof base, unknown>> = {}) {
	return render(Page, {
		props: { params: {}, form: null, data: { ...base, ...data } } as never
	}).body;
}

/** Mobile-first story 5b, I/O matrix "Phone view — load error" and the parent hint. */
describe('calendar (+page.svelte)', () => {
	it('shows the error state instead of the calendar when the month failed to load', () => {
		const body = renderPage({ loadError: true });
		expect(body).toContain('data-testid="calendar-load-error"');
		expect(body).toContain(m.calendar_error_load());
		expect(body).not.toContain('calendar-wrap');
		expect(body).not.toContain('data-testid="calendar-empty"');
	});

	it('renders its own new-UI root with the calendar and the empty-month line', () => {
		const body = renderPage();
		expect(body).toMatch(/<div[^>]*data-ui="new"[^>]*data-page="calendar"/);
		expect(body).toContain('calendar-wrap');
		expect(body).toContain(m.calendar_empty());
	});

	it('tells a parent without approved children so (no picker)', () => {
		const body = renderPage({ role: 'parent', canEdit: false });
		expect(body).toContain(m.calendar_parent_no_children());
		expect(body).not.toContain(m.calendar_child_picker_label());
	});

	it('shows no parent hint when the load failed', () => {
		const body = renderPage({ role: 'parent', canEdit: false, loadError: true });
		expect(body).not.toContain(m.calendar_parent_no_children());
		expect(body).toContain(m.calendar_error_load());
	});
});
